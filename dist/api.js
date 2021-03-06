"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = exports.charge = exports.invoice = void 0;
const gunr_1 = __importDefault(require("gunr"));
const p_map_1 = __importDefault(require("p-map"));
const axios_1 = __importDefault(require("axios"));
const perf_hooks_1 = require("perf_hooks");
const titere_1 = require("titere");
const utils_1 = require("./utils");
/**
 * Generate and email batch of invoices from an array of invoice tracking IDs (hashes)
 *
 * @param  {string[]} tokens
 * @returns Promise<IResponse>
 *
 * NOTE: The tracking ID string may optionally be preceded by a string making up the
 * `to` field of the email and a pipe character.  This allows for overriding who
 * the invoice is sent to, which if not supplied, is looked up in the db and sent to
 * the contact(s) on record for that entity who are flagged with `is_billing_poc`.
 *
 * Examples:
 * as87df68as6f <- no email supplied
 * foo@bar.com|few8qf8wef6 <- just an email
 * "Joe Schmow <joe@schmow.com>, nobody@noreply.com|asdf85a8s7f5" <- mixed, comma separated
 *
 */
function invoice(tokens) {
    return __awaiter(this, void 0, void 0, function* () {
        // NOTE: might be able to break this up into some smaller functions of the steps
        // but really it doesn't do as much as it appears due to length, there are several
        // times where we're just handling errors and updating the response object, 
        // which takes up a lot of space.
        const URL_INVOICE = process.env.URL_INVOICE;
        const URL_CONTACTS = process.env.URL_CONTACTS;
        const URL_LOG = process.env.URL_LOG;
        // we need these env vars
        if (!URL_INVOICE || !URL_CONTACTS || !URL_LOG) {
            throw new Error('One or more ENV variables are missing!');
        }
        const batch = perf_hooks_1.performance.now().toString();
        const response = {
            type: 'invoice-batch',
            failure: [],
            success: [],
        };
        let pakRefs = tokens.reduce((a, c, i) => {
            // see if we have email(s) included
            const parts = c.split('|');
            if (parts.length === 1) {
                // just the trk id
                return [
                    ...a,
                    {
                        email: '',
                        refId: c,
                        data: URL_INVOICE + c,
                    }
                ];
            }
            if (parts.length > 2) {
                // badly formatted argument, update failures
                response.failure = [
                    ...response.failure,
                    {
                        refId: c,
                        message: `Item at argument index ${i} is incorrectly formatted and cannot be processed.`,
                    }
                ];
                return a;
            }
            // have both parts
            return [
                ...a,
                {
                    email: parts[0],
                    refId: parts[1],
                    data: URL_INVOICE + parts[1],
                }
            ];
        }, []);
        // build pdfs, concurrency handled internally, so no worries on overload
        let pdfs = pakRefs.map(t => {
            return {
                refId: t.refId,
                filename: perf_hooks_1.performance.now().toString(),
                urlOrHtml: t.data,
                failed: false,
                result: '',
            };
        });
        // this always resolves, will have updated errors in objects
        pdfs = yield titere_1.store(batch, pdfs);
        // update failures for any pdfs that failed to generate, they won't be processed anyways
        response.failure = [
            ...response.failure,
            ...pdfs.reduce((a, c) => {
                if (c.failed) {
                    return [
                        ...a,
                        {
                            refId: c.refId,
                            message: c.result,
                        }
                    ];
                }
                return a;
            }, [])
        ];
        // query PHP for missing emails (using default billing contact(s))
        const missingEmails = pakRefs.reduce((a, c) => {
            if (!c.email)
                return [...a, c.refId];
            return a;
        }, []);
        const { data: foundEmails } = yield utils_1.me(axios_1.default.post(URL_CONTACTS, JSON.stringify(missingEmails)));
        if (foundEmails) {
            // use mapped response to update pakRefs with missing email data
            // NOTE: axios uses .data property for actual payload response!
            Object.keys(foundEmails.data).forEach(refId => {
                const found = pakRefs.findIndex(p => p.refId === refId);
                if (found >= 0)
                    pakRefs[found].email = foundEmails.data[refId];
            });
        }
        // at this point, if there are any pakRefs with no email, they must be removed
        pakRefs = pakRefs.reduce((a, c) => {
            if (!c.email) {
                // add to failures
                response.failure = [
                    ...response.failure,
                    {
                        refId: c.refId,
                        message: 'Unable to retrieve email to send invoice to.',
                    }
                ];
                // do not include
                return a;
            }
            // otherwise, ok to include
            return [...a, c];
        }, []);
        // mapper for mailgun
        const mapper = (pak) => __awaiter(this, void 0, void 0, function* () {
            return new Promise(resolve => {
                // set up payload
                let payload = {
                    to: pak.email,
                };
                // check for file
                const pdf = pdfs.find(p => p.refId === pak.refId);
                if (!pdf) {
                    // another failure
                    response.failure = [
                        ...response.failure,
                        {
                            refId: pak.refId,
                            message: 'Unable to find PDF file generated for this invoice.',
                        }
                    ];
                    // bail on this one
                    resolve();
                }
                // have file, proceed
                const file = process.cwd() + '/pdfs/' + batch + '/' + pdf.filename + '.pdf';
                payload = gunr_1.default.addAttachment(payload, file);
                // fire off send, with callback
                gunr_1.default.sendWithTemplate('invoice', payload, null, (err, body) => {
                    if (err) {
                        // some email failure
                        response.failure = [
                            ...response.failure,
                            {
                                refId: pak.refId,
                                message: 'Unable to send email message.',
                            }
                        ];
                        resolve();
                    }
                    // success!
                    response.success = [
                        ...response.success,
                        {
                            refId: pak.refId,
                            // in some cases, might get empty body
                            gunId: body && body.id ? body.id : 'No ID provided.',
                            message: body && body.message ? body.message : 'No message provided.',
                        }
                    ];
                    resolve();
                });
            });
        });
        // batch out mails, always resolves
        yield p_map_1.default(pakRefs, mapper, { concurrency: 10 });
        // post to PHP to update correspondence records
        // at this point, not concerned with response or error handling as it isn't critical
        axios_1.default.post(URL_LOG, JSON.stringify(response));
        // clean up files
        yield titere_1.clean(batch);
        // also returning response in case there's a use where we want to wait for
        // the function to finish and get the response on stdout, prob not but oh well
        return response;
    });
}
exports.invoice = invoice;
/**
 * Charge for batch of invoices from an array of invoice tokens
 *
 * @param  {string[]} tokens
 * @returns Promise<IResponse>
 *
 * NOTE: The tracking ID string may optionally be preceded by a string making up the
 * `to` field of the email and a pipe character.  This allows for overriding who
 * the invoice is sent to, which if not supplied, is looked up in the db and sent to
 * the contact(s) on record for that entity who are flagged with `is_billing_poc`.
 *
 * Examples:
 * as87df68as6f <- no email supplied
 * foo@bar.com|few8qf8wef6 <- just an email
 * "Joe Schmow <joe@schmow.com>, nobody@noreply.com|asdf85a8s7f5" <- mixed, comma separated
 *
 */
