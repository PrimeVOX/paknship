import gunr, { SendData } from 'gunr';
import pMap from 'p-map';
import axios from 'axios';
import { performance } from 'perf_hooks';
import { clean, store, IFile } from 'titere';
import { IResponse, IPakRef, IFailure, Map } from './types';
import { me } from './utils';

/**
 * Generate and email batch of invoices from an array of invoice tracking IDs (hashes)
 * 
 * @param  {string[]} trkIds
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
export async function invoice(trkIds: string[]): Promise<IResponse> {

  // NOTE: might be able to break this up into some smaller functions of the steps
  // but really it doesn't do as much as it appears due to length, there are several
  // times where we're just handling errors and updating the response object, 
  // which takes up a lot of space.

  const URL_INVOICE = process.env.URL_INVOICE;
  const URL_CONTACTS = process.env.URL_CONTACTS;
  const URL_LOG = process.env.URL_LOG;

  // we need these env vars
  if (!URL_INVOICE || !URL_CONTACTS || !URL_LOG) {
    console.error('One or more ENV variables are missing!');
    process.exit();
  }

  const batch = performance.now().toString();

  const response: IResponse = {
    failure: [],
    success: [],
  };

  let pakRefs: IPakRef[] = trkIds.reduce((a: IPakRef[], c, i) => {

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
  const { data: foundEmails } = await me<Map>(axios.post(URL_CONTACTS, JSON.stringify(missingEmails)));

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
      // these are kept relative to this package!
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
