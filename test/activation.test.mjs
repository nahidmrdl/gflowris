import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=`<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="grid">
<button aria-label="Settings trigger">Settings</button>
<section id="settings" hidden>
<button role="radio" aria-checked="true">image Image</button>
<button role="radio" aria-checked="true">crop_square 1:1</button>
<button role="radio" aria-checked="true">x1</button>
<button aria-label="Select model family">🍌 Nano Banana 2.1 arrow_drop_down</button>
<div id="models" hidden><button role="menuitem">🍌 Nano Banana 2.1</button></div>
</section>
<div role="textbox" contenteditable="true" aria-label="What do you want to create?" style="height:60px;border:1px solid"></div>
<button aria-label="Start generation" type="submit" disabled>arrow_forward</button><main><flow-tile-container><flow-image-tile><img data-media-id="prior-asset" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCzkAAAAASUVORK5CYII=" width="120" height="120"></flow-image-tile></flow-tile-container></main>
</div><section id="edit" hidden><button aria-label="Back button to go to previous page">Back</button><button aria-label="Download media">Download</button><input aria-label="Editable text" value="Fixture token"></section>
<script>
window.activationStats={pointerDowns:0,clicks:0,generations:0};window.acceptGeneration=true;let pointerReady=false;
const button=document.querySelector('[aria-label="Start generation"]'),editor=document.querySelector('[contenteditable]');
editor.addEventListener('input',()=>button.disabled=!editor.textContent.trim());
document.querySelector('[aria-label="Settings trigger"]').onclick=()=>document.querySelector('#settings').hidden=!document.querySelector('#settings').hidden;
document.querySelector('[aria-label="Select model family"]').onclick=()=>{document.querySelector('#models').hidden=false;const overlay=document.createElement('div');overlay.style='position:fixed;inset:0;background:transparent;z-index:99999';document.body.append(overlay);setTimeout(()=>overlay.remove(),270);};
document.querySelector('[role="menuitem"]').onclick=()=>document.querySelector('#models').hidden=true;
document.addEventListener('click',event=>{if(event.target.matches('flow-image-tile img')){document.querySelector('#grid').hidden=true;document.querySelector('#edit').hidden=false;history.pushState(null,'','/project/fixture/edit/asset');}});
document.querySelector('[aria-label="Back button to go to previous page"]').onclick=()=>{document.querySelector('#grid').hidden=false;document.querySelector('#edit').hidden=true;history.pushState(null,'','/project/fixture');};
document.querySelector('[aria-label="Download media"]').onclick=()=>{
const backdrop=document.createElement('div');backdrop.id='download-backdrop';backdrop.style='position:fixed;inset:0;z-index:9999';
const menu=document.createElement('div');menu.id='download-menu';menu.setAttribute('role','menu');menu.style='position:fixed;top:200px;left:300px;z-index:10000;background:white';menu.innerHTML='<button role="menuitem">1K Original size</button><button role="menuitem">2K Upscaled</button><button role="menuitem"'+(window.upgraded?'':' disabled')+'>4K Upscaled</button>';document.body.append(backdrop,menu);
};
document.addEventListener('keydown',event=>{if(event.keyCode===27){document.querySelector('#download-menu')?.remove();document.querySelector('#download-backdrop')?.remove();document.querySelector('#models').hidden=true;}});
button.addEventListener('pointerdown',()=>{pointerReady=true;activationStats.pointerDowns++;});
button.addEventListener('click',()=>{
activationStats.clicks++;if(!pointerReady||!acceptGeneration)return;pointerReady=false;activationStats.generations++;editor.textContent='';button.disabled=true;
const tile=document.createElement('flow-tile-container');tile.innerHTML='<p>Generating…</p>';document.querySelector('main').append(tile);
setTimeout(()=>{tile.innerHTML='<flow-image-tile><img data-media-id="fixture-asset" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCzkAAAAASUVORK5CYII=" width="120" height="120"></flow-image-tile>';},180);
});
</script></body></html>`;

