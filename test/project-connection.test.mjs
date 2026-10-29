import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function fixture({readyAfter=1,pulseError=null,statusError=null,selectionError=null}={}){
  let listener,selected=false,statusChecks=0,pulses=0;
  const actions=[],storage={};
  const chrome={
    runtime:{id:'extension',onMessage:{addListener:callback=>listener=callback}},
    storage:{local:{set:async data=>{Object.assign(storage,data);actions.push('save-tab');}}},
    tabs:{query:async()=>[{id:5,url:'https://flow.google.com/project/fixture'}]},
    downloads:{onDeterminingFilename:{addListener(){}},onChanged:{addListener(){}}},
  };
  const nativeRequest=async(action,endpoint)=>{
    actions.push(endpoint||action);
    if(action==='bridge'){
      assert.equal(endpoint,'/bridge/select-tab');
      if(selectionError)throw new Error(selectionError);
      selected=true;return {ok:true};
    }
    assert.equal(action,'status');
    if(!selected)return {flowConnected:false};
    statusChecks++;
    if(statusError)throw new Error(statusError);
    return {flowConnected:statusChecks>=readyAfter};
  };
  const source=(await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(source,{chrome,nativeRequest,URL,setInterval(){},setTimeout:callback=>callback(),pulseFlowTab:async()=>{pulses++;assert.equal(storage.tabId,5);actions.push('pulse');if(pulseError)throw new Error(pulseError);}});
  await new Promise(resolve=>setImmediate(resolve));pulses=0;actions.length=0;
  const response=await new Promise(resolve=>listener({type:'pair'},{id:'extension'},resolve));
  return {response,actions,storage,statusChecks,pulses};
}

test('project connection waits for a live heartbeat instead of returning after tab selection',async()=>{
  const result=await fixture({readyAfter:3});
  assert.equal(result.response.ok,true);assert.equal(result.response.flowConnected,true);
  assert.equal(result.statusChecks,3);assert.equal(result.pulses,1);
  assert.deepEqual(result.actions,['status','/bridge/select-tab','save-tab','pulse','status','status','status']);
  assert.equal(result.storage.tabId,5);
});

test('a stale Flow page with no content receiver reports reload instructions, not success',async()=>{
  const result=await fixture({pulseError:'Could not establish connection. Receiving end does not exist.'});
  assert.equal(result.response.ok,false);assert.equal(result.statusChecks,0);
  assert.match(result.response.error,/Reload the Google Flow page/);
  assert.equal(result.response.flowConnected,undefined);
});

test('an acknowledged page that never reaches the companion times out without claiming connection',async()=>{
  const result=await fixture({readyAfter:Infinity});
  assert.equal(result.response.ok,false);assert.equal(result.statusChecks,12);
  assert.match(result.response.error,/has not connected to gflowris yet/);
});

test('native status failures remain visible instead of becoming a successful pair response',async()=>{
  const result=await fixture({statusError:'The desktop companion is unavailable.'});
  assert.equal(result.response.ok,false);assert.equal(result.response.error,'The desktop companion is unavailable.');
  assert.equal(result.statusChecks,1);
});

test('a rejected tab selection does not change stored selection or contact the page',async()=>{
  const result=await fixture({selectionError:'Wait for the active Flow operation before changing tabs.'});
  assert.equal(result.response.ok,false);assert.equal(result.pulses,0);assert.equal(result.storage.tabId,undefined);
});
