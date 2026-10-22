import {ensureCompanion} from '../src/companion-control.mjs';
import {stateRoot} from '../src/browser.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
console.log(JSON.stringify(await ensureCompanion(root,stateRoot)));
