import { ensureDirSync } from 'fs-extra';

export function init() {

  // set up some dirs that will be used by different functions
  ensureDirSync(__dirname + '/configs');
  ensureDirSync(__dirname + '/pdfs');
  ensureDirSync(__dirname + '/logs');

}
