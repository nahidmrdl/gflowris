import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('Run locks before awaiting, ignores rapid repeats, recovers from failure, and shows Images in every open view',async t=>{
  const item={id:'11111111-1111-4111-8111-111111111111',prompt:'Synthetic fixture',model:'Fixture model',ratio:'1:1',count:1,resolution:'2K',removeBackground:false};
  const state={connected:true,settings:{defaults:item,outputFolderDisplay:'Pictures\\gflowris-images'},draftQueue:{revision:1,items:[item]},queue:{status:'idle',items:[],message:'Ready'},capabilities:{ready:true,models:['Fixture model'],ratios:['1:1'],counts:[1],resolutions:['2K'],defaults:item}};
  let attempts=0,reads=0,release,cancellations=0,releaseCancel;
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      res.setHeader('Cache-Control','no-store');
      if(pathname.startsWith('/api/')){
        res.setHeader('Content-Type','application/json');
        if(pathname==='/api/cancel'){cancellations++;await new Promise(resolve=>releaseCancel=resolve);state.queue={...state.queue,status:'cancelled',current:null,message:'Queue cancelled.',items:state.queue.items.map(item=>({...item,status:'cancelled',stage:'Cancelled'}))};}
        if(pathname==='/api/run'){
          attempts++;await new Promise(resolve=>release=resolve);
          if(attempts===1){res.writeHead(400);res.end(JSON.stringify({error:'Fixture startup failure.'}));return;}
          state.queue={status:'running',items:[{...item,index:1,status:'running',stage:'Generating',files:[]}],current:item.id,message:'Generating'};
        }
        if(pathname==='/api/state'){reads++;res.end(JSON.stringify(state));return;}
        res.end(JSON.stringify(pathname==='/api/cutris/status'?{owner:'gflowris',models:{detail:true}}:{ok:true}));return;
      }
      const name=pathname==='/'?'index.html':pathname.slice(1);
      assert(['index.html','app.js','queue-ui.js','prompt-input.js','style.css','assets/favicon.ico','assets/app-256.png'].includes(name));
      res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.ico')?'image/x-icon':'text/html');res.end(await fs.readFile(path.join(root,'public',name)));
    }catch(error){res.writeHead(500);res.end(error.message);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{release?.();releaseCancel?.();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  let executablePath;for(const folder of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean)){const candidate=path.join(folder,'Google','Chrome','Application','chrome.exe');try{await fs.access(candidate);executablePath=candidate;break;}catch{}}
  const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
  const context=await browser.newContext(),first=await context.newPage(),second=await context.newPage(),errors=[];
  for(const page of [first,second]){page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/#key=fixture');await page.waitForFunction(()=>!document.querySelector('#run').disabled);}
  await second.locator('[data-workspace-tab="images"]').click();state.draftQueue={...state.draftQueue,revision:2};await second.waitForFunction(()=>document.querySelector('[data-workspace-tab="queue"]').getAttribute('aria-selected')==='true');
  const immediate=await first.evaluate(()=>{const run=document.querySelector('#run');run.click();run.click();run.dispatchEvent(new Event('click'));return {disabled:run.disabled,label:run.textContent,busy:run.getAttribute('aria-busy')};});
  assert.deepEqual(immediate,{disabled:true,label:'Starting…',busy:'true'});
  for(let i=0;i<100&&attempts===0;i++)await pause(20);assert.equal(attempts,1);
  // Two views poll every 1.8 s; three additional reads can require two ticks.
  const before=reads;for(let i=0;i<500&&reads<before+3;i++)await pause(20);assert(reads>=before+3,'polling continues during pending startup');
  assert(await first.locator('#run').isDisabled());assert.equal(await first.locator('#run').textContent(),'Starting…');assert.equal(attempts,1);
  release();await first.getByText('Fixture startup failure.',{exact:true}).waitFor();assert(await first.locator('#run').isEnabled());assert.equal(await first.locator('#run').getAttribute('aria-busy'),'false');
  await first.locator('#run').click();for(let i=0;i<100&&attempts===1;i++)await pause(20);assert.equal(attempts,2);release();
  for(const page of [first,second]){await page.waitForFunction(()=>document.querySelector('#run').textContent==='Running…'&&!document.querySelector('#results-pane').hidden);assert(await page.locator('#run').isDisabled());assert.equal(await page.locator('[data-workspace-tab="images"]').getAttribute('aria-selected'),'true');}
  for(const selector of ['#clear-queue','#queue-select-all','#remove-prompts'])assert(await first.locator(selector).isDisabled(),selector+' stays locked during generation');
  await first.evaluate(()=>document.querySelector('#run').dispatchEvent(new Event('click')));assert.equal(attempts,2);
  await first.locator('[data-workspace-tab="queue"]').click();await first.locator('[data-workspace-tab="queue"][aria-selected="true"]').waitFor();
  const next=reads;for(let i=0;i<150&&reads<next+3;i++)await pause(20);assert.equal(await first.locator('[data-workspace-tab="queue"]').getAttribute('aria-selected'),'true','manual tab choice remains usable during a run');
  const cancelState=await first.evaluate(()=>{const cancel=document.querySelector('#cancel');cancel.click();cancel.click();cancel.dispatchEvent(new Event('click'));return {disabled:cancel.disabled,label:cancel.textContent};});assert.deepEqual(cancelState,{disabled:true,label:'Cancelling…'});
  for(let i=0;i<100&&!cancellations;i++)await pause(20);assert.equal(cancellations,1);releaseCancel();
  for(const page of [first,second]){await page.waitForFunction(()=>document.querySelector('#run').textContent==='Run queue (1)'&&!document.querySelector('#run').disabled);assert(await page.locator('#cancel').isDisabled());assert(await page.locator('#pause').isDisabled());assert(await page.locator('#queue-progress').isHidden());}
  let releaseSettings;const blocked=new Promise(resolve=>releaseSettings=resolve);await first.route('**/api/settings',async route=>{await blocked;await route.fulfill({json:{ok:true}}).catch(()=>{});});
  await first.locator('#run').click();await first.waitForFunction(()=>document.querySelector('#run').textContent==='Starting…');await first.locator('#cancel').click();
  for(let i=0;i<100&&cancellations===1;i++)await pause(20);assert.equal(cancellations,2);releaseSettings();releaseCancel();await first.waitForFunction(()=>!document.querySelector('#run').disabled);assert.equal(attempts,2,'cancelling during preference saving must prevent a later Run request');
  assert.deepEqual(errors,[]);
});
