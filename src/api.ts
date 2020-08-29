import gunr, { SendData } from 'gunr';
import pMap from 'p-map';
import axios from 'axios';
import { performance } from 'perf_hooks';
import { clean, store, IFile } from 'titere';
import { IResponse, IPakRef, IFailure, Map, ICharge } from './types';
import { me } from './utils';

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
export async function invoice(tokens: string[]): Promise<IResponse> {

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

  const batch = performance.now().toString();

  const response: IResponse = {
    type: 'invoice-batch',
    failure: [],
    success: [],
  };

  let pakRefs: IPakRef[] = tokens.reduce((a: IPakRef[], c, i) => {

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
          refId: c, // original arg passed
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
  let pdfs: IFile[] = pakRefs.map(t => {
    return {
      refId: t.refId,
      filename: performance.now().toString(),
      urlOrHtml: t.data,
      failed: false,
      result: '',
    };
  });

  // this always resolves, will have updated errors in objects
  pdfs = await store(batch, pdfs);

  // update failures for any pdfs that failed to generate, they won't be processed anyways
  response.failure = [
    ...response.failure,
    ...pdfs.reduce((a: IFailure[], c) => {
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
  const missingEmails: string[] = pakRefs.reduce((a: string[], c) => {
    if (!c.email) return [ ...a, c.refId ];
    return a;
  }, []);
  const { data: foundEmails } = await me(axios.post<Map>(URL_CONTACTS, JSON.stringify(missingEmails)));

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
  pakRefs = pakRefs.reduce((a: IPakRef[], c) => {
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
    return [ ...a, c ];
  }, []);

  // mapper for mailgun
  const mapper = async (pak: IPakRef): Promise<void> => {
    return new Promise(resolve => {

      // set up payload
      let payload: SendData = {
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
      payload = gunr.addAttachment(payload, file);
      
      // fire off send, with callback
      gunr.sendWithTemplate('invoice', payload, null, (err, body) => {

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
  };

  // batch out mails, always resolves
  await pMap(pakRefs, mapper, { concurrency: 10 });

  // post to PHP to update correspondence records
  // at this point, not concerned with response or error handling as it isn't critical
  axios.post(URL_LOG, JSON.stringify(response));

  // clean up files
  await clean(batch);

  // also returning response in case there's a use where we want to wait for
  // the function to finish and get the response on stdout, prob not but oh well
  return response;

}

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
export async function charge(tokens: string[]): Promise<IResponse> {

  const URL_INVOICE = process.env.URL_INVOICE;
  const URL_CONTACTS = process.env.URL_CONTACTS;
  const URL_CHARGE = process.env.URL_CHARGE;
  const URL_LOG = process.env.URL_LOG;

  // we need these env vars
  if (!URL_INVOICE || !URL_CONTACTS || !URL_CHARGE || !URL_LOG) {
    throw new Error('One or more ENV variables are missing!');
  }

  const batch = performance.now().toString();

  // NOTE: payment errors get logged from php side, only concerned with mailing data here
  const response: IResponse = {
    type: 'charge-batch',
    failure: [],
    success: [],
  };

  let pakRefs: IPakRef[] = tokens.reduce((a: IPakRef[], c, i) => {

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
          refId: c, // original arg passed
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
  const doCharge = async (pak: IPakRef): Promise<IPakRef> => {

    const { data: chargeResponse } = await me(axios.get<ICharge>(URL_CHARGE + pak.refId));

    if (!chargeResponse)
      return {
        ...pak,
        charge: {
          status: 0,
          message: 'Could not charge invoice, no response from server',
        },
      }

    return {
      ...pak,
      charge: {
        status: chargeResponse.data.status,
        message: chargeResponse.data.message,
      },
    }

  };

  // batch out charges, always resolves
  pakRefs = await pMap(pakRefs, doCharge, { concurrency: 1 });

  // get ready to generate receipts for the successful charges
  let pdfs: IFile[] = pakRefs.reduce((a: IFile[], c) => {

    // sure to have charge prop now
    if (c.charge.status !== 200)
      return a;

    return [
      ...a,
      {
        refId: c.refId,
        filename: performance.now().toString(),
        urlOrHtml: c.data,
        failed: false,
        result: '',
      }
    ];

  }, []);

  // this always resolves, will have updated errors in objects
  pdfs = await store(batch, pdfs);
  
  // query PHP for missing emails (using default billing contact(s))
  const missingEmails: string[] = pakRefs.reduce((a: string[], c) => {
    if (!c.email) return [ ...a, c.refId ];
    return a;
  }, []);

  const { data: foundEmails } = await me(axios.post<Map>(URL_CONTACTS, JSON.stringify(missingEmails)));

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
  pakRefs = pakRefs.reduce((a: IPakRef[], c) => {
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
    return [ ...a, c ];
  }, []);

  // mapper for gunr
  const doEmail = async (pak: IPakRef): Promise<void> => {
    return new Promise(resolve => {

      // set up payload
      let payload: SendData = {
        to: pak.email,
      };

      // handle charge failures
      if (pak.charge.status !== 200) {

        // send off charge failure email
        gunr.sendWithTemplate('chargefail', payload, null, (err, body) => {

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
          payload = gunr.addAttachment(payload, file);
        }
        
        gunr.sendWithTemplate('receipt', payload, null, (err, body) => {

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
  };

  // batch out mails, always resolves
  // NOTE: ONE AT A TIME TO ENSURE CORRECT TEMPLATE GETS USED WITH GUNR INSTANCE
  // SINCE THIS FUNCTION MAY NOT ALL USE THE SAME ONE
  await pMap(pakRefs, doEmail, { concurrency: 1 });

  // post to PHP to update correspondence records
  // at this point, not concerned with response or error handling as it isn't critical
  axios.post(URL_LOG, JSON.stringify(response));

  // clean up files
  await clean(batch);

  // also returning response in case there's a use where we want to wait for
  // the function to finish and get the response on stdout, prob gets sent to log file
  return response;

}

/**
 * Send notification with invoice attachment
 * 
 * @param  {string} template
 * @param  {string} token
 * @returns Promise<IResponse>
 * 
 */
export async function notify(template: string, token: string): Promise<IResponse> {
  return new Promise(async (resolve) => {

    const URL_INVOICE = process.env.URL_INVOICE;
    const URL_CONTACTS = process.env.URL_CONTACTS;
    const URL_LOG = process.env.URL_LOG;

    // we need these env vars
    if (!URL_INVOICE || !URL_CONTACTS || !URL_LOG) {
      throw new Error('One or more ENV variables are missing!');
    }

    const batch = performance.now().toString();

    const response: IResponse = {
      type: 'notify',
      failure: [],
      success: [],
    };

    // generate pdf
    let pdfs: IFile[] = [
      {
        refId: token,
        filename: performance.now().toString(),
        urlOrHtml: URL_INVOICE + token,
        failed: false,
        result: '',
      }
    ];

    // this always resolves, will have updated errors in objects
    // if there's no file, we can still send notification without attachment, not critical error
    pdfs = await store(batch, pdfs);
    // we only have one anyways
    const pdf = pdfs.shift();
    
    // query PHP for emails (using default billing contact(s))
    const { data: emails } = await me(axios.post<Map>(URL_CONTACTS, JSON.stringify([ token ])));

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
      let payload: SendData = {
        to: to,
      };

      // check for file
      if (!pdf.failed) {
        const file = process.cwd() + '/pdfs/' + batch + '/' + pdf.filename + '.pdf';
        payload = gunr.addAttachment(payload, file);
      }
      
      gunr.sendWithTemplate(template, payload, null, (err, body) => {

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
        axios.post(URL_LOG, JSON.stringify(response));
  
        // clean up files, we don't really need to wait on this
        clean(batch);
  
        // also returning response in case there's a use where we want to wait for
        // the function to finish and get the response on stdout, prob gets sent to log file
        resolve(response);

      });

    }

  });
}
