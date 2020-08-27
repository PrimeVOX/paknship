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
const fs_extra_1 = require("fs-extra");
const rimraf_1 = __importDefault(require("rimraf"));
const api_1 = require("./api");
const utils_1 = require("./utils");
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
      invoice-batch </path/to/file.json>    Send invoice(s) using specified file.
      invoice <token>[]                     Send invoice(s) using token args.
      charge-batch </path/to/file.json>     Charge invoices(s) using specified file.
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
    // INVOICE BATCH
    ///////////////////////////////
    if (cmd === 'invoice-batch') {
        if (!argv.length) {
            process.stderr.write('No JSON config file was specified to process and send.', 'utf-8');
            process.exit();
        }
        (() => __awaiter(this, void 0, void 0, function* () {
            // should only be a file path, any other args ignored
            const path = argv.shift();
            // check for file
            const exists = yield fs_extra_1.pathExists(path);
            if (!exists) {
                process.stderr.write('Could not open JSON config file. This was passed as an argument: ' + argv, 'utf-8');
                process.exit();
            }
            // try to read it
            const { err, data } = yield utils_1.me(fs_extra_1.readJson(path));
            if (err) {
                process.stderr.write('Could not open JSON config file. This was passed as an argument: ' + argv, 'utf-8');
                process.exit();
            }
            const response = yield api_1.invoice(data);
            process.stdout.write(JSON.stringify(response), 'utf-8');
            // remove config file, no longer needed since it was completed
            // we don't really care too much what happens, but rimraf requires a cb
            rimraf_1.default(path, () => {
                process.exit();
            });
        }))();
    }
    ///////////////////////////////
    // INVOICE
    ///////////////////////////////
    else if (cmd === 'invoice') {
        if (!argv.length) {
            process.stderr.write('No invoice tokens specified to process and send.', 'utf-8');
            process.exit();
        }
        (() => __awaiter(this, void 0, void 0, function* () {
            const response = yield api_1.invoice(argv);
            process.stdout.write(JSON.stringify(response), 'utf-8');
            process.exit();
        }))();
    }
    ///////////////////////////////
    // CHARGE BATCH
    ///////////////////////////////
    else if (cmd === 'charge-batch') {
        if (!argv.length) {
            process.stderr.write('No JSON config file was specified to process.', 'utf-8');
            process.exit();
        }
        (() => __awaiter(this, void 0, void 0, function* () {
            // should only be a file path, any other args ignored
            const path = argv.shift();
            // check for file
            const exists = yield fs_extra_1.pathExists(path);
            if (!exists) {
                process.stderr.write('Could not open JSON config file. This was passed as an argument: ' + argv, 'utf-8');
                process.exit();
            }
            // try to read it
            const { err, data } = yield utils_1.me(fs_extra_1.readJson(path));
            if (err) {
                process.stderr.write('Could not open JSON config file. This was passed as an argument: ' + argv, 'utf-8');
                process.exit();
            }
            const response = yield api_1.charge(data);
            process.stdout.write(JSON.stringify(response), 'utf-8');
            // remove config file, no longer needed since it was completed
            // we don't really care too much what happens, but rimraf requires a cb
            rimraf_1.default(path, () => {
                process.exit();
            });
        }))();
    }
}
exports.default = cli;
//# sourceMappingURL=cli.js.map