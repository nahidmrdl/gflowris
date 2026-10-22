import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('workspace edits and imports cards, saves distinct settings, refreshes PNG pixels, and clears the view without deleting files',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'gflowris-workspace-'));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCzkAAAAASUVORK5CYII=','base64');
  const original=path.join(temp,'original.png'),cutout=path.join(temp,'cutout.png'),keyFile=path.join(temp,'key');
  await Promise.all([fs.writeFile(original,png),fs.writeFile(cutout,png),fs.writeFile(keyFile,'a'.repeat(48))]);
  let revision=0,result=png,width=1,height=1;
  const engine=http.createServer((req,res)=>{
    if(req.headers.authorization!=='Bearer '+'a'.repeat(48)){res.writeHead(401);res.end();return;}
    res.setHeader('Cache-Control','no-store');
    if(req.url.endsWith('/result')){res.writeHead(200,{'Content-Type':'image/png','X-Cutris-Revision':String(revision),'X-Cutris-Width':String(width),'X-Cutris-Height':String(height)});res.end(result);return;}
    const value=req.url==='/v1/health'?{name:'cutris',api_version:1,editor_available:false}:req.url==='/v1/models'?{models:{detail:true,fast:true}}:{revision,width,height};res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
  });
  await new Promise(resolve=>engine.listen(0,'127.0.0.1',resolve));
  const descriptor=path.join(temp,'cutris-service.json');
  await fs.writeFile(descriptor,JSON.stringify({name:'cutris',api_version:1,owner:'gflowris',source:'desktop',origin:'http://127.0.0.1:'+engine.address().port,key_file:keyFile,data_dir:temp}));
  const itemId='11111111-1111-4111-8111-111111111111';
  await fs.writeFile(path.join(temp,'last-queue.json'),JSON.stringify({status:'complete',current:null,message:'Saved',items:[{id:itemId,index:1,prompt:'Synthetic fixture',status:'complete',stage:'Saved',count:1,model:'Fixture model',ratio:'1:1',resolution:'2K',files:[{name:'original.png',path:original,cutout:{name:'cutout.png',path:cutout,projectId:'a'.repeat(32),revision:0,width:1,height:1,dataDir:temp,serviceDescriptor:descriptor}}]}]}));
  const port=4323,base='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,[path.join(root,'src','server.mjs'),'--no-open'],{cwd:root,env:{...process.env,FLOW_PROTO_PORT:String(port),FLOW_PROTO_STATE_DIR:temp},windowsHide:true,stdio:'pipe'});
  let stderr='';child.stderr.on('data',data=>stderr+=data);
  t.after(async()=>{child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('close',resolve));await new Promise(resolve=>engine.close(resolve));assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));assert(path.basename(temp).startsWith('gflowris-workspace-'));await fs.rm(temp,{recursive:true,force:true});});
  let control;for(let i=0;i<600;i++){try{control=JSON.parse(await fs.readFile(path.join(temp,'control.json'),'utf8'));break;}catch{if(child.exitCode!==null)throw new Error(stderr);await pause(50);}}assert(control,stderr||'Companion startup exceeded 30 seconds.');
  const api=async(route,data)=>{const response=await fetch(base+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+control.token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});assert(response.ok,await response.clone().text());return response.json();};
  const origin='chrome-extension://'+'b'.repeat(32);const before=await api('state');
  const paired=await fetch(base+'/bridge/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({code:before.pairCode})});const token=(await paired.json()).token;
  const bridge=()=>fetch(base+'/bridge/poll',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({tabId:5,snapshot:{version:'0.3.1',controls:[],page:'https://flow.google.com/project/fixture'}})});
  await bridge();const heartbeat=setInterval(bridge,1500);t.after(()=>clearInterval(heartbeat));
  await api('capabilities',{models:['Fixture model'],ratios:['1:1','16:9','4:3','3:4'],counts:[1,2,3,4],resolutions:['1K','2K'],defaults:{model:'Fixture model',ratio:'1:1',count:1,resolution:'2K'}});
  await api('settings',{outputFolder:path.join(temp,'gflowris-images')});
  let executablePath;for(const folder of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean)){const candidate=path.join(folder,'Google','Chrome','Application','chrome.exe');try{await fs.access(candidate);executablePath=candidate;break;}catch{}}
  const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/#key='+control.token);await page.locator('#model').selectOption('Fixture model');
  await page.locator('#prompts').fill('One prompt\n\nWith a second paragraph.');await page.locator('#add-prompt').click();await page.locator('.prompt-card').first().waitFor();
  assert.equal((await api('state')).draftQueue.items.length,1);
  await page.locator('#ratio').selectOption('16:9');await page.locator('#prompts').fill('Second prompt');await page.locator('#add-prompt').click();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===2);
  let cards=(await api('state')).draftQueue.items;assert.equal(cards[0].ratio,'1:1');assert.equal(cards[1].ratio,'16:9');
  await page.locator('.prompt-card').first().getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#prompts').fill('Updated first\n\nStill one prompt.');await page.locator('#add-prompt').click();
  await page.locator('.prompt-card').first().getByRole('button',{name:'Duplicate',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===3);
  await page.getByRole('button',{name:'Move prompt 2 down',exact:true}).click();
  await page.locator('.prompt-card').last().getByRole('button',{name:'Remove',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===2);
  await page.locator('#import-json').click();await page.locator('#bulk-source').fill('{"prompt":"Third prompt","ratio":"3:4","count":2}');await page.locator('#bulk-source').press('Control+End');await page.locator('#bulk-insert-separator').click();
  assert((await page.locator('#bulk-source').inputValue()).includes('\n---PROMPT---\n'));
  await page.locator('#bulk-source').press('Control+End');await page.locator('#bulk-source').pressSequentially('{"prompt":"Fourth prompt","ratio":"1:1"}',{delay:0});
  await page.locator('#confirm-import').click();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===4);
  cards=(await api('state')).draftQueue.items;assert.equal(cards[2].count,2);assert.equal(cards[2].ratio,'3:4');assert.equal(cards[3].ratio,'1:1');
  await page.locator('#queue-select-all').click();assert.equal(await page.locator('.prompt-card>input:checked').count(),4);assert.equal(await page.locator('#queue-select-all').textContent(),'Deselect all');assert.equal(await page.locator('#prompt-selection-count').textContent(),'4 selected');
  await page.locator('#queue-select-all').click();assert.equal(await page.locator('.prompt-card>input:checked').count(),0);assert(await page.locator('#remove-prompts').isDisabled());
  await page.locator('#ratio').selectOption('4:3');await page.locator('.prompt-card>input').nth(0).check();await page.locator('.prompt-card>input').nth(1).check();await page.locator('#apply-settings').click();
  for(const input of await page.locator('#apply-fields input').all())if(await input.inputValue()!=='ratio')await input.uncheck();await page.locator('#confirm-apply').click();
  await page.waitForFunction(()=>!document.querySelector('#apply-dialog').open);cards=(await api('state')).draftQueue.items;assert.equal(cards[0].ratio,'4:3');assert.equal(cards[1].ratio,'4:3');assert.equal(cards[2].ratio,'3:4');
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===4);
  await page.locator('[data-workspace-tab="queue"]').click();
  for(const viewport of [{width:1440,height:900},{width:1280,height:720},{width:1024,height:680},{width:730,height:900}]){
    await page.setViewportSize(viewport);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    for(const selector of ['#run','#cancel','#queue-select-all','#remove-prompts','#clear-queue','#add-prompt','#cutris-quality','#cutris-mode','#ratio','#count','#resolution']){const box=await page.locator(selector).boundingBox();assert(box&&box.x>=0&&box.x+box.width<=viewport.width&&(viewport.width<901||box.y+box.height<=viewport.height),selector+' fits '+viewport.width);}
  }
  await page.setViewportSize({width:1440,height:900});await page.locator('[data-workspace-tab="queue"]').click();const diagnostics=path.join(root,'.local','diagnostics');await fs.mkdir(diagnostics,{recursive:true});await page.screenshot({path:path.join(diagnostics,'queue-workspace-check.png')});
  await page.locator('[data-workspace-tab="images"]').click();await page.waitForFunction(()=>document.querySelector('.image-card img')?.naturalWidth===1);
  const newer=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=12;canvas.height=7;canvas.getContext('2d').fillRect(0,0,12,7);return canvas.toDataURL('image/png').split(',')[1];});
  result=Buffer.from(newer,'base64');width=12;height=7;revision=1;
  await page.getByRole('button',{name:'Update PNG',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.image-card img')?.naturalWidth===12);
  await page.locator('.image-card img').click();await page.waitForFunction(()=>document.querySelector('#preview-image')?.naturalHeight===7);await page.locator('#preview-close').click();
  const imageResponse=await fetch(base+'/api/image?item='+itemId+'&index=0&variant=cutout',{headers:{Authorization:'Bearer '+control.token}});assert.equal(imageResponse.headers.get('cache-control'),'no-store');
  await page.locator('#clear-images').click();await page.waitForFunction(()=>document.querySelector('#jobs').classList.contains('empty'));
  assert.equal((await api('state')).queue.items.length,0);assert.equal((await api('state')).draftQueue.items.length,4);assert(await fs.stat(original));assert(await fs.stat(cutout));
  assert.equal(JSON.parse(await fs.readFile(path.join(temp,'last-queue.json'),'utf8')).items.length,0);
  await page.reload();await page.locator('[data-workspace-tab="images"]').click();assert.equal(await page.locator('.image-card').count(),0);
  await page.locator('#history-open').click();await page.locator('#history-list button').first().click();await page.waitForFunction(()=>document.querySelector('.image-card img')?.naturalWidth===12);
  await page.locator('[data-workspace-tab="queue"]').click();
  const retained=(await api('state')).draftQueue.items;
  await page.locator('.prompt-card>input').nth(0).check();await page.locator('.prompt-card>input').nth(2).check();await page.locator('#remove-prompts').click();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===2);
  assert.deepEqual((await api('state')).draftQueue.items.map(item=>item.id),[retained[1].id,retained[3].id]);assert(await page.locator('#prompt-selection-count').isHidden());
  await page.locator('.prompt-card').first().getByRole('button',{name:'Edit',exact:true}).click();const editedText=await page.locator('#prompts').inputValue();
  await page.locator('#clear-queue').click();await page.waitForFunction(()=>document.querySelectorAll('.prompt-card').length===0);
  assert.equal(await page.locator('#composer-title').textContent(),'New prompt');assert.equal(await page.locator('#prompts').inputValue(),editedText,'clearing queued cards preserves unsaved composer text');assert(await page.locator('#cancel-prompt-edit').isHidden());
  for(const selector of ['#run','#clear-queue','#queue-select-all','#remove-prompts'])assert(await page.locator(selector).isDisabled(),selector+' disables for an empty queue');
  const cleared=await api('state');assert.equal(cleared.draftQueue.items.length,0);assert.equal(cleared.queue.items[0].files.length,1);assert(await fs.stat(original));assert(await fs.stat(cutout));assert((await api('history')).items.length);
  await page.reload();await page.locator('[data-workspace-tab="queue"]').click();assert.equal(await page.locator('.prompt-card').count(),0);assert.equal((await api('state')).draftQueue.items.length,0);
  assert.deepEqual(errors,[]);
});
