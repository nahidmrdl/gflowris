import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {MessageReader,encodeMessage} from './native-protocol.mjs';
import {ensureCompanion} from './companion-control.mjs';
import {stateRoot} from './paths.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const caller=process.argv[2];
const allowed=new Set(['/bridge/select-tab','/bridge/poll','/bridge/arm','/bridge/candidate','/bridge/download','/bridge/command-state']);
let connection=null;
async function connect(){
  const registration=JSON.parse((await fs.readFile(path.join(stateRoot,'native-registration.json'),'utf8')).replace(/^\uFEFF/,''));
  if(!/^chrome-extension:\/\/[a-p]{32}\/$/.test(caller||'')||caller!==registration.origin)throw new Error('This extension is not registered for the local app.');
  const control=await ensureCompanion(root,stateRoot);
  const response=await fetch(control.origin+'/native/connect',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+control.token,Origin:caller.slice(0,-1)},body:'{}',signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Native connection failed.');
  return {origin:control.origin,token:result.token,uiToken:control.token};
}
const reader=new MessageReader();
// All output on stdout is length-prefixed JSON. Diagnostics belong on stderr.
reader.on('message',async message=>{
  const id=message?.id;
  try{
    if(typeof id!=='string'||id.length>80)throw new Error('Invalid request identifier.');
    if(!connection)connection=connect().catch(error=>{connection=null;throw error;});
    const current=await connection;
    if(message.action==='status'){
      const response=await fetch(current.origin+'/api/state',{headers:{Authorization:'Bearer '+current.uiToken},signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw new Error('The desktop companion is unavailable.');const state=await response.json();
      process.stdout.write(encodeMessage({id,ok:true,result:{native:true,desktopOpen:state.desktopOpen,flowConnected:state.connected,queueStatus:state.queue.status}}));return;
    }
    if(message.action==='desktop-open'){
      await fs.writeFile(path.join(stateRoot,'desktop-focus.json'),JSON.stringify({request:Date.now()}));
      const response=await fetch(current.origin+'/api/desktop/focus',{method:'POST',headers:{Authorization:'Bearer '+current.uiToken,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw new Error('The desktop companion is unavailable.');const state=await response.json();
      if(!state.desktopOpen){
        const runtime=JSON.parse((await fs.readFile(path.join(stateRoot,'runtime.json'),'utf8')).replace(/^\uFEFF/,''));
        const candidate=path.join(path.dirname(runtime.pythonExe),'pythonw.exe');let python=runtime.pythonExe;try{await fs.access(candidate);python=candidate;}catch{}
        const log=await fs.open(path.join(stateRoot,'desktop.log'),'a');
        try{const child=spawn(python,[path.join(root,'desktop.py')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();}finally{await log.close();}
      }
      process.stdout.write(encodeMessage({id,ok:true,result:{opened:true}}));return;
    }
    if(message.action!=='bridge'||!allowed.has(message.endpoint))throw new Error('Unknown native operation.');
    const response=await fetch(current.origin+message.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.token,Origin:caller.slice(0,-1)},body:JSON.stringify(message.data??{}),signal:AbortSignal.timeout(12000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'The app rejected this operation.');
    process.stdout.write(encodeMessage({id,ok:true,result}));
  }catch(error){process.stdout.write(encodeMessage({id,ok:false,error:error.message}));}
});
reader.on('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;process.stdin.destroy();});
process.stdin.on('data',chunk=>reader.push(chunk));process.stdin.on('end',()=>reader.end());
