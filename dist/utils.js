"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.me = void 0;
/**
 * Promise wrapper that returns an object when used
 * with `await` preventing the need for try/catch.
 *
 * @example
 * const { err, data } = await me(Promise);
 *
 * @param promise the promise to be executed.
 */
exports.me = (promise) => {
    return promise
        .then(data => ({ err: null, data }))
        .catch(err => ({ err }));
};
//# sourceMappingURL=utils.js.map