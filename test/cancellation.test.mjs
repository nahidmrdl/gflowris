import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ImageQueue,parsePrompts} from '../src/jobs.mjs';
import {CutrisClient} from '../src/cutris-client.mjs';
import {handleGenerationMessage} from '../extension/generation-bridge.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCzkAAAAASUVORK5CYII=','base64');

for(const stage of ['generate','generation','download','postprocess'])test('cancel interrupts '+stage+', preserves completed files, and ignores late results',async()=>{
  const entered=deferred(),late=deferred(),log=[];let signal;
  const driver={generate:async item=>{log.push(item.index);return {};},generation:async()=>({complete:true,assets:['asset']}),download:async()=>({name:'original.png'}),postprocess:async()=>({name:'cutout.png'})};
  const original=driver[stage];driver[stage]=async(...args)=>{if(stage==='generate')log.push(args[0].index);signal=args.at(-1).signal;entered.resolve();return late.promise;};
  const queue=new ImageQueue(driver),running=queue.start(parsePrompts('first\n---PROMPT---\nsecond',{removeBackground:true}));
  await entered.promise;assert.equal(queue.cancel(),true);await Promise.race([running,pause(250).then(()=>{throw new Error('Cancellation must not wait for the blocked operation.');})]);
  assert(signal.aborted);assert.equal(queue.running,null);assert.equal(queue.state.status,'cancelled');assert(queue.state.items.every(item=>item.status==='cancelled'));
  if(stage==='postprocess'){assert.equal(queue.state.items[0].files[0].name,'original.png');assert.equal(queue.state.items[0].files[0].cutrisError,undefined);}
  else assert.equal(queue.state.items[0].files.length,0);
  const cancelled=JSON.stringify(queue.state);late.resolve(stage==='generation'?{complete:true,assets:['late']}:stage==='download'?{name:'late.png'}:{});await pause(0);assert.equal(JSON.stringify(queue.state),cancelled);assert.deepEqual(log,[1]);
  driver[stage]=original;await queue.start(parsePrompts('A fresh explicitly started queue',{removeBackground:true}));assert.equal(queue.state.status,'complete');
});

test('cancelled downloads retain earlier saved images, and cancelled paused queues cannot resume',async()=>{
  const entered=deferred(),late=deferred();
  const queue=new ImageQueue({generate:async()=>({}),generation:async()=>({complete:true,assets:['first','second']}),download:async(asset,item,index)=>{if(index===1){entered.resolve();return late.promise;}return {name:'saved-first.png'};}});
  const running=queue.start(parsePrompts('two images',{count:2}));await entered.promise;queue.cancel();await running;assert.deepEqual(queue.state.items[0].files,[{name:'saved-first.png'}]);late.resolve({name:'late-second.png'});await pause(0);assert.equal(queue.state.items[0].files.length,1);
  queue.driver.generation=async()=>({complete:true,assets:['one']});queue.driver.download=async()=>{queue.pause();return {name:'saved.png'};};await queue.start(parsePrompts('one\n---PROMPT---\ntwo'));assert.equal(queue.state.status,'paused');assert(queue.cancel());await assert.rejects(queue.resume(),/cannot be resumed/);assert.equal(queue.state.items[0].status,'complete');assert.equal(queue.state.items[1].status,'cancelled');
});

test('Cutris cancellation aborts the request and never writes a late cutout',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gflowris-cancel-cutris-')),entered=deferred(),late=deferred();
  const server=http.createServer(async(req,res)=>{for await(const chunk of req){}entered.resolve();await late.promise;if(!res.destroyed){res.writeHead(200,{'Content-Type':'image/png','X-Cutris-Project':'a'.repeat(32),'X-Cutris-Width':'1','X-Cutris-Height':'1'});res.end(png);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{late.resolve();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('gflowris-cancel-cutris-'));await fs.rm(folder,{recursive:true,force:true});});
  const original=path.join(folder,'original.png');await fs.writeFile(original,png);
  const client=new CutrisClient(folder);client.connect=async()=>({origin:'http://127.0.0.1:'+server.address().port,headers:{}});
  const controller=new AbortController(),running=client.remove({name:'original.png',path:original},{signal:controller.signal});await entered.promise;controller.abort();await assert.rejects(running,error=>error.name==='AbortError');assert.equal(client.busy,false);late.resolve();await pause(30);assert.deepEqual(await fs.readdir(folder),['original.png']);
});

test('a cancelled Generate command is checked again immediately before the trusted mouse press',async()=>{
  const calls=[],page='https://flow.google.com/project/fixture';let checks=0;
  const chrome={runtime:{id:'self'},storage:{local:{get:async()=>({native:true,tabId:5})}},tabs:{get:async()=>({url:page})},debugger:{attach:async()=>{},detach:async()=>calls.push('detach'),sendCommand:async(_,method,params)=>{calls.push(params?.type||method);return {result:{value:{x:100,y:50}}};}}};
  await assert.rejects(handleGenerationMessage(chrome,{type:'click-generate',page},{id:'self',tab:{id:5},frameId:0,url:page},async()=>{if(++checks===2)throw new Error('Queue cancelled.');}),/cancelled/);
  assert(calls.includes('mouseMoved'));assert(!calls.includes('mousePressed'));assert(!calls.includes('mouseReleased'));assert.equal(calls.at(-1),'detach');
});

