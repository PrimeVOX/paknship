CLI and lib for Puppeteer

## CLI

### `invoice-batch`

```sh
$ node ./ invoice-batch <path/to/filename.json>
```

Pass the filename of a JSON file.  It should contain an array of invoice tracking ID strings, and optionally may include email addresses to override the defaults when emailing the generated invoice PDF file.

### `invoice`

```sh
$ node ./ invoice <token>[]
```

Pass one or more tokens as args.  Optionally may include email addresses to override the defaults when emailing the generated invoice PDF file.

## Library functions

The following functions are exported directly.

### `invoice`

```ts
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
```
