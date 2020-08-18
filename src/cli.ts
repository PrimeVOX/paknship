import { existsSync, readFileSync } from 'fs';
import rimraf from 'rimraf';
import { invoice } from './api';
import { init } from './init';
import { inline } from 'titere';

function cli() {

  // make sure we have some base directories
  init();

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
      invoice [token] [...]         Send invoice(s) using token(s) supplied.
      inline  <url|string>          Generate single PDF from URL or HTML string, 
                                      returned as Buffer.
    Options:
      -h, --help    displays help.
    `;
    console.log(help);
    process.exit();
  }

  if (!cmd) {
    console.error(`A task to run must be specified.`);
    process.exit();
  }
  
  ///////////////////////////////
  // INVOICE
  ///////////////////////////////

  if (cmd === 'invoice') {

    if (!argv.length) {
      console.error('No JSON config file was specified to process and send.');
      process.exit();  
    }

    (async () => {

      // these are kept relative to this package
      const path = process.cwd() + '/configs/' + argv;

      // check for file
      if (!existsSync(path)) {
        process.stderr.write('Could not open JSON config file. This was passed as an argument: ' + argv);
        process.exit();
      }

      // try to read it
      const trkIds = JSON.parse(readFileSync(path, 'utf-8').toString());

      const response = await invoice(trkIds);
      process.stdout.write(JSON.stringify(response));

      // remove config file, no longer needed since it was completed
      rimraf(path, () => {
        // we don't really care too much, but rimraf requires a cb
      });

      process.exit();

    })();

  }

  ///////////////////////////////
  // INLINE
  ///////////////////////////////

  if (cmd === 'inline') {

    const urlOrHtml = argv.shift();

    // can only accept one incoming param, all others ignored
    if (!urlOrHtml) {
      console.error('A URL or string of HTML must be specified.');
      process.exit();  
    }

    (async () => {

      const buf = await inline(urlOrHtml);

      if (buf)
        process.stdout.write(buf);
      else
        process.stderr.write('PDF could not be created.\n');

      process.exit();

    })();

  }

}

const instance = cli();
export default instance;
