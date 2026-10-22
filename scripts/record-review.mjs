// Record an already-saved batch and a real Cutris edit. Never generates images.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const control=JSON.parse(await fs.readFile(path.join(root,'.local/state/control.json'),'utf8'));
const api=async()=>{const response=await fetch(control.origin+'/api/state',{headers:{Authorization:'Bearer '+control.token}});if(!response.ok)throw new Error('The saved queue is unavailable.');return response.json();};
const before=await api();if(before.queue.status!=='complete'||before.postProcessing||before.preparing)throw new Error('Finish the current queue before recording its review.');
const targetItem=before.queue.items.find(item=>item.title==='Ceramic teapot product photo');if(!targetItem?.files[0]?.cutout)throw new Error('The saved teapot cutout was not found.');
const original=targetItem.files[0],previous=original.cutout,hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const originalHash=hash(await fs.readFile(original.path)),previousHash=hash(await fs.readFile(previous.path));
const folder=path.join(root,'.local','review-'+new Date().toISOString().replace(/[:.]/g,'-')),frames=path.join(folder,'frames'),assets=path.join(root,'docs/assets');await fs.mkdir(frames,{recursive:true});
await fs.copyFile(path.join(assets,'desktop.mp4'),path.join(folder,'desktop-before.mp4'));
const browser=await chromium.connectOverCDP('http://127.0.0.1:9422',{isWebView:true});
const page=browser.contexts().flatMap(context=>context.pages()).find(page=>{try{return new URL(page.url()).origin===control.origin;}catch{return false;}});if(!page)throw new Error('Open the native recording workspace first.');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.locator('[data-workspace-tab="images"]').click();await page.waitForFunction(()=>document.querySelectorAll('.image-card img').length===5&&[...document.querySelectorAll('.image-card img')].every(image=>image.complete&&image.naturalWidth));
await page.locator('#jobs').evaluate(element=>element.scrollTop=0);
let recording=true,frame=0;
const capture=(async()=>{while(recording){try{await page.screenshot({path:path.join(frames,String(frame).padStart(6,'0')+'.png')});frame++;}catch(error){if(!recording)break;}await pause(100);}})();
async function scrollBottom(){await page.locator('#jobs').evaluate(async element=>{const from=element.scrollTop,to=element.scrollHeight-element.clientHeight,start=performance.now();await new Promise(resolve=>{function step(now){const progress=Math.min(1,(now-start)/1400),eased=progress<.5?2*progress*progress:1-Math.pow(-2*progress+2,2)/2;element.scrollTop=from+(to-from)*eased;progress<1?requestAnimationFrame(step):resolve();}requestAnimationFrame(step);});});}
let after;
try{
  await pause(2000);await scrollBottom();await pause(4200);await page.screenshot({path:path.join(assets,'results-bottom.png')});
  const landscape=page.locator('.job').filter({hasText:'Alpine valley landscape'});
  await landscape.locator('.image-card img').click();await page.waitForFunction(()=>document.querySelector('#preview-image').complete&&document.querySelector('#preview-image').naturalWidth>0);await pause(3000);await page.screenshot({path:path.join(assets,'landscape-preview.png')});await page.locator('#preview-close').click();await pause(1000);
  const teapot=page.locator('.job').filter({hasText:'Ceramic teapot product photo'});await teapot.getByRole('button',{name:'Edit in Cutris',exact:true}).click();
  await page.locator('#geometryButton').waitFor();await page.waitForFunction(()=>typeof state!=='undefined'&&state.automatic&&typeof window.pywebview?.api?.return_to_workspace==='function'&&!document.querySelector('#returnToWorkspace').hidden);await pause(2500);await page.screenshot({path:path.join(assets,'cutris-editor.png')});
  await page.locator('#geometryButton').click();await page.locator('#geometryDialog').waitFor();await pause(1500);
  const bounds=await page.evaluate(()=>({width:geometryState.source.width,height:geometryState.source.height,crop:{...geometryState.crop}}));
  const crop={x:Math.max(0,bounds.crop.x-24),y:Math.max(0,bounds.crop.y-24)};
  crop.width=Math.min(bounds.width,bounds.crop.x+bounds.crop.width+24)-crop.x;crop.height=Math.min(bounds.height,bounds.crop.y+bounds.crop.height+24)-crop.y;
  await page.locator('#geometryManualCrop').click();
  for(const [id,value]of Object.entries({geometryCropX:crop.x,geometryCropY:crop.y,geometryCropWidth:crop.width,geometryCropHeight:crop.height})){await page.locator('#'+id).fill(String(value));await pause(280);}
  await page.locator('#geometryResizeEnabled').check();await page.locator('#geometryResizeWidth').fill('1024');await pause(2500);await page.screenshot({path:path.join(assets,'cutris-crop.png')});
  const expectedHeight=Number(await page.locator('#geometryResizeHeight').inputValue());
  await page.locator('#geometryApply').click();await page.waitForFunction(()=>!document.querySelector('#geometryDialog').open&&!state.busy);await pause(2500);
  await page.locator('#returnToWorkspace').click();await page.locator('#jobs').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.image-card img').length===5&&[...document.querySelectorAll('.image-card img')].every(image=>image.complete&&image.naturalWidth));
  await scrollBottom();const updated=page.locator('.job').filter({hasText:'Ceramic teapot product photo'});await updated.locator('.image-card img').evaluate(image=>{if(image.naturalWidth!==1024)throw new Error('The updated PNG was not displayed.');});await pause(4000);await page.screenshot({path:path.join(assets,'edited-result.png')});
  await updated.locator('.image-card img').click();await page.waitForFunction(()=>document.querySelector('#preview-image').naturalWidth===1024);await pause(2800);await page.locator('#preview-close').click();await pause(2200);
  after=await api();const changed=after.queue.items.find(item=>item.id===targetItem.id).files[0];
  if(changed.cutout.width!==1024||changed.cutout.height!==expectedHeight||changed.cutout.path===previous.path||hash(await fs.readFile(changed.path))!==originalHash||hash(await fs.readFile(previous.path))!==previousHash)throw new Error('Saved edit or original-preservation verification failed.');
  if(errors.length)throw new Error(errors.join('; '));
  await fs.writeFile(path.join(folder,'result.json'),JSON.stringify({ok:true,frames:frame,crop,dimensions:[changed.cutout.width,changed.cutout.height],originalPreserved:true,previousCutoutPreserved:true,projectId:changed.cutout.projectId},null,2));
}finally{recording=false;await capture;}
async function encode(args){const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{windowsHide:true,stdio:'inherit'});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code?reject(new Error('Encoding failed: '+code)):resolve());});}
await encode(['-framerate','10','-i',path.join(frames,'%06d.png'),'-vf','scale=1120:676:flags=lanczos,setsar=1','-c:v','libx264','-preset','medium','-crf','23','-pix_fmt','yuv420p','-map_metadata','-1','-movflags','+faststart',path.join(assets,'cutris-editing.mp4')]);
await encode(['-i',path.join(folder,'desktop-before.mp4'),'-i',path.join(assets,'cutris-editing.mp4'),'-filter_complex','[0:v]setpts=PTS-STARTPTS,setsar=1,fps=10[a];[1:v]setpts=PTS-STARTPTS,setsar=1,fps=10[b];[a][b]concat=n=2:v=1:a=0[out]','-map','[out]','-c:v','libx264','-preset','medium','-crf','23','-pix_fmt','yuv420p','-map_metadata','-1','-movflags','+faststart',path.join(folder,'desktop-complete.mp4')]);
await fs.copyFile(path.join(folder,'desktop-complete.mp4'),path.join(assets,'desktop.mp4'));await fs.copyFile(path.join(assets,'desktop.mp4'),path.join(assets,'workflow.mp4'));
await encode(['-i',path.join(assets,'desktop.mp4'),'-filter_complex','[0:v]scale=960:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle','-r','10','-loop','0','-map_metadata','-1',path.join(assets,'workflow.gif')]);
await page.evaluate(()=>window.pywebview.api.finish_recording());await new Promise(resolve=>{browser.once('disconnected',resolve);setTimeout(resolve,3000);});await browser.close().catch(()=>{});
console.log(JSON.stringify({ok:true,frames:frame,allFiveImagesShown:true,editedCutoutWidth:1024,originalsPreserved:true,additionalGenerations:0}));
