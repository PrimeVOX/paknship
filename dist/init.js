"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = void 0;
const fs_extra_1 = require("fs-extra");
function init() {
    // set up some dirs that will be used by different functions
    fs_extra_1.ensureDirSync(__dirname + '/configs');
    fs_extra_1.ensureDirSync(__dirname + '/pdfs');
    fs_extra_1.ensureDirSync(__dirname + '/logs');
}
exports.init = init;
//# sourceMappingURL=init.js.map