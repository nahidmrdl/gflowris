import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function workerFixture({downloadState='complete',failReports=0}={}){
  const marker='11111111-1111-4111-8111-111111111111-1',reports=[],session={armed:{marker,downloadId:7,started:Date.now()}},listeners={};
  let currentState=downloadState,failures=failReports;
  const chrome={runtime:{id:'self',onMessage:{addListener:listener=>listeners.message=listener}},storage:{local:{get:async()=>({tabId:5})},session:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,session[key]])),set:async update=>Object.assign(session,update),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete session[key];}}},tabs:{},downloads:{search:async()=>[{id:7,state:currentState,filename:'C:/Downloads/gflowris/'+marker+'.jpg'}],cancel:async()=>{},onDeterminingFilename:{addListener:listener=>listeners.filename=listener},onChanged:{addListener:listener=>listeners.changed=listener}}};
  const nativeRequest=async(action,endpoint,data)=>{
    if(endpoint==='/bridge/download'){if(failures-->0)throw new Error('Transient bridge failure');reports.push(data);return {ok:true};}
    if(endpoint==='/bridge/poll')return {activeDownloadMarkers:[marker]};
    throw new Error('Unexpected endpoint '+endpoint);
  };
  const source=(await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(source,{chrome,nativeRequest,handleGenerationMessage:async()=>({}),pulseFlowTab:async()=>{},setInterval(){},URL});
  const poll=()=>new Promise(resolve=>listeners.message({type:'poll'},{id:'self',tab:{id:5},url:'https://flow.google.com/project/fixture'},resolve));
  return {session,reports,poll,changed:listeners.changed,setState:state=>currentState=state};
}

test('a lost completion event is recovered on the next heartbeat without another download',async()=>{
  const fixture=await workerFixture();await fixture.poll();
  assert.equal(fixture.reports.length,1);assert.match(fixture.reports[0].filename,/\.jpg$/);assert.equal(fixture.session.armed,undefined);
});

test('a completion event whose search is still in progress is retried on the next heartbeat',async()=>{
  const fixture=await workerFixture({downloadState:'in_progress'});
  await fixture.changed({id:7,state:{current:'complete'}});assert.equal(fixture.reports.length,0);assert(fixture.session.pendingReport);
  fixture.setState('complete');await fixture.poll();assert.equal(fixture.reports.length,1);assert.equal(fixture.session.pendingReport,undefined);
});

test('a failed native completion report is retried without losing its association',async()=>{
  const fixture=await workerFixture({failReports:1});await fixture.changed({id:7,state:{current:'complete'}});
  assert(fixture.session.armed);assert(fixture.session.pendingReport);assert.equal(fixture.reports.length,0);
  await fixture.poll();assert.equal(fixture.reports.length,1);assert.equal(fixture.session.armed,undefined);
});

test('concurrent completion and heartbeat reports import a download once',async()=>{
  const fixture=await workerFixture();await Promise.all([fixture.changed({id:7,state:{current:'complete'}}),fixture.poll()]);assert.equal(fixture.reports.length,1);
});

test('an interrupted browser download reports a failure instead of waiting indefinitely',async()=>{
  const fixture=await workerFixture({downloadState:'interrupted'});await fixture.poll();assert.equal(fixture.reports.length,1);assert.match(fixture.reports[0].error,/interrupted/);
});
