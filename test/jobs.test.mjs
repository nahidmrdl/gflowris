import test from 'node:test';
import assert from 'node:assert/strict';
import {ImageQueue,parsePrompts} from '../src/jobs.mjs';

test('Cutris settings are selectable per prompt and validated',()=>{
  const items=parsePrompts('[{"prompt":"one","removeBackground":true},{"prompt":"two","autoCrop":false,"cutrisMode":"white"}]',{removeBackground:false,cutrisQuality:'fast'});
  assert.equal(items[0].removeBackground,true);assert.equal(items[0].cutrisQuality,'fast');assert.equal(items[1].autoCrop,false);assert.equal(items[1].removeBackground,false);
  assert.throws(()=>parsePrompts('[{"prompt":"x","removeBackground":"yes"}]'),/Cutris/);
});
test('next prompt waits for Cutris and a Cutris failure retains the original',async()=>{
  const log=[];let release;const blocked=new Promise(r=>release=r);
  const queue=new ImageQueue({generate:async item=>{log.push(item.index);return {};},generation:async()=>({complete:true,assets:['a']}),download:async()=>({name:'original.jpg'}),postprocess:async()=>{await blocked;return {name:'cutout.png'};}});
  const running=queue.start(parsePrompts('one\n---PROMPT---\ntwo',{removeBackground:true}));await new Promise(r=>setImmediate(r));assert.deepEqual(log,[1]);release();await running;assert.equal(queue.state.items[0].files[0].cutout.name,'cutout.png');assert.deepEqual(log,[1,2]);
  queue.driver.postprocess=async()=>{throw new Error('Missing model');};await queue.start(parsePrompts('one\n---PROMPT---\ntwo',{removeBackground:true}));
  assert.equal(queue.state.status,'attention');assert.equal(queue.state.items[0].files[0].name,'original.jpg');assert.match(queue.state.items[0].files[0].cutrisError,/Missing model/);assert.equal(queue.state.items[1].status,'queued');
});
test('plain prompts and JSON overrides preserve the selected settings',()=>{
  assert.equal(parsePrompts('one\n---PROMPT---\ntwo',{count:2,ratio:'1:1'}).length,2);
  const [item]=parsePrompts('[{"prompt":"icon","count":1,"aspectRatio":"4:3"}]',{count:2,ratio:'1:1',model:'model'});
  assert.equal(item.ratio,'4:3');assert.equal(item.count,1);assert.equal(item.model,'model');
  assert.throws(()=>parsePrompts('[{"prompt":"hi","count":1.5}]'),/count/);
  assert.throws(()=>parsePrompts('{bad'),/JSON/);
});
test('next prompt waits for generation and EVERY download to finish',async()=>{
  const log=[];let release;const block=new Promise(r=>release=r);
  const items=parsePrompts('first\n---PROMPT---\nsecond',{count:2});let polls=0;
  const queue=new ImageQueue({
    generate:async item=>{log.push('generate '+item.index);return item.index;},
    generation:async ticket=>{if(ticket===1&&++polls===1)return {complete:false};return {complete:true,assets:['a','b']};},
    download:async(asset,item,index)=>{log.push('download '+item.index+' '+index);if(item.index===1&&index===1)await block;log.push('saved '+item.index+' '+index);return {name:asset};}
  },{sleep:async()=>{},pollInterval:0});
  const run=queue.start(items);await new Promise(r=>setImmediate(r));
  assert(!log.includes('generate 2'));release();await run;
  assert(log.indexOf('generate 2')>log.indexOf('saved 1 1'));assert.equal(queue.state.status,'complete');
  assert(Date.parse(items[1].startedAt)>=Date.parse(items[0].finishedAt));
});
test('ambiguous generation failure stops without a duplicate submission',async()=>{
  let calls=0;const queue=new ImageQueue({generate:async()=>{calls++;throw new Error('Disconnected after click');}});
  await queue.start(parsePrompts('one\n---PROMPT---\ntwo'));
  assert.equal(calls,1);assert.equal(queue.state.status,'attention');assert.equal(queue.state.items[1].status,'queued');
});
test('pause finishes saving the active prompt then waits before the next',async()=>{
  let queue;const saved=[];
  queue=new ImageQueue({generate:async item=>item.id,generation:async()=>({complete:true,assets:['a']}),download:async(_,item)=>{saved.push(item.index);if(item.index===1)queue.pause();return {name:'image'};}});
  await queue.start(parsePrompts('one\n---PROMPT---\ntwo'));assert.deepEqual(saved,[1]);assert.equal(queue.state.status,'paused');
  await queue.resume();assert.deepEqual(saved,[1,2]);assert.equal(queue.state.status,'complete');
});
test('partial image results never advance the queue',async()=>{
  let downloads=0;const queue=new ImageQueue({generate:async()=>1,generation:async()=>({complete:true,assets:['one']}),download:async()=>downloads++});
  await queue.start(parsePrompts('one',{count:2}));assert.equal(downloads,0);assert.equal(queue.state.status,'attention');
});
