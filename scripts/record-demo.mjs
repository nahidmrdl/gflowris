// Opt-in live demo: one batch, never automatically resubmitted after a failure.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {startWindowRecordings,encodeWindowRecordings} from './window-recording.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv.includes('--run-live'))throw new Error('This creates five real Flow generations. Run with --run-live only when intended.');
const runtime=JSON.parse((await fs.readFile(path.join(root,'.local','runtime.json'),'utf8')).replace(/^\uFEFF/,''));
const control=JSON.parse(await fs.readFile(path.join(runtime.stateRoot,'control.json'),'utf8'));
const prompts=JSON.parse(await fs.readFile(path.join(root,'examples','demo-prompts.json'),'utf8'));
const desktopIndex=process.argv.indexOf('--desktop-cdp'),desktopEndpoint=desktopIndex<0?null:process.argv[desktopIndex+1];
if(desktopEndpoint&&!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(desktopEndpoint))throw new Error('The native renderer endpoint must use local loopback.');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,data){const response=await fetch(control.origin+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+control.token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||route+' failed.');return result;}
const start=await api('state');
if(!start.connected||!start.desktopOpen||start.queue.status==='running'||start.postProcessing)throw new Error('Open gflowris, connect an idle Flow project, then run the demo.');
if(start.snapshot?.tiles?.some(tile=>tile.mediaIds?.length))throw new Error('Use a new empty Flow project for this demo.');
const editor=start.snapshot?.controls?.find(control=>control.attrs?.['aria-label']==='What do you want to create?');
if(editor?.text?.trim()){
  const normalized=value=>value.replace(/\s+/g,' ').trim();
  if(start.queue.status!=='attention'||start.queue.items[0]?.prompt!==prompts[0].prompt||normalized(editor.text)!==normalized(prompts[0].prompt))throw new Error('Flow contains an unrelated draft prompt. Save or clear it before recording.');
  // Only clear our verified pre-submission draft from the earlier failed setup.
  await api('command',{type:'fill',payload:{id:editor.id,value:''}});
}
const folder=path.join(root,'.local','demo-'+new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(folder,{recursive:true});
await fs.writeFile(path.join(folder,'before.json'),JSON.stringify({settings:start.settings,draftQueue:start.draftQueue,queue:start.queue}));
console.log('Checking the new project settings...');await api('discover',{});await api('cutris/status',{});
const current=await api('state');
if(!current.capabilities.models.includes('Nano Banana 2.1'))throw new Error('The demo model is not available. Choose a supported model before recording.');
const chosen={...current.capabilities.defaults,model:'Nano Banana 2.1',ratio:'1:1',count:1,resolution:'2K',removeBackground:true,cutrisQuality:'detail',cutrisMode:'white',autoCrop:true};
const output=await api('output/default');await api('settings',{outputFolder:output.folder,defaults:chosen,composerDefaults:chosen,draft:'',inputMode:'single',editingId:null});
await api('queue/clear',{});await api('draft',{revision:current.draftQueue.revision,items:[]});
const frames=path.join(folder,'frames'),assets=path.join(root,'docs','assets');await fs.mkdir(frames,{recursive:true});await fs.mkdir(assets,{recursive:true});
let executablePath;for(const base of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean)){const candidate=path.join(base,'Google','Chrome','Application','chrome.exe');try{await fs.access(candidate);executablePath=candidate;break;}catch{}}
const browser=desktopEndpoint?await chromium.connectOverCDP(desktopEndpoint,{isWebView:true}):await chromium.launch({executablePath,headless:true});
const page=desktopEndpoint?browser.contexts().flatMap(context=>context.pages()).find(page=>{try{return new URL(page.url()).origin===control.origin;}catch{return false;}}):await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
if(!page)throw new Error('The gflowris desktop renderer was not found.');
const errors=[];page.on('pageerror',error=>errors.push(error.message));
if(desktopEndpoint)await page.reload();else await page.goto(control.origin+'/?demo=1#key='+control.token);
await page.locator('#model').selectOption(chosen.model);await page.getByText('Flow connected',{exact:true}).waitFor();
await page.locator('[data-workspace-tab="queue"]').click();await page.locator('#queue-empty').waitFor();
const windowRecordings=process.argv.includes('--record-windows')?await startWindowRecordings(folder):null;
let recording=true,interval=120,frame=0;
const capture=(async()=>{while(recording){await page.screenshot({path:path.join(frames,String(frame++).padStart(6,'0')+'.png')});await pause(interval);}})();
let lastState;
try{
  await pause(1800);
  await page.locator('#prompts').fill(prompts[0].prompt);await pause(2000);await page.locator('#add-prompt').click();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===1);await pause(1300);
  await page.locator('#ratio').selectOption(prompts[1].ratio);await page.locator('#prompts').fill(prompts[1].prompt);await pause(2000);await page.locator('#add-prompt').click();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===2);await pause(1300);
  await page.locator('#import-json').click();await page.locator('#bulk-source').fill(JSON.stringify(prompts[2],null,2));
  for(const prompt of prompts.slice(3)){await page.locator('#bulk-source').press('Control+End');await page.locator('#bulk-insert-separator').click();await page.locator('#bulk-source').press('Control+End');await page.keyboard.insertText(JSON.stringify(prompt,null,2));}
  await pause(1300);await page.screenshot({path:path.join(assets,'import.png')});await page.locator('#confirm-import').click();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===5);
  await pause(4000);await page.screenshot({path:path.join(assets,'queue.png')});
  await page.locator('.prompt-card').last().scrollIntoViewIfNeeded();await pause(1200);await page.locator('#draft-list').evaluate(element=>element.scrollTop=0);await pause(1200);
  console.log('Starting five mixed prompts at 2K. One run; no automatic generation retries.');
  if(windowRecordings)windowRecordings.timeline={generationStarted:Date.now()};
  await page.locator('#run').click();interval=1000;
  let last='',sawRunning=false;const beginning=Date.now(),deadline=Date.now()+35*60*1000;
  while(Date.now()<deadline){
    lastState=await api('state');const signature=lastState.queue.status+': '+lastState.queue.message;
    if(signature!==last){console.log(signature);last=signature;}
    if(lastState.queue.status==='running')sawRunning=true;
    if(!sawRunning&&lastState.queue.status==='idle'&&Date.now()-beginning>20000)throw new Error('The queue did not start. '+await page.locator('#message').textContent());
    if(lastState.queue.status==='attention')throw new Error(lastState.queue.message);
    if(['cancelled','paused'].includes(lastState.queue.status))throw new Error('Demo stopped: '+lastState.queue.message);
    if(lastState.queue.status==='complete'&&lastState.queue.items.length===5)break;
    await pause(1600);
  }
  if(lastState?.queue.status!=='complete')throw new Error('Demo timeout. Check Flow before any further generation.');
  if(windowRecordings)windowRecordings.timeline.generationFinished=Date.now();
  interval=120;await page.waitForFunction(()=>{const images=[...document.querySelectorAll('.image-card img')];return images.length===5&&images.every(image=>image.complete&&image.naturalWidth>0);});await pause(1500);await page.screenshot({path:path.join(assets,'results.png')});
  const person=page.locator('.job').filter({hasText:'Person in front of a building'});
  const target=person.locator('.image-card img');
  if(await target.count()){await target.scrollIntoViewIfNeeded();await target.click();await page.waitForFunction(()=>document.querySelector('#preview-image')?.naturalWidth>0);await pause(1500);await page.screenshot({path:path.join(assets,'cutout-preview.png')});await page.locator('#preview-original').click();await pause(1000);await page.locator('#preview-cutout').click();await pause(1200);await page.locator('#preview-close').click();}
  await page.locator('#jobs').evaluate(element=>element.scrollTop=0);await pause(1600);
  if(errors.length)throw new Error('Renderer errors: '+errors.join('; '));
  await fs.writeFile(path.join(folder,'result.json'),JSON.stringify({ok:true,fps:10,frames:frame,queue:lastState.queue,outputFolder:output.folder},null,2));
}finally{recording=false;await capture;await windowRecordings?.stop();if(!desktopEndpoint)await browser.close();}
async function encode(args){const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{windowsHide:true,stdio:'inherit'});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code?reject(new Error('Video encoding failed: '+code)):resolve());});}
const input=['-framerate','10','-i',path.join(frames,'%06d.png')];
await encode([...input,'-vf','scale=1120:-2:flags=lanczos','-c:v','libx264','-preset','medium','-crf','23','-pix_fmt','yuv420p','-r','10','-map_metadata','-1','-movflags','+faststart',path.join(assets,'workflow.mp4')]);
await encode([...input,'-filter_complex','[0:v]scale=1120:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle','-loop','0','-map_metadata','-1',path.join(assets,'workflow.gif')]);
if(windowRecordings)await encodeWindowRecordings(windowRecordings,assets,encode);
if(desktopEndpoint){await page.evaluate(()=>window.pywebview.api.finish_recording()).catch(()=>{});await new Promise(resolve=>{if(!browser.isConnected())resolve();else {browser.once('disconnected',resolve);setTimeout(resolve,4000);}});await browser.close().catch(()=>{});}
console.log('Recorded '+frame+' frames. GIF and MP4 saved under docs/assets.');
