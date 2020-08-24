import { pathExists, readJson } from 'fs-extra';
import rimraf from 'rimraf';
import { invoice } from './api';
import { inline } from 'titere';
import { me } from './utils';

function cli() {

  // handle args
  let argv = process.argv.slice(2);

  const isHelp = argv.includes('-h') || argv.includes('--help');
  argv = argv.filter(v => !/^(-h|--help)/.test(v));

  let cmd = !isHelp && argv.shift();

  if (cmd)
    cmd = cmd.toLowerCase();

  if (isHelp) {
    const help = `
    Pak'n'Ship
    Commands:
      invoice /path/to/file.json    Send invoice(s) using specified file.
      inline  <url|string>          Generate & return buffer for inline PDF.
    Options:
      -h, --help    displays help.
    `;
    console.log(help);
    process.exit();
  }

  if (!cmd) {
    process.stderr.write(`A task to run must be specified.`, 'utf-8');
    process.exit();
  }
  
  ///////////////////////////////
  // INVOICE
  ///////////////////////////////

  if (cmd === 'invoice') {

    if (!argv.length) {
      process.stderr.write('No JSON config file was specified to process and send.', 'utf-8');
      process.exit();
    }

    (async () => {

      // should only be a file path, any other args ignored
      const path = argv.shift();

      // check for file
      const exists = await pathExists(path);

      if (!exists) {
        process.stderr.write('Could not open JSON config file. This was passed as an argument: ' + argv, 'utf-8');
        process.exit();
      }

      // try to read it
      const { err, data } = await me<string[]>(readJson(path));

      if (err) {
        process.stderr.write('Could not open JSON config file. This was passed as an argument: ' + argv, 'utf-8');
        process.exit();
      }

      const response = await invoice(data);
      process.stdout.write(JSON.stringify(response), 'utf-8');

      // remove config file, no longer needed since it was completed
      // we don't really care too much what happens, but rimraf requires a cb
      rimraf(path, () => {
        process.exit();
      });

    })();

  }

  ///////////////////////////////
  // INLINE
  ///////////////////////////////

  if (cmd === 'inline') {

    const urlOrHtml = argv.shift();

    // can only accept one incoming param, all others ignored
    if (!urlOrHtml) {
      process.stderr.write('A URL must be specified.', 'utf-8');
      process.exit();  
    }

    (async () => {

      const buf = await inline(urlOrHtml);

      if (buf) {
        process.stdout.write(buf, 'utf-8');
        process.exit();
      }
      else {
        process.stderr.write('PDF could not be created.\n', 'utf-8');
        process.exit();
      }

    })();

  }

}

export default cli;
