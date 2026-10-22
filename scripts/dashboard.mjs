import fs from 'node:fs/promises';
import path from 'node:path';
import {stateRoot,openRegularChrome} from '../src/browser.mjs';
const {origin,token}=JSON.parse(await fs.readFile(path.join(stateRoot,'control.json'),'utf8'));
await openRegularChrome(`${origin}/#key=${token}`);
