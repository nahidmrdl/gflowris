import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {CutrisClient} from '../src/cutris-client.mjs';

async function popupFixture(response){
  const elements=new Map();
  const document={querySelector:selector=>{
    if(!elements.has(selector))elements.set(selector,{hidden:false,disabled:false,textContent:'',className:'',classList:{add(){},remove(){},toggle(){}}});
    return elements.get(selector);
  }};
  const chrome={runtime:{sendMessage:async message=>typeof response==='function'?response(message):response},tabs:{create(){}}};
  const source=await fs.readFile(new URL('../extension/popup.js',import.meta.url),'utf8');
  await vm.runInNewContext(source,{document,chrome});
  return elements;
}

test('missing native hosts direct release users to open the app, not run a setup script',async()=>{
  for(const detail of ['Specified native messaging host not found.','Native host not found.']){
    const elements=await popupFixture({ok:false,error:detail});
    assert.equal(elements.get('#desktop-state').textContent,'Unavailable');
    assert.equal(elements.get('#project-state').textContent,'Not connected');
    assert.equal(elements.get('#diagnostics').hidden,false);
    assert.equal(elements.get('#error-detail').textContent,detail);
    assert.match(elements.get('#status').textContent,/Open gflowris, then reopen this popup/);
    assert.match(elements.get('#status').textContent,/reinstall the latest gflowris release/);
    assert.doesNotMatch(elements.get('#status').textContent,/Setup-native|\.cmd|extension.*ID/i);
  }
});

test('registration failures recommend matching releases without manual extension-ID setup',async()=>{
  for(const detail of ['Access to the specified native messaging host is forbidden.','This extension is not registered for Native Messaging.']){
    const elements=await popupFixture({ok:false,error:detail});
    const guidance=elements.get('#status').textContent;
    assert.match(guidance,/Open gflowris/);
    assert.match(guidance,/reload gflowris bridge in chrome:\/\/extensions/);
    assert.match(guidance,/matching app and extension/);
    assert.doesNotMatch(guidance,/Setup-native|\.cmd|extension.*ID/i);
    assert.equal(elements.get('#error-detail').textContent,detail);
  }
});

test('thrown native connection errors receive the same release guidance',async()=>{
  const elements=await popupFixture(()=>{throw new Error('Specified native messaging host not found.');});
  assert.match(elements.get('#status').textContent,/Open gflowris, then reopen this popup/);
  assert.equal(elements.get('#connect').disabled,false);
});

test('other connection failures keep their original diagnostic detail',async()=>{
  const detail='The desktop app did not respond. No action was retried.';
  const elements=await popupFixture({ok:false,error:detail});
  assert.equal(elements.get('#status').textContent,detail);
  assert.equal(elements.get('#error-detail').textContent,detail);
});

test('a working connection retains the normal project and desktop status',async()=>{
  const elements=await popupFixture({ok:true,desktopOpen:true,selected:true,flowConnected:true,activeFlow:true,queueStatus:'idle'});
  assert.equal(elements.get('#desktop-state').textContent,'Open');
  assert.equal(elements.get('#project-state').textContent,'Connected');
  assert.equal(elements.get('#diagnostics').hidden,true);
  assert.equal(elements.get('#connect').textContent,'Reconnect project');
  assert.equal(elements.get('#connect').disabled,false);
});

test('the popup does not claim success when a legacy pair reply only selected the tab',async()=>{
  const elements=await popupFixture(message=>message.type==='pair'?{ok:true,reconnected:true}:{ok:true,desktopOpen:true,activeFlow:true,selected:true,flowConnected:false});
  await elements.get('#connect').onclick();
  assert.doesNotMatch(elements.get('#status').textContent,/Project connected/);
  assert.match(elements.get('#status').textContent,/Reload the Google Flow page/);
  assert.equal(elements.get('#project-state').textContent,'Not connected');
});

test('the popup confirms success after the pair reply verifies a live connection',async()=>{
  const elements=await popupFixture({ok:true,desktopOpen:true,activeFlow:true,selected:true,flowConnected:true});
  await elements.get('#connect').onclick();
  assert.equal(elements.get('#status').textContent,'Project connected. You can return to the desktop app.');
  assert.equal(elements.get('#project-state').textContent,'Connected');
});

test('missing Cutris runtime configuration recommends opening the release app without starting it',async context=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'flow-connection-guidance-'));
  context.after(async()=>{assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('flow-connection-guidance-'));await fs.rm(folder,{recursive:true,force:true});});
  const client=new CutrisClient(folder);
  await assert.rejects(()=>client.existingConnection(),/Open gflowris.*reinstall the latest gflowris release/);
  await assert.rejects(()=>client.ensure(),/Open gflowris.*reinstall the latest gflowris release/);
});

test('runtime fallback messages no longer mention the developer-only setup script',async()=>{
  for(const filename of ['extension/popup.js','extension/native-client.js','desktop.py','src/cutris-client.mjs']){
    const source=await fs.readFile(new URL('../'+filename,import.meta.url),'utf8');
    assert.doesNotMatch(source,/Setup-native\.cmd/,filename);
  }
  const nativeClient=await fs.readFile(new URL('../extension/native-client.js',import.meta.url),'utf8');
  assert.match(nativeClient,/Open gflowris, then reopen the extension popup/);
  const desktop=await fs.readFile(new URL('../desktop.py',import.meta.url),'utf8');
  assert.match(desktop,/reinstall the latest release/);
  assert.match(desktop,/Error details:.*desktop-error\.log/);
});