test('cancel revokes leased and queued bridge work, rejects late downloads, and permits switching projects',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gflowris-cancel-api-')),port=4324,base='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,[path.join(root,'src/server.mjs'),'--no-open'],{cwd:root,env:{...process.env,FLOW_PROTO_PORT:String(port),FLOW_PROTO_STATE_DIR:folder},windowsHide:true,stdio:'pipe'});
  let logs='';child.stderr.on('data',data=>logs+=data);
  t.after(async()=>{child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('close',resolve));assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('gflowris-cancel-api-'));await fs.rm(folder,{recursive:true,force:true});});
  let control;for(let i=0;i<600;i++){try{control=JSON.parse(await fs.readFile(path.join(folder,'control.json'),'utf8'));break;}catch{if(child.exitCode!==null)throw new Error(logs);await pause(50);}}assert(control,logs||'Companion startup exceeded 30 seconds.');
  const request=(url,headers,data)=>fetch(base+url,{method:data===undefined?'GET':'POST',headers:{...headers,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const uiHeaders={Authorization:'Bearer '+control.token},origin='chrome-extension://'+'c'.repeat(32);
  const api=async(url,data)=>{const response=await request('/api/'+url,uiHeaders,data);assert(response.ok,await response.clone().text());return response.json();};
  const before=await api('state'),paired=await request('/bridge/pair',{Origin:origin},{code:before.pairCode}),bridgeHeaders={Origin:origin,Authorization:'Bearer '+(await paired.json()).token};
  const bridge=async(url,data)=>{const response=await request('/bridge/'+url,bridgeHeaders,data);assert(response.ok,await response.clone().text());return response.json();};
  const page='https://flow.google.com/project/fixture';await bridge('poll',{tabId:5,snapshot:{version:'0.3.3',page,tiles:[{mediaIds:['fixture']}],controls:[]}});
  const defaults={model:'Fixture model',ratio:'1:1',count:1,resolution:'2K',removeBackground:false};await api('capabilities',{models:[defaults.model],ratios:['1:1'],counts:[1],resolutions:['2K'],defaults});await api('settings',{outputFolder:path.join(folder,'output')});
  await api('run',{prompts:'first\n---PROMPT---\nsecond',defaults});
  let command;for(let i=0;i<50&&!command;i++){command=(await bridge('poll',{tabId:5})).command;if(!command)await pause(10);}assert.equal(command.type,'generate');assert((await bridge('command-state',{tabId:5,id:command.id})).active);
  assert.equal((await api('cancel',{})).cancelled,true);assert.equal((await api('state')).queue.status,'cancelled');assert.equal((await bridge('command-state',{tabId:5,id:command.id})).active,false);
  assert.equal((await bridge('poll',{tabId:5,results:[{id:command.id,result:{id:'late-ticket',page}}]})).command,null);assert.equal((await api('state')).queue.status,'cancelled');
  await api('download-existing',{page,mediaId:'fixture',resolution:'2K'});let download;for(let i=0;i<50&&!download;i++){download=(await bridge('poll',{tabId:5})).command;if(!download)await pause(10);}assert.equal(download.type,'download');const marker=download.payload.marker;
  await api('cancel',{});assert.deepEqual((await bridge('poll',{tabId:5})).activeDownloadMarkers,[]);assert.equal((await request('/bridge/download',bridgeHeaders,{marker,filename:path.join(folder,'untrusted.png')})).status,409);
  await bridge('select-tab',{tabId:6,page:'https://flow.google.com/project/new-project'});assert.equal((await api('cancel',{})).cancelled,false);
  await bridge('poll',{tabId:6,snapshot:{version:'0.3.3',page:'https://flow.google.com/project/new-project',tiles:[],controls:[]}});
  const entered=deferred(),release=deferred();
  const engine=http.createServer(async(req,res)=>{if(req.url==='/v1/models'){entered.resolve();await release.promise;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/v1/health'?{name:'cutris',api_version:1}:{models:{detail:true}}));});await new Promise(resolve=>engine.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{release.resolve();engine.closeAllConnections();await new Promise(resolve=>engine.close(resolve));});
  const key=path.join(folder,'key');await fs.writeFile(key,'a'.repeat(48));await fs.writeFile(path.join(folder,'cutris-service.json'),JSON.stringify({name:'cutris',api_version:1,owner:'gflowris',origin:'http://127.0.0.1:'+engine.address().port,key_file:key}));
  const starting=request('/api/run',uiHeaders,{prompts:'Do not submit this cancelled setup',defaults:{...defaults,removeBackground:true}});await entered.promise;assert.equal((await api('state')).preparing,true);
  await Promise.race([api('cancel',{}),pause(500).then(()=>{throw new Error('Cancel must bypass the setup mutation lock.');})]);assert.equal((await starting).status,400);release.resolve();await pause(30);
  assert.equal((await bridge('poll',{tabId:6})).command,null);assert.equal((await api('state')).preparing,false);assert.equal((await api('state')).queue.status,'cancelled');
  assert.equal(JSON.parse(await fs.readFile(path.join(folder,'last-queue.json'),'utf8')).status,'cancelled');
});
