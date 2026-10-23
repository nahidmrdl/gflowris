import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parsePromptInput} from '../public/prompt-input.js';
import {DraftQueue} from '../src/draft-queue.mjs';
import {defaultOutputFolder,prepareOutputFolder} from '../src/output-folder.mjs';
import {ImageQueue,parsePrompts} from '../src/jobs.mjs';

test('blank lines stay inside one prompt and only explicit separators create multiple text entries',()=>{
  const source='First paragraph\n\nDetails and negative instructions.';
  assert.equal(parsePromptInput(source).length,1);assert.equal(parsePromptInput(source)[0].prompt,source);
  assert.equal(parsePromptInput(source+'\n---PROMPT---\nNext prompt').length,2);
  assert.equal(parsePromptInput(source+'\n---PROMPT---\nNext prompt',{},'single').length,1);
  assert.throws(()=>parsePromptInput(source+'\n---PROMPT---\n'),/empty prompt/);
});
test('JSON arrays, wrappers, settings overrides and independently pasted JSONs are supported',()=>{
  const defaults={ratio:'1:1',count:1,model:'Nano Banana 2.1'};
  const entries=parsePromptInput('{"prompts":[{"prompt":"one","ratio":"16:9"},{"prompt":"two","settings":{"count":4}}],"defaults":{"resolution":"1K"}}',defaults);
  assert.equal(entries[0].ratio,'16:9');assert.equal(entries[0].resolution,'1K');assert.equal(entries[1].count,4);
  for(const divider of ['\n','\n---PROMPT---\n',',\n']){
    const result=parsePromptInput('{"prompt":"one {with} \\\"quotes\\\""}'+divider+'{"prompt":"two","ratio":"3:4"}',defaults,'json');
    assert.equal(result.length,2);assert.equal(result[1].ratio,'3:4');
  }
  assert.equal(parsePromptInput('```json\n[{"prompt":"one"}]\n```').length,1);
});
test('structured image JSON is preserved as one prompt and malformed settings are rejected',()=>{
  const image={subject:'A crystal',lighting:{type:'soft'},ratio:'part of the artistic specification'};
  assert.deepEqual(JSON.parse(parsePromptInput(JSON.stringify(image))[0].prompt),image);
  assert.equal(parsePromptInput('{"prompt":{"scene":"forest"}}')[0].prompt,'{\n  "scene": "forest"\n}');
  for(const source of ['{"prompt":"one"','{"prompt":"one","count":0}','{"prompt":"one","removeBackground":"true"}','{"prompt":"one","settings":[]}'])assert.throws(()=>parsePromptInput(source));
});
test('25 independent prompts wait for their downloads before advancing and save every requested cutout',async()=>{
  const entries=Array.from({length:25},(_,index)=>({prompt:'Prompt '+index,ratio:index%2?'16:9':'1:1',count:index%3===0?2:1,removeBackground:index%2===0}));
  assert.throws(()=>parsePrompts(JSON.stringify([...entries,{prompt:'26'}])),/25 prompts/);
  const log=[];const queue=new ImageQueue({generate:async item=>{log.push('start '+item.index);return item;},generation:async item=>({complete:true,assets:Array.from({length:item.count},(_,index)=>index)}),download:async(asset,item)=>{log.push('save '+item.index+' '+asset);return {name:'image'};},postprocess:async(file,item)=>{log.push('cut '+item.index);return {name:'cutout'};}});
  await queue.start(parsePrompts(JSON.stringify(entries)));assert.equal(queue.state.status,'complete');assert.equal(queue.state.items.length,25);
  for(let index=1;index<25;index++){const previous=queue.state.items[index-1];assert(log.indexOf('start '+(index+1))>log.lastIndexOf('save '+index+' '+(previous.count-1)));}
  for(const item of queue.state.items){assert.equal(item.files.length,item.count);if(item.removeBackground)assert(item.files.every(file=>file.cutout));}
});
test('draft cards persist exact settings and reject conflicting writes without losing prompts',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gflowris-draft-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const file=path.join(folder,'draft.json');const store=await new DraftQueue(file).load();
  const saved=await store.update({revision:0,items:[{prompt:'one',ratio:'3:4'},{prompt:'two',count:4}]});
  const restored=await new DraftQueue(file).load();assert.deepEqual(restored.state,saved);
  await assert.rejects(store.update({revision:0,items:[]}),/another window/);
  assert.equal(store.state.items.length,2);assert.equal(store.state.items[1].count,4);
  const reordered=await store.update({revision:1,items:[saved.items[1],saved.items[0]]});assert.equal(reordered.items[0].count,4);assert.equal(reordered.items[1].ratio,'3:4');
});
test('output defaults follow Windows Pictures redirection and fall back to the current home without spaces in the app folder',async()=>{
  assert.equal(await defaultOutputFolder({platform:'win32',home:'C:\\Profiles\\Alice',pictures:async()=>'D:\\Cloud\\Pictures'}),'D:\\Cloud\\Pictures\\gflowris-images');
  assert.equal(await defaultOutputFolder({platform:'win32',home:'C:\\Profiles\\Bob',pictures:async()=>''}),'C:\\Profiles\\Bob\\gflowris-images');
  assert.equal(await defaultOutputFolder({platform:'win32',home:'C:\\Profiles\\Bob',pictures:async()=>{throw new Error('missing');}}),'C:\\Profiles\\Bob\\gflowris-images');
});
test('missing output folders are created and unusable destinations fail before generation',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gflowris-output-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const destination=path.join(folder,'missing','gflowris-images');await prepareOutputFolder(destination);assert.deepEqual((await fs.readdir(destination)).sort(),['cutouts','originals']);
  assert.deepEqual(await fs.readdir(path.join(folder,'missing','gflowris-downloads')),[]);
  for(const name of ['originals','cutouts'])assert.deepEqual(await fs.readdir(path.join(destination,name)),[]);
  const artwork=path.join(destination,'keep.png');await fs.writeFile(artwork,'keep');await prepareOutputFolder(destination);assert.equal(await fs.readFile(artwork,'utf8'),'keep');
  await assert.rejects(prepareOutputFolder(artwork),/Choose another folder/);
});