function charge(tokens) {
    return __awaiter(this, void 0, void 0, function* () {
        const URL_INVOICE = process.env.URL_INVOICE;
        const URL_CONTACTS = process.env.URL_CONTACTS;
        const URL_CHARGE = process.env.URL_CHARGE;
        const URL_LOG = process.env.URL_LOG;
        // we need these env vars
        if (!URL_INVOICE || !URL_CONTACTS || !URL_CHARGE || !URL_LOG) {
            throw new Error('One or more ENV variables are missing!');
        }
        const batch = perf_hooks_1.performance.now().toString();
        // NOTE: payment errors get logged from php side, only concerned with mailing data here
        const response = {
            type: 'charge-batch',
            failure: [],
            success: [],
        };
        let pakRefs = tokens.reduce((a, c, i) => {
            // see if we have email(s) included
            const parts = c.split('|');
            if (parts.length === 1) {
                // just the trk id
                return [
                    ...a,
                    {
                        email: '',
                        refId: c,
                        data: URL_INVOICE + c,
                    }
                ];
            }
            if (parts.length > 2) {
                // badly formatted argument, update failures
                response.failure = [
                    ...response.failure,
                    {
                        refId: c,
                        message: `Item at argument index ${i} is incorrectly formatted and cannot be processed.`,
                    }
                ];
                return a;
            }
            // have both parts
            return [
                ...a,
                {
                    email: parts[0],
                    refId: parts[1],
                    data: URL_INVOICE + parts[1],
                }
            ];
        }, []);
        // mapper function for charges
        const doCharge = (pak) => __awaiter(this, void 0, void 0, function* () {
            const { data: chargeResponse } = yield utils_1.me(axios_1.default.get(URL_CHARGE + pak.refId));
            if (!chargeResponse)
                return Object.assign(Object.assign({}, pak), { charge: {
                        status: 0,
                        message: 'Could not charge invoice, no response from server',
                    } });
            return Object.assign(Object.assign({}, pak), { charge: {
                    status: chargeResponse.data.status,
                    message: chargeResponse.data.message,
                } });
        });
        // batch out charges, always resolves
        pakRefs = yield p_map_1.default(pakRefs, doCharge, { concurrency: 1 });
        // get ready to generate receipts for the successful charges
        let pdfs = pakRefs.reduce((a, c) => {
            // sure to have charge prop now
            if (c.charge.status !== 200)
                return a;
            return [
                ...a,
                {
                    refId: c.refId,
                    filename: perf_hooks_1.performance.now().toString(),
                    urlOrHtml: c.data,
                    failed: false,
                    result: '',
                }
            ];
        }, []);
        // this always resolves, will have updated errors in objects
        pdfs = yield titere_1.store(batch, pdfs);
        // query PHP for missing emails (using default billing contact(s))
        const missingEmails = pakRefs.reduce((a, c) => {
            if (!c.email)
                return [...a, c.refId];
            return a;
        }, []);
        const { data: foundEmails } = yield utils_1.me(axios_1.default.post(URL_CONTACTS, JSON.stringify(missingEmails)));
        if (foundEmails) {
            // use mapped response to update pakRefs with missing email data
            // NOTE: axios uses .data property for actual payload response!
            Object.keys(foundEmails.data).forEach(refId => {
                const found = pakRefs.findIndex(p => p.refId === refId);
                if (found >= 0)
                    pakRefs[found].email = foundEmails.data[refId];
            });
        }
        // at this point, if there are any pakRefs with no email, they can't be queued,
        // but could possibly (prob not) have charged successfully, account for that
        pakRefs = pakRefs.reduce((a, c) => {
            if (!c.email) {
                // add to failures
                response.failure = [
                    ...response.failure,
                    {
                        refId: c.refId,
                        message: 'Unable to retrieve email to send receipt.',
                    }
                ];
                // do not include
                return a;
            }
            // otherwise, ok to include
            return [...a, c];
        }, []);
        // mapper for gunr
        const doEmail = (pak) => __awaiter(this, void 0, void 0, function* () {
            return new Promise(resolve => {
                // set up payload
                let payload = {
                    to: pak.email,
                };
                // handle charge failures
                if (pak.charge.status !== 200) {
                    // send off charge failure email
                    gunr_1.default.sendWithTemplate('chargefail', payload, null, (err, body) => {
                        if (err) {
                            // some email failure
                            response.failure = [
                                ...response.failure,
                                {
                                    refId: pak.refId,
                                    message: 'Unable to send email message.',
                                }
                            ];
                            resolve();
                        }
                        // record notification email sent
                        response.success = [
                            ...response.success,
                            {
                                refId: pak.refId,
                                // in some cases, might get empty body
                                gunId: body && body.id ? body.id : 'No ID provided.',
                                message: 'Charge failure notice sent.',
                            }
                        ];
                        resolve();
                    });
                }
                else {
                    // handle successful charges with receipt attached
                    // check for file
                    const pdf = pdfs.find(p => p.refId === pak.refId);
                    if (!pdf) {
                        // another failure
                        response.failure = [
                            ...response.failure,
                            {
                                refId: pak.refId,
                                message: 'Unable to find PDF receipt generated for this invoice.',
                            }
                        ];
                        // this is successful charge, so continue without attachment
                    }
                    else {
                        // add attachment to payload
                        const file = process.cwd() + '/pdfs/' + batch + '/' + pdf.filename + '.pdf';
                        payload = gunr_1.default.addAttachment(payload, file);
                    }
                    gunr_1.default.sendWithTemplate('receipt', payload, null, (err, body) => {
                        if (err) {
                            // some email failure
                            response.failure = [
                                ...response.failure,
                                {
                                    refId: pak.refId,
                                    message: 'Unable to send email message.',
                                }
                            ];
                            resolve();
                        }
                        // success!
                        response.success = [
                            ...response.success,
                            {
                                refId: pak.refId,
                                // in some cases, might get empty body
                                gunId: body && body.id ? body.id : 'No ID provided.',
                                message: 'Receipt sent successfully.',
                            }
                        ];
                        resolve();
                    });
                }
            });
        });
        // batch out mails, always resolves
        // NOTE: ONE AT A TIME TO ENSURE CORRECT TEMPLATE GETS USED WITH GUNR INSTANCE
        // SINCE THIS FUNCTION MAY NOT ALL USE THE SAME ONE
        yield p_map_1.default(pakRefs, doEmail, { concurrency: 1 });
        // post to PHP to update correspondence records
        // at this point, not concerned with response or error handling as it isn't critical
        axios_1.default.post(URL_LOG, JSON.stringify(response));
        // clean up files
        yield titere_1.clean(batch);
        // also returning response in case there's a use where we want to wait for
        // the function to finish and get the response on stdout, prob gets sent to log file
        return response;
    });
}
exports.charge = charge;
/**
 * Send notification with invoice attachment
 *
 * @param  {string} template
 * @param  {string} token
 * @returns Promise<IResponse>
 *
 */
