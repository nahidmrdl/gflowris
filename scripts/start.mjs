import fs from 'node:fs/promises';
import path from 'node:path';
import {stateRoot,openRegularChrome} from '../src/browser.mjs';
let existing=false;
try{
  const {origin,token}=JSON.parse(await fs.readFile(path.join(stateRoot,'control.json'),'utf8'));
  if(origin==='http://127.0.0.1:4317'&&/^[0-9a-f]{64}$/.test(token)){
    const response=await fetch(origin+'/api/state',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)});
    if(response.ok){await openRegularChrome(origin+'/#key='+token);existing=true;}
  }
}catch{}
if(!existing)await import('../src/server.mjs');
