import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {handleGenerationMessage} from '../extension/generation-bridge.js';

const page='https://flow.google.com/project/fixture';
function fixture(){
  const commands=[];
  const chromeApi={runtime:{id:'extension',getManifest:()=>({version:'0.3.1'})},storage:{local:{get:async()=>({native:true,tabId:5})}},tabs:{get:async()=>({url:page})},debugger:{
    attach:async()=>commands.push('attach'),detach:async()=>commands.push('detach'),
    sendCommand:async(target,method,params)=>{commands.push([method,params]);return {result:{value:{x:100,y:50}}};}
  }};
  return {chromeApi,commands,sender:{id:'extension',tab:{id:5},frameId:0,url:page+'/edit/prior-image'}};
}

test('Generate accepts an initial SPA editor route only when the live paired tab is the exact project grid',async()=>{
  const f=fixture();
  const ready=await handleGenerationMessage(f.chromeApi,{type:'generation-ready',page},f.sender);
  assert.equal(ready.ready,true);assert.equal(ready.protocol,1);assert.deepEqual(f.commands,[]);
  const result=await handleGenerationMessage(f.chromeApi,{type:'click-generate',page},f.sender);
  assert.equal(result.clicked,true);
  assert.equal(f.commands.filter(command=>command[0]==='Input.dispatchMouseEvent').length,3);
  assert.equal(f.commands.filter(command=>command==='detach').length,1);
});

test('wrong tab, subframe, origin, and changed project are rejected before any click',async()=>{
  for(const change of [f=>f.sender.tab.id=6,f=>f.sender.frameId=1,f=>f.sender.url='https://accounts.google.com/',f=>f.chromeApi.tabs.get=async()=>({url:page+'/edit/new-image'}),f=>f.sender.id='other-extension']){
    const f=fixture();change(f);
    await assert.rejects(handleGenerationMessage(f.chromeApi,{type:'click-generate',page},f.sender));
    assert.deepEqual(f.commands,[]);
  }
});

test('the actual worker routes Generate requests even when the sender has an initial editor URL',async()=>{
  const f=fixture();let listener;
  f.chromeApi.runtime.onMessage={addListener:fn=>listener=fn};
  f.chromeApi.downloads={onDeterminingFilename:{addListener(){}},onChanged:{addListener(){}}};
  const source=(await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(source,{chrome:f.chromeApi,handleGenerationMessage,nativeRequest:async()=>({}),pulseFlowTab:async()=>{},setInterval(){},URL});
  const response=await new Promise(resolve=>listener({type:'click-generate',page},f.sender,resolve));
  assert.equal(response.ok,true);assert.equal(response.clicked,true);
});

async function contentProbe(ready){
  let listener,generated=0;const reports=[];
  const source=await fs.readFile(new URL('../extension/content.js',import.meta.url),'utf8');
  const chrome={runtime:{id:'extension',getManifest:()=>({version:'0.3.1'}),onMessage:{addListener:fn=>listener=fn},sendMessage:async message=>{
    if(message.type==='generation-ready')return ready;
    if(message.type==='poll'){
      reports.push(...message.results);
      return {ok:true,...(reports.length?{}:{command:{id:'one',type:'generate',payload:{item:{prompt:'Azerbaijan'}}}})};
    }
    throw new Error('Unexpected message');
  }}};
  vm.runInNewContext(source,{chrome,location:{origin:'https://flow.google.com',pathname:'/project/fixture',href:page},
    document:{querySelectorAll:()=>[]},createFlowPrototypeAdapter:()=>({generate:async()=>{generated++;return {id:'ticket'};}}),FlowPrototypeActivate(){},WeakMap,Map,Date,AbortController,DOMException});
  await new Promise(resolve=>setImmediate(resolve));
  listener({type:'native-tick'},{id:'extension'},()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  return {generated,reports};
}

test('missing worker Generate support stops before typing a prompt or clicking',async()=>{
  const result=await contentProbe({ok:false,error:'Unknown message.'});
  assert.equal(result.generated,0);assert.equal(result.reports.length,1);
  assert.match(result.reports[0].error,/Reload gflowris bridge/);
});

test('a successful readiness check executes exactly one generation command',async()=>{
  const result=await contentProbe({ok:true,ready:true,protocol:1});
  assert.equal(result.generated,1);assert.equal(result.reports[0].result.id,'ticket');
});

test('the native heartbeat cancels a content command even while its normal poll is busy',async()=>{
  let listener,entered,leased=false,active=true,cancelled=0;const ready=new Promise(resolve=>entered=resolve),reports=[];
  const source=await fs.readFile(new URL('../extension/content.js',import.meta.url),'utf8');
  const chrome={runtime:{id:'extension',getManifest:()=>({version:'0.3.3'}),onMessage:{addListener:fn=>listener=fn},sendMessage:async message=>{
    if(message.type==='generation-ready')return {ok:true,ready:true,protocol:1};
    if(message.type==='command-state')return {ok:true,active};
    if(message.type==='poll'){reports.push(...message.results);if(leased)return {ok:true};leased=true;return {ok:true,command:{id:'fixture',type:'generate',payload:{}}};}
  }}};
  vm.runInNewContext(source,{chrome,location:{origin:'https://flow.google.com',pathname:'/project/fixture',href:page},document:{querySelectorAll:()=>[]},
    createFlowPrototypeAdapter:({getSignal})=>({generate:async()=>{entered();return new Promise((resolve,reject)=>getSignal().addEventListener('abort',()=>reject(getSignal().reason),{once:true}));},cancel:()=>cancelled++}),
    FlowPrototypeActivate(){},WeakMap,Map,Date,AbortController,DOMException});
  await ready;active=false;listener({type:'native-tick'},{id:'extension'},()=>{});await new Promise(resolve=>setImmediate(resolve));
  listener({type:'native-tick'},{id:'extension'},()=>{});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelled,1);assert.equal(reports.length,1);assert.match(reports[0].error,/cancelled/);
});