function notify(template, token) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => __awaiter(this, void 0, void 0, function* () {
            const URL_INVOICE = process.env.URL_INVOICE;
            const URL_CONTACTS = process.env.URL_CONTACTS;
            const URL_LOG = process.env.URL_LOG;
            // we need these env vars
            if (!URL_INVOICE || !URL_CONTACTS || !URL_LOG) {
                throw new Error('One or more ENV variables are missing!');
            }
            const batch = perf_hooks_1.performance.now().toString();
            const response = {
                type: 'notify',
                failure: [],
                success: [],
            };
            // generate pdf
            let pdfs = [
                {
                    refId: token,
                    filename: perf_hooks_1.performance.now().toString(),
                    urlOrHtml: URL_INVOICE + token,
                    failed: false,
                    result: '',
                }
            ];
            // this always resolves, will have updated errors in objects
            // if there's no file, we can still send notification without attachment, not critical error
            pdfs = yield titere_1.store(batch, pdfs);
            // we only have one anyways
            const pdf = pdfs.shift();
            // query PHP for emails (using default billing contact(s))
            const { data: emails } = yield utils_1.me(axios_1.default.post(URL_CONTACTS, JSON.stringify([token])));
            let to = '';
            if (emails && typeof emails.data[token] === 'string')
                to = emails.data[token];
            // at this point, if there we don't have an email, we can't do what we came here for
            if (!to) {
                response.failure = [
                    ...response.failure,
                    {
                        refId: token,
                        message: 'Unable to retrieve email(s) to send notification.',
                    }
                ];
            }
            else {
                // set up payload
                let payload = {
                    to: to,
                };
                // check for file
                if (!pdf.failed) {
                    const file = process.cwd() + '/pdfs/' + batch + '/' + pdf.filename + '.pdf';
                    payload = gunr_1.default.addAttachment(payload, file);
                }
                gunr_1.default.sendWithTemplate(template, payload, null, (err, body) => {
                    if (err) {
                        // some email failure
                        response.failure = [
                            ...response.failure,
                            {
                                refId: token,
                                message: 'Unable to send email message.',
                            }
                        ];
                    }
                    // success!
                    response.success = [
                        ...response.success,
                        {
                            refId: token,
                            // in some cases, might get empty body
                            gunId: body && body.id ? body.id : 'No ID provided.',
                            message: body && body.message ? body.message : 'Email queued successfully.',
                        }
                    ];
                    // post to PHP to update correspondence records
                    // at this point, not concerned with response or error handling as it isn't critical
                    axios_1.default.post(URL_LOG, JSON.stringify(response));
                    // clean up files, we don't really need to wait on this
                    titere_1.clean(batch);
                    // also returning response in case there's a use where we want to wait for
                    // the function to finish and get the response on stdout, prob gets sent to log file
                    resolve(response);
                });
            }
        }));
    });
}
exports.notify = notify;
//# sourceMappingURL=api.js.map