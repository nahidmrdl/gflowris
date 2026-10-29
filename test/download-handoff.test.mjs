import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parsePrompts} from '../src/jobs.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

test('an image-ID filename is associated with its queued asset and completes the download handoff',async context=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gflowris-download-handoff-'));
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));assert.notEqual(port,4317);
  const page='https://flow.google.com/project/fixture',mediaId='ab12cd34-1234-4234-8234-123456789abc';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCzkAAAAASUVORK5CYII=','base64');
  const items=parsePrompts('Fixture token',{model:'Fixture',resolution:'2K',removeBackground:false});
  items[0].status='attention';items[0].outputFolder=path.join(folder,'output');items[0].assets=[{page,mediaId}];
  await fs.writeFile(path.join(folder,'last-queue.json'),JSON.stringify({status:'attention',current:null,items,message:'Interrupted'}));
  const child=spawn(process.execPath,[path.join(root,'src/server.mjs'),'--no-open'],{cwd:root,env:{...process.env,FLOW_PROTO_STATE_DIR:folder,FLOW_PROTO_PORT:String(port)},windowsHide:true,stdio:'pipe'});
  let logs='';child.stderr.on('data',data=>logs+=data);
  context.after(async()=>{child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('close',resolve));assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('gflowris-download-handoff-'));await fs.rm(folder,{recursive:true,force:true});});
  let control;for(let attempt=0;attempt<300;attempt++){try{control=JSON.parse(await fs.readFile(path.join(folder,'control.json'),'utf8'));break;}catch{if(child.exitCode!==null)throw new Error(logs);await pause(50);}}assert(control,logs);
  const request=async(endpoint,headers,data)=>{const response=await fetch('http://127.0.0.1:'+port+endpoint,{method:data===undefined?'GET':'POST',headers:{...headers,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});assert(response.ok,await response.clone().text());return response.json();};
  const uiHeaders={Authorization:'Bearer '+control.token},api=(endpoint,data)=>request('/api/'+endpoint,uiHeaders,data);
  const origin='chrome-extension://'+'e'.repeat(32),paired=await request('/bridge/pair',{Origin:origin},{code:(await api('state')).pairCode});
  const headers={Origin:origin,Authorization:'Bearer '+paired.token},bridge=(endpoint,data)=>request('/bridge/'+endpoint,headers,data);
  const poll=(results=[])=>bridge('poll',{tabId:5,results});
  await bridge('poll',{tabId:5,snapshot:{page,version:'0.3.3',controls:[],tiles:[]}});await api('resume',{});
  const nextCommand=async()=>{for(let attempt=0;attempt<100;attempt++){const result=await poll();if(result.command)return result.command;await pause(10);}assert.fail('No browser command arrived');};
  const download=await nextCommand();assert.equal(download.type,'download');assert.equal(download.payload.asset.mediaId,mediaId);
  const marker=download.payload.marker,started=Date.now();
  await bridge('arm',{marker,title:'Fixture token',resolution:'2K',page:page+'/edit/fixture',started,sourceOrigin:'https://flow.google.com',mediaId:'ffffffff-ffff-4fff-8fff-ffffffffffff'});
  const waiting=await api('state');assert.equal(waiting.downloadStatus[0].expected.mediaId,mediaId);
  const candidate={filename:'Fixture_token_12345678_2K.png',mime:'image/png',startTime:new Date(started+1).toISOString(),referrerOrigin:'https://flow.google.com',sourceOrigin:'https://flow.google.com'};
  assert.equal((await bridge('candidate',{marker,item:candidate})).match,false);
  assert.deepEqual(await bridge('candidate',{marker,item:{...candidate,filename:'Fixture_token_ab12cd34_2K (1).png'}}),{match:true,extension:'png'});
  const source=path.join(folder,marker+'.png');await fs.writeFile(source,png);await bridge('download',{marker,filename:source});
  await poll([{id:download.id,result:{started:true}}]);const back=await nextCommand();assert.equal(back.type,'returnToProject');
  assert.equal((await api('state')).queue.items[0].files.length,1);
  await poll([{id:back.id,result:{ok:true}}]);
  let final;for(let attempt=0;attempt<100;attempt++){final=await api('state');if(final.queue.status==='complete')break;await pause(10);}
  assert.equal(final.queue.status,'complete');assert.equal(final.queue.items[0].status,'complete');assert.equal(final.downloadStatus.length,0);
  assert.deepEqual(await fs.readFile(final.queue.items[0].files[0].path),png);
});
