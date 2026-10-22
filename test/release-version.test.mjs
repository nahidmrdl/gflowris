import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('a versioned release accepts its matching extension and starts a queue',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gflowris-release-version-'));
  const app=path.join(folder,'app'),state=path.join(folder,'state');
  await fs.mkdir(app);await fs.mkdir(state);
  await fs.cp(path.join(root,'src'),path.join(app,'src'),{recursive:true});
  await fs.mkdir(path.join(app,'public'));await fs.copyFile(path.join(root,'public/prompt-input.js'),path.join(app,'public/prompt-input.js'));
  await fs.writeFile(path.join(app,'package.json'),JSON.stringify({type:'module',version:'1.0.7'}));
  const child=spawn(process.execPath,[path.join(app,'src/server.mjs'),'--no-open'],{env:{...process.env,FLOW_PROTO_PORT:'4326',FLOW_PROTO_STATE_DIR:state},stdio:'pipe',windowsHide:true});
  let logs='';child.stderr.on('data',bytes=>logs+=bytes);
  t.after(async()=>{child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('close',resolve));assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('gflowris-release-version-'));await fs.rm(folder,{recursive:true,force:true});});
  let control;for(let i=0;i<600;i++){try{control=JSON.parse(await fs.readFile(path.join(state,'control.json'),'utf8'));break;}catch{if(child.exitCode!==null)throw new Error(logs);await new Promise(resolve=>setTimeout(resolve,50));}}
  assert(control,logs||'Companion startup exceeded 30 seconds.');
  const headers={Authorization:'Bearer '+control.token,'Content-Type':'application/json'};
  const request=async(route,body,custom=headers)=>{
    const response=await fetch(control.origin+route,{method:body===undefined?'GET':'POST',headers:custom,body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json();assert(response.ok,result.error||response.status);return result;
  };
  const current=await request('/api/state');
  const origin='chrome-extension://'+'a'.repeat(32);
  const paired=await request('/bridge/pair',{code:current.pairCode},{Origin:origin,'Content-Type':'application/json'});
  const bridgeHeaders={Origin:origin,Authorization:'Bearer '+paired.token,'Content-Type':'application/json'};
  const page='https://flow.google.com/project/release-fixture';
  await request('/bridge/poll',{tabId:5,snapshot:{version:'1.0.7',page,tiles:[],controls:[]}},bridgeHeaders);
  const defaults={model:'Fixture model',ratio:'1:1',count:1,resolution:'2K',removeBackground:false};
  await request('/api/capabilities',{models:[defaults.model],ratios:['1:1'],counts:[1],resolutions:['2K'],defaults});
  await request('/api/settings',{outputFolder:path.join(folder,'exports')});
  await request('/api/run',{prompts:'Synthetic release fixture',defaults});
  const poll=await request('/bridge/poll',{tabId:5},bridgeHeaders);
  assert.equal(poll.command.type,'generate');
  await request('/api/cancel',{});
});
