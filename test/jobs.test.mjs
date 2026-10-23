import test from 'node:test';
import assert from 'node:assert/strict';
import {ImageQueue,parsePrompts} from '../src/jobs.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(complete=>resolve=complete),resolve:value=>resolve(value)};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Cutris settings are selectable per prompt and validated',()=>{
  const items=parsePrompts('[{"prompt":"one","removeBackground":true},{"prompt":"two","autoCrop":false,"cutrisMode":"white"}]',{removeBackground:false,cutrisQuality:'fast'});
  assert.equal(items[0].removeBackground,true);assert.equal(items[0].cutrisQuality,'fast');assert.equal(items[1].autoCrop,false);assert.equal(items[1].removeBackground,false);
  assert.throws(()=>parsePrompts('[{"prompt":"x","removeBackground":"yes"}]'),/Cutris/);
});
test('next prompt overlaps Cutris while local processing stays serial and completion waits',async context=>{
  const generated=[],processed=[],releaseFirst=deferred(),lastDownloaded=deferred();let processing=0,maximumProcessing=0,settled=false;
  context.after(()=>releaseFirst.resolve());
  const queue=new ImageQueue({
    generate:async item=>{generated.push(item.index);return {};},
    generation:async()=>({complete:true,assets:['asset']}),
    download:async(asset,item)=>{if(item.index===2)lastDownloaded.resolve();return {name:'original-'+item.index+'.jpg'};},
    postprocess:async(file,item)=>{processing++;maximumProcessing=Math.max(maximumProcessing,processing);processed.push(item.index);if(item.index===1)await releaseFirst.promise;processing--;return {name:'cutout-'+item.index+'.png'};}
  });
  const running=queue.start(parsePrompts('one\n---PROMPT---\ntwo',{removeBackground:true}));running.then(()=>settled=true);
  await lastDownloaded.promise;await tick();
  assert.deepEqual(generated,[1,2]);assert.deepEqual(processed,[1]);assert.equal(settled,false);assert.equal(queue.state.status,'running');assert(queue.running);assert(queue.state.items.every(item=>item.status==='running'));
  releaseFirst.resolve();await running;
  assert.equal(maximumProcessing,1);assert.deepEqual(processed,[1,2]);assert.equal(queue.state.status,'complete');assert(queue.state.items.every(item=>item.status==='complete'));assert.equal(queue.state.items[0].files[0].cutout.name,'cutout-1.png');assert.equal(queue.state.items[1].files[0].cutout.name,'cutout-2.png');
});

test('multi-image prompts download every original before advancing and serialize their cutouts',async context=>{
  const generated=[],processed=[],releaseCutris=deferred(),releaseDownload=deferred(),secondDownload=deferred(),lastDownloaded=deferred();
  context.after(()=>{releaseCutris.resolve();releaseDownload.resolve();});
  const queue=new ImageQueue({
    generate:async item=>{generated.push(item.index);return {};},
    generation:async()=>({complete:true,assets:['first','second']}),
    download:async(asset,item,index)=>{if(item.index===1&&index===1){secondDownload.resolve();await releaseDownload.promise;}if(item.index===2&&index===1)lastDownloaded.resolve();return {name:item.index+'-'+asset+'.png'};},
    postprocess:async(file)=>{processed.push(file.name);if(processed.length===1)await releaseCutris.promise;return {name:'cutout-'+file.name};}
  });
  const running=queue.start(parsePrompts('one\n---PROMPT---\ntwo',{count:2,removeBackground:true}));
  await secondDownload.promise;await tick();assert.deepEqual(generated,[1]);assert.deepEqual(processed,['1-first.png']);
  releaseDownload.resolve();await lastDownloaded.promise;await tick();assert.deepEqual(generated,[1,2]);assert.deepEqual(processed,['1-first.png']);assert(queue.state.items.every(item=>item.files.length===2));
  releaseCutris.resolve();await running;assert.deepEqual(processed,['1-first.png','1-second.png','2-first.png','2-second.png']);assert(queue.state.items.every(item=>item.files.every(file=>file.cutout)));assert.equal(queue.state.status,'complete');
});

