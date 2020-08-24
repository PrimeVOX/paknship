require('dotenv').config();
import cli from './cli';
export * from './api';

// allow running cli
(() => { cli(); })();