async function setup(base='http://127.0.0.1:4320'){
  let executablePath;
  for(const folder of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean)){
    const candidate=path.join(folder,'Google','Chrome','Application','chrome.exe');try{await fs.access(candidate);executablePath=candidate;break;}catch{}
  }
  const browser=await chromium.launch({executablePath,headless:true});
  const page=await browser.newPage();
  await page.route(base+'/project/fixture',route=>route.fulfill({contentType:'text/html',body:fixture}));
  await page.goto(base+'/project/fixture');
  for(const script of ['page-actions.js','activation.js','flow-adapter.js'])await page.addScriptTag({path:path.join(root,'extension',script)});
  await page.evaluate(()=>window.adapter=createFlowPrototypeAdapter({activate:FlowPrototypeActivate,startGeneration:()=>FlowPrototypeActivate(document.querySelector('[aria-label="Start generation"]')),visible:el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden',startTimeout:350}));
  return {browser,page};
}
test('pointer activation starts exactly one job and completion waits for a loaded new image',async()=>{
  const {browser,page}=await setup();
  try{
    const ticket=await page.evaluate(()=>adapter.generate({item:{prompt:'Test icon',model:'Nano Banana 2.1',ratio:'1:1',count:1}}));
    const pending=await page.evaluate(ticket=>adapter.generation({ticket,count:1}),ticket);assert.equal(pending.complete,false);
    await page.waitForFunction(()=>document.querySelector('img[data-media-id="fixture-asset"]')?.complete);
    const result=await page.evaluate(ticket=>adapter.generation({ticket,count:1}),ticket);
    assert.equal(result.complete,true);assert.equal(result.assets[0].mediaId,'fixture-asset');
    assert.deepEqual(await page.evaluate(()=>activationStats),{pointerDowns:1,clicks:1,generations:1});
  }finally{await browser.close();}
});

test('continuing from an image page returns to the grid before generating the next prompt',async()=>{
  const {browser,page}=await setup();
  try{
    await page.locator('img[data-media-id="prior-asset"]').click();assert.match(page.url(),/\/edit\//);
    await page.evaluate(()=>adapter.generate({item:{prompt:'Next image',model:'Nano Banana 2.1',ratio:'1:1',count:1}}));
    assert.equal(new URL(page.url()).pathname,'/project/fixture');assert.equal(await page.evaluate(()=>activationStats.generations),1);
  }finally{await browser.close();}
});

test('continuing an unfinished download from the image editor reuses its asset without generating again',async()=>{
  const {browser,page}=await setup();
  try{
    await page.waitForFunction(()=>document.querySelector('img[data-media-id="prior-asset"]')?.complete);
    await page.locator('img[data-media-id="prior-asset"]').click();assert.match(page.url(),/\/edit\//);
    await page.evaluate(()=>{
      window.backClicks=0;document.querySelector('[aria-label="Back button to go to previous page"]').addEventListener('click',()=>backClicks++);
      window.chrome={runtime:{sendMessage:async message=>{window.armedDownload=message;return {ok:true};}}};
    });
    const result=await page.evaluate(()=>adapter.download({asset:{mediaId:'prior-asset',page:location.origin+'/project/fixture'},item:{resolution:'2K'},marker:'11111111-1111-4111-8111-111111111111-1'}));
    assert.equal(result.started,true);assert.equal(await page.evaluate(()=>backClicks),1);
    const armed=await page.evaluate(()=>armedDownload);assert.equal(armed.title,'Fixture token');assert.equal(armed.resolution,'2K');
    assert.equal(await page.evaluate(()=>activationStats.generations),0);
  }finally{await browser.close();}
});
test('browser input sends one trusted click and always detaches from the allowed Flow tab',async()=>{
  const {clickGenerate,isFlowProject}=await import('../extension/browser-input.js');
  assert.equal(isFlowProject('https://accounts.google.com/'),false);assert.equal(isFlowProject('https://flow.google.com/project/x/edit/y'),false);
  const {browser,page}=await setup('https://flow.google.com');
  let session,detached=0;const calls=[];
  const chromeApi={tabs:{get:async id=>{assert.equal(id,5);return {url:page.url()};}},debugger:{attach:async()=>{session=await page.context().newCDPSession(page);},sendCommand:async(target,method,params)=>{assert.equal(target.tabId,5);calls.push(method);return session.send(method,params);},detach:async()=>{detached++;await session.detach();}}};
  try{
    await page.locator('[contenteditable]').fill('Browser input test');
    await page.evaluate(()=>{window.trustedClicks=[];document.querySelector('[aria-label="Start generation"]').addEventListener('click',event=>trustedClicks.push(event.isTrusted));});
    await clickGenerate(chromeApi,5,page.url());
    assert.deepEqual(await page.evaluate(()=>trustedClicks),[true]);assert.equal(detached,1);
    assert.equal(calls.filter(method=>method==='Input.dispatchMouseEvent').length,3);
    await assert.rejects(clickGenerate(chromeApi,5,'https://accounts.google.com/'),/paired Flow project/);
    assert.equal(detached,1);
  }finally{await browser.close();}
});

test('one multiline prompt survives paragraph markup and is submitted exactly once',async()=>{
  const {browser,page}=await setup();
  try{
    await page.evaluate(()=>{
      const editor=document.querySelector('[contenteditable]');
      editor.addEventListener('input',()=>{const lines=editor.innerText.split('\n');editor.replaceChildren(...lines.map(line=>{const p=document.createElement('p');p.textContent=line;if(!line)p.append(document.createElement('br'));return p;}));});
    });
    const prompt='One image with a crystal.\n\nKeep these details in the same prompt.';
    const ticket=await page.evaluate(prompt=>adapter.generate({item:{prompt,model:'Nano Banana 2.1',ratio:'1:1',count:1}}),prompt);
    assert(ticket.id);assert.deepEqual(await page.evaluate(()=>activationStats),{pointerDowns:1,clicks:1,generations:1});
  }finally{await browser.close();}
});
test('an ineffective Generate action reports failure without retrying the click',async()=>{
  const {browser,page}=await setup();
  try{
    await page.evaluate(()=>acceptGeneration=false);
    const error=await page.evaluate(async()=>{try{await adapter.generate({item:{prompt:'Test icon',model:'Nano Banana 2.1',ratio:'1:1',count:1}});}catch(e){return e.message;}});
    assert.match(error,/did not confirm a new generation/);
    assert.deepEqual(await page.evaluate(()=>activationStats),{pointerDowns:1,clicks:1,generations:0});
  }finally{await browser.close();}
});
test('discovery dismisses a modal download menu and reports 2K default with unavailable 4K',async()=>{
  const {browser,page}=await setup();
  try{
    await page.waitForFunction(()=>document.querySelector('img[data-media-id]')?.complete);
    const capabilities=await page.evaluate(()=>adapter.discover());
    assert.deepEqual(capabilities.resolutions,['1K','2K']);assert.equal(capabilities.defaults.resolution,'2K');
    assert.equal(capabilities.resolutionOptions.find(option=>option.value==='4K').enabled,false);
    assert.equal(new URL(page.url()).pathname,'/project/fixture');
    assert.equal(await page.locator('#download-menu').count(),0);
  }finally{await browser.close();}
});
test('4K becomes selectable when the account download menu enables it',async()=>{
  const {browser,page}=await setup();
  try{
    await page.evaluate(()=>window.upgraded=true);await page.waitForFunction(()=>document.querySelector('img[data-media-id]')?.complete);
    const capabilities=await page.evaluate(()=>adapter.discover());
    assert.deepEqual(capabilities.resolutions,['1K','2K','4K']);assert.equal(capabilities.defaults.resolution,'2K');
    assert.equal(capabilities.resolutionOptions.find(option=>option.value==='4K').enabled,true);
  }finally{await browser.close();}
});

test('cancelling tracking preserves the Flow progress guard and permits a fresh generation after it finishes',async()=>{
  const {browser,page}=await setup();
  try{
    await page.evaluate(()=>adapter.generate({item:{prompt:'First icon',model:'Nano Banana 2.1',ratio:'1:1',count:1}}));
    await page.evaluate(()=>{const progress=document.createElement('div');progress.setAttribute('role','progressbar');progress.textContent='Generating';document.body.append(progress);adapter.cancel();});
    const error=await page.evaluate(async()=>{try{await adapter.generate({item:{prompt:'Next icon',model:'Nano Banana 2.1',ratio:'1:1',count:1}});}catch(error){return error.message;}});
    assert.match(error,/generation in progress/);assert.equal(await page.evaluate(()=>activationStats.generations),1);
    await page.evaluate(()=>document.querySelector('[role="progressbar"]').remove());
    await page.waitForFunction(()=>document.querySelector('img[data-media-id="fixture-asset"]')?.complete);
    const ticket=await page.evaluate(()=>adapter.generate({item:{prompt:'Next icon',model:'Nano Banana 2.1',ratio:'1:1',count:1}}));
    assert(ticket.id);assert.equal(await page.evaluate(()=>activationStats.generations),2);
  }finally{await browser.close();}
});

test('a cancelled asynchronous generation cannot type or create fresh tracking when a new signal becomes active',async()=>{
  const {browser,page}=await setup();
  try{
    await page.evaluate(()=>{
      window.activeController=new AbortController();window.settingsClosed=false;window.heldOnce=false;window.finalCheckEntered=false;
      window.activeCheck=new Promise(resolve=>window.releaseActiveCheck=resolve);
      window.adapter=createFlowPrototypeAdapter({
        activate:async element=>{const closing=element.getAttribute('aria-label')==='Settings trigger'&&!document.querySelector('#settings').hidden;await FlowPrototypeActivate(element);if(closing)settingsClosed=true;},
        visible:element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden',
        getSignal:()=>activeController.signal,
        assertActive:async()=>{if(settingsClosed&&!heldOnce){heldOnce=true;finalCheckEntered=true;await activeCheck;}},
        startGeneration:()=>FlowPrototypeActivate(document.querySelector('[aria-label="Start generation"]')),startTimeout:350
      });
      window.pendingGeneration=adapter.generate({item:{prompt:'Cancelled icon',model:'Nano Banana 2.1',ratio:'1:1',count:1}}).then(ticket=>({ticket}),error=>({error:error.message}));
    });
    await page.waitForFunction(()=>finalCheckEntered);
    const outcome=await page.evaluate(async()=>{adapter.cancel();activeController.abort(new DOMException('Queue cancelled.','AbortError'));activeController=new AbortController();releaseActiveCheck();return pendingGeneration;});
    assert.match(outcome.error,/cancel/i);assert.equal(outcome.ticket,undefined);assert.equal(await page.locator('[contenteditable]').textContent(),'');assert.equal(await page.evaluate(()=>activationStats.generations),0);
    const ticket=await page.evaluate(()=>adapter.generate({item:{prompt:'Fresh icon',model:'Nano Banana 2.1',ratio:'1:1',count:1}}));
    assert(ticket.id);assert.equal(await page.evaluate(()=>activationStats.generations),1);
  }finally{await browser.close();}
});