test('Cutris failure retains the correct original and finishes an already submitted prompt',async context=>{
  const generated=[],processed=[],secondSubmitted=deferred(),releaseSecond=deferred(),releaseFailure=deferred();
  context.after(()=>{releaseSecond.resolve();releaseFailure.resolve();});
  const queue=new ImageQueue({
    generate:async item=>{generated.push(item.index);if(item.index===2){secondSubmitted.resolve();await releaseSecond.promise;}return {};},
    generation:async()=>({complete:true,assets:['asset']}),
    download:async(asset,item)=>({name:'original-'+item.index+'.png'}),
    postprocess:async(file,item)=>{processed.push(item.index);if(item.index===1){await releaseFailure.promise;throw new Error('Missing model');}return {name:'cutout-'+item.index+'.png'};}
  });
  const running=queue.start(parsePrompts('one\n---PROMPT---\ntwo\n---PROMPT---\nthree',{removeBackground:true}));
  await secondSubmitted.promise;releaseFailure.resolve();await tick();releaseSecond.resolve();await running;
  assert.deepEqual(generated,[1,2]);assert.deepEqual(processed,[1,2]);assert.equal(queue.state.status,'attention');assert.match(queue.state.message,/Missing model/);
  const [first,second,third]=queue.state.items;
  assert.equal(first.status,'attention');assert.equal(first.files[0].name,'original-1.png');assert.match(first.files[0].cutrisError,/Missing model/);assert.equal(first.files[0].cutout,undefined);
  assert.equal(second.status,'complete');assert.equal(second.files[0].name,'original-2.png');assert.equal(second.files[0].cutout.name,'cutout-2.png');assert.equal(third.status,'queued');
});

test('Cutris failure does not discard later local tasks already queued for the prompt',async context=>{
  const processed=[],releaseFailure=deferred(),lastDownloaded=deferred();context.after(()=>releaseFailure.resolve());
  const queue=new ImageQueue({
    generate:async()=>({}),generation:async()=>({complete:true,assets:['first','second']}),
    download:async(asset,item,index)=>{if(index===1)lastDownloaded.resolve();return {name:asset+'.png'};},
    postprocess:async file=>{processed.push(file.name);if(file.name==='first.png'){await releaseFailure.promise;throw new Error('First cutout failed');}return {name:'second-cutout.png'};}
  });
  const running=queue.start(parsePrompts('one',{count:2,removeBackground:true}));await lastDownloaded.promise;await tick();releaseFailure.resolve();await running;
  assert.deepEqual(processed,['first.png','second.png']);assert.equal(queue.state.status,'attention');assert.equal(queue.state.items[0].status,'attention');assert.match(queue.state.items[0].files[0].cutrisError,/First cutout failed/);assert.equal(queue.state.items[0].files[1].cutout.name,'second-cutout.png');
});

test('browser failure waits for previously queued Cutris work and preserves both outcomes',async context=>{
  const secondSubmitted=deferred(),releaseCutris=deferred();let settled=false;context.after(()=>releaseCutris.resolve());
  const queue=new ImageQueue({
    generate:async item=>{if(item.index===2){secondSubmitted.resolve();throw new Error('Flow disconnected');}return {};},
    generation:async()=>({complete:true,assets:['asset']}),download:async()=>({name:'original.png'}),
    postprocess:async()=>{await releaseCutris.promise;return {name:'cutout.png'};}
  });
  const running=queue.start(parsePrompts('one\n---PROMPT---\ntwo\n---PROMPT---\nthree',{removeBackground:true}));running.then(()=>settled=true);
  await secondSubmitted.promise;await tick();assert.equal(settled,false);assert(queue.running);
  releaseCutris.resolve();await running;
  assert.equal(queue.state.status,'attention');assert.equal(queue.state.items[0].status,'complete');assert.equal(queue.state.items[0].files[0].cutout.name,'cutout.png');assert.equal(queue.state.items[1].status,'attention');assert.match(queue.state.items[1].stage,/Flow disconnected/);assert.equal(queue.state.items[2].status,'queued');
});

test('pause drains overlapping Cutris work before waiting at the next prompt boundary',async context=>{
  const generated=[],secondDownloaded=deferred(),secondProcessing=deferred(),releaseFirst=deferred(),releaseSecond=deferred();let settled=false,queue;
  context.after(()=>{releaseFirst.resolve();releaseSecond.resolve();});
  queue=new ImageQueue({
    generate:async item=>{generated.push(item.index);return {};},generation:async()=>({complete:true,assets:['asset']}),
    download:async(asset,item)=>{if(item.index===2){queue.pause();secondDownloaded.resolve();}return {name:'original-'+item.index+'.png'};},
    postprocess:async(file,item)=>{if(item.index===1)await releaseFirst.promise;else if(item.index===2){secondProcessing.resolve();await releaseSecond.promise;}return {name:'cutout-'+item.index+'.png'};}
  });
  const running=queue.start(parsePrompts('one\n---PROMPT---\ntwo\n---PROMPT---\nthree',{removeBackground:true}));running.then(()=>settled=true);
  await secondDownloaded.promise;await tick();assert.deepEqual(generated,[1,2]);assert.equal(settled,false);assert.equal(queue.state.status,'running');
  releaseFirst.resolve();await secondProcessing.promise;assert.equal(settled,false);assert.equal(queue.state.status,'running');releaseSecond.resolve();await running;
  assert.equal(queue.state.status,'paused');assert.equal(queue.state.items[0].status,'complete');assert.equal(queue.state.items[1].status,'complete');assert.equal(queue.state.items[2].status,'queued');
  await queue.resume();assert.deepEqual(generated,[1,2,3]);assert.equal(queue.state.status,'complete');
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
