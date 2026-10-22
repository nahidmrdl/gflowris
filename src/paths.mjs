import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let configured=null;
try{configured=JSON.parse(fs.readFileSync(path.join(projectRoot,'.local','runtime.json'),'utf8').replace(/^\uFEFF/,'')).stateRoot;}catch{}
export const stateRoot=process.env.FLOW_PROTO_STATE_DIR||configured||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'AutomationFlowGen');
