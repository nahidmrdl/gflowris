import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function existingCompanion(stateRoot){
  const control=JSON.parse(await fs.readFile(path.join(stateRoot,'control.json'),'utf8'));
  if(control.origin!=='http://127.0.0.1:4317'||!/^[0-9a-f]{64}$/.test(control.token))throw new Error('Invalid companion descriptor.');
  const res=await fetch(control.origin+'/api/state',{headers:{Authorization:'Bearer '+control.token},signal:AbortSignal.timeout(1000)});
  if(!res.ok)throw new Error('Companion is unavailable.');return control;
}
export async function ensureCompanion(root,stateRoot){
  try{return await existingCompanion(stateRoot);}catch{}
  await fs.mkdir(stateRoot,{recursive:true});
  const log=await fs.open(path.join(stateRoot,'companion.log'),'a');
  try{
    const child=spawn(process.execPath,[path.join(root,'src','server.mjs'),'--no-open'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,FLOW_PROTO_STATE_DIR:stateRoot}});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  }finally{await log.close();}
  for(let i=0;i<100;i++){try{return await existingCompanion(stateRoot);}catch{}await sleep(100);}
  throw new Error('The local companion could not start. Check its local log.');
}
