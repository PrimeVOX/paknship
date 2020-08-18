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
const fs_1 = require("fs");
const rimraf_1 = __importDefault(require("rimraf"));
const api_1 = require("./api");
const init_1 = require("./init");
const titere_1 = require("titere");
function cli() {
    // make sure we have some base directories
    init_1.init();
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
        (() => __awaiter(this, void 0, void 0, function* () {
            // these are kept relative to this package
            const path = process.cwd() + '/configs/' + argv;
            // check for file
            if (!fs_1.existsSync(path)) {
                process.stderr.write('Could not open JSON config file. This was passed as an argument: ' + argv);
                process.exit();
            }
            // try to read it
            const trkIds = JSON.parse(fs_1.readFileSync(path, 'utf-8').toString());
            const response = yield api_1.invoice(trkIds);
            process.stdout.write(JSON.stringify(response));
            // remove config file, no longer needed since it was completed
            rimraf_1.default(path, () => {
                // we don't really care too much, but rimraf requires a cb
            });
            process.exit();
        }))();
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
        (() => __awaiter(this, void 0, void 0, function* () {
            const buf = yield titere_1.inline(urlOrHtml);
            if (buf)
                process.stdout.write(buf);
            else
                process.stderr.write('PDF could not be created.\n');
            process.exit();
        }))();
    }
}
const instance = cli();
exports.default = instance;
//# sourceMappingURL=cli.js.map