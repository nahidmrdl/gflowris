import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ImageQueue,parsePrompts} from './jobs.mjs';
import {saveDownload} from './downloads.mjs';
import {matchFlowDownload} from './download-match.mjs';
import {syncSavedEdits} from './project-sync.mjs';
import {CutrisClient} from './cutris-client.mjs';
import {stateRoot} from './paths.mjs';
import {DEFAULT_PREFERENCES,validatePreferences} from './preferences.mjs';
import {defaultOutputFolder,prepareOutputFolder,displayOutputFolder} from './output-folder.mjs';
import {extensionInfo} from './extension-setup.mjs';
import {openWindowsFolder,chooseWindowsFolder} from './windows-folders.mjs';
import {DraftQueue} from './draft-queue.mjs';
import {cancellable,cancellationError,checkCancellation} from './cancellation.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.FLOW_PROTO_PORT||4317), origin=`http://127.0.0.1:${port}`;
let uiToken=crypto.randomBytes(32).toString('hex');
let pairCode=crypto.randomBytes(5).toString('hex').toUpperCase();
const supportedBridges=new Set(['0.1.3','0.1.4','0.2.0','0.2.1','0.3.0','0.3.1','0.3.2','0.3.3']);
supportedBridges.add(JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version);
const cutris=new CutrisClient(stateRoot);
let postProcessing=false,mutationInProgress=false;
const mutationRoutes=new Set(['/api/run','/api/download-existing','/api/resume','/api/history/select','/api/queue/clear','/api/discover','/api/command','/api/cutris/remove','/api/cutris/refresh','/api/cutris/sync','/api/cutris/batch','/api/reset-pairing','/api/capabilities']);
let postProgress=null,startingQueue=false,startingController=null;
let desktopSeen=0,focusRequest=0,settingsWrites=Promise.resolve();
let shuttingDown=false;
let extensionToken=null, extensionOrigin=null, lastSeen=0, snapshot=null, commands=[], pending=new Map();
let targetTab=null;
await fs.mkdir(stateRoot,{recursive:true});
const draftQueue=await new DraftQueue(path.join(stateRoot,'draft-queue.json')).load();
const controlFile=path.join(stateRoot,'control.json');
const sessionFile=path.join(stateRoot,'session.json');
try{const saved=JSON.parse(await fs.readFile(sessionFile,'utf8'));uiToken=saved.uiToken||uiToken;extensionToken=saved.extensionToken;extensionOrigin=saved.extensionOrigin;}catch{}
async function saveSession(){await fs.writeFile(sessionFile,JSON.stringify({uiToken,extensionToken,extensionOrigin}));}
const defaultFolder=await defaultOutputFolder();
let settings={outputFolder:defaultFolder,...structuredClone(DEFAULT_PREFERENCES)};
try{settings={...settings,...JSON.parse(await fs.readFile(path.join(stateRoot,'settings.json'),'utf8'))};}catch{}
let capabilities={ready:false,models:[],ratios:[],counts:[1],resolutions:[],reason:'Inspect Flow to discover available image settings.'};
try{capabilities={...capabilities,...JSON.parse(await fs.readFile(path.join(stateRoot,'capabilities.json'),'utf8'))};}catch{}
const downloads=new Map();
let queueWrites=Promise.resolve();
async function archiveQueue(){
  const current=imageQueue.state;
  if(!current.items.length||current.status==='running')return;
  const id=current.items[0].id;if(!/^[0-9a-f-]{36}$/.test(id))return;
  const folder=path.join(stateRoot,'queues');await fs.mkdir(folder,{recursive:true});
  const temporary=path.join(folder,id+'.'+crypto.randomUUID()+'.tmp');
  await fs.writeFile(temporary,JSON.stringify(current));await fs.rename(temporary,path.join(folder,id+'.json'));
}
const imageQueue=new ImageQueue({
  generate:async(item,{signal})=>item.sourceAsset?{existing:item.sourceAsset}:command('generate',{item},45000,signal),
  generation:async(ticket,item,{signal})=>ticket.existing?{complete:true,assets:[ticket.existing]}:command('generation',{ticket,count:item.count},20000,signal),
  download:async(asset,item,index,{signal,onSaved,onStage})=>{
    const marker=`${item.id}-${index+1}`;
    const completion=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{downloads.delete(marker);reject(new Error('Download timed out. Check Flow and Chrome Downloads.'));},15*60*1000);
      downloads.set(marker,{resolve,reject,timer,folder:item.outputFolder,naming:{title:item.title,prompt:item.prompt,index,count:item.count},settled:false});
    });
    // Handle an early failure while the browser is still opening the download menu.
    completion.catch(()=>{});
    try{await command('download',{asset,item,index,marker},45000,signal);onStage?.('Waiting for the '+item.resolution+' download to finish');const saved=await cancellable(()=>completion,signal);onSaved?.(saved);onStage?.('Returning to the Flow project');await command('returnToProject',{},20000,signal);return saved;}
    catch(error){const waiting=downloads.get(marker);if(waiting){clearTimeout(waiting.timer);downloads.delete(marker);waiting.reject(error);}throw error;}
  },
  postprocess:async(file,item,{signal})=>cutris.remove(file,{quality:item.cutrisQuality,mode:item.cutrisMode,autoCrop:item.autoCrop,signal})
},{onChange:state=>{
  const serialized=JSON.stringify(state,null,2);
  queueWrites=queueWrites.then(async()=>{const temporary=path.join(stateRoot,'last-queue.tmp');await fs.writeFile(temporary,serialized);await fs.rename(temporary,path.join(stateRoot,'last-queue.json'));}).catch(()=>{});
}});
try{const previous=JSON.parse(await fs.readFile(path.join(stateRoot,'last-queue.json'),'utf8'));if(previous.items?.length){if(previous.status==='running'){previous.status='attention';previous.message='The companion restarted. Check Flow and saved files before creating another queue.';for(const item of previous.items)if(item.status==='running'){item.status='attention';item.stage='Interrupted; check Flow.';}}imageQueue.state=previous;}}catch{}
let syncing=false;
setInterval(async()=>{
  if(!desktopSeen||Date.now()-desktopSeen>=10000||syncing||mutationInProgress||imageQueue.running||postProcessing||startingQueue||!imageQueue.state.items.some(item=>item.files?.some(file=>file.cutout?.projectId)))return;
  syncing=true;mutationInProgress=true;
  try{const before=JSON.stringify(imageQueue.state);await syncSavedEdits(imageQueue.state,cutris);if(JSON.stringify(imageQueue.state)!==before)imageQueue.changed();}finally{syncing=false;mutationInProgress=false;}
},2500).unref();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const safeText=value=>String(value??'').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email hidden]').slice(0,1000);
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>1500000)throw new Error('Request too large.');}return data?JSON.parse(data):{};}
function auth(req,token){return token&&req.headers.authorization===`Bearer ${token}`;}
export function command(type,payload={},timeout=20000,signal){
  checkCancellation(signal);
  if(!extensionToken||Date.now()-lastSeen>10000) return Promise.reject(new Error('Connect the extension in your Flow project first.'));
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);pending.delete(id);commands=commands.filter(c=>c.id!==id);signal?.removeEventListener('abort',abort);};
    const fail=error=>{cleanup();reject(error);},abort=()=>fail(signal.reason||cancellationError());
    const timer=setTimeout(()=>fail(new Error('Flow did not respond. No action will be retried automatically.')),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    pending.set(id,{resolve:value=>{cleanup();resolve(value);},reject:fail,timer});commands.push({id,type,payload});
  });
}
function publicState(){return {connected:Date.now()-lastSeen<10000,paired:!!extensionToken,pairCode:extensionToken?null:pairCode,settings:{...settings,outputFolderDisplay:displayOutputFolder(settings.outputFolder)},snapshot,capabilities,draftQueue:draftQueue.state,queue:imageQueue.state,postProcessing,postProgress,preparing:startingQueue,desktopOpen:Date.now()-desktopSeen<10000,focusRequest,downloadStatus:[...downloads.entries()].filter(([,value])=>!value.settled).map(([marker,value])=>({marker,expected:value.identity?{title:value.identity.title,resolution:value.identity.resolution}:null,lastCandidate:value.lastCandidate||null}))};}
const server=http.createServer(async(req,res)=>{
  let reserved=false;
  try{
    if(shuttingDown){reply(res,503,{error:'gflowris is closing for setup.'});return;}
    if(req.headers.host!==`127.0.0.1:${port}`){reply(res,403,{error:'Invalid host.'});return;}
    const url=new URL(req.url,origin),requestOrigin=req.headers.origin;
    const isExtension=/^chrome-extension:\/\/[a-p]{32}$/.test(requestOrigin||'');
    if(requestOrigin&&requestOrigin!==origin&&!isExtension){reply(res,403,{error:'Origin rejected.'});return;}
    if(isExtension){
      if(extensionOrigin&&requestOrigin!==extensionOrigin){reply(res,403,{error:'Another extension is paired.'});return;}
      res.setHeader('Access-Control-Allow-Origin',requestOrigin);
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
      res.setHeader('Vary','Origin');
    }
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    if(url.pathname==='/native/connect'&&req.method==='POST'){
      const registration=JSON.parse((await fs.readFile(path.join(stateRoot,'native-registration.json'),'utf8')).replace(/^\uFEFF/,''));
      if(!isExtension||registration.origin!==requestOrigin+'/'||!auth(req,uiToken)){reply(res,403,{error:'This extension is not registered for Native Messaging.'});return;}
      if(extensionOrigin&&extensionOrigin!==requestOrigin&&(imageQueue.running||pending.size))throw new Error('Wait for the active operation before changing the connected extension.');
      extensionOrigin=requestOrigin;extensionToken=extensionToken||crypto.randomBytes(32).toString('hex');await saveSession();reply(res,200,{token:extensionToken});return;
    }
    if(url.pathname==='/bridge/pair'&&req.method==='POST'){
      const data=await body(req);
      if(!isExtension||extensionToken||data.code!==pairCode){reply(res,403,{error:'This connection request is invalid or expired. Reconnect your project from gflowris bridge.'});return;}
      extensionOrigin=requestOrigin;extensionToken=crypto.randomBytes(32).toString('hex');await saveSession();
      reply(res,200,{token:extensionToken});return;
    }
    if(url.pathname==='/bridge/download'&&req.method==='POST'){
      if(!isExtension||requestOrigin!==extensionOrigin||!auth(req,extensionToken)){reply(res,401,{error:'Extension is not paired.'});return;}
      const data=await body(req),waiting=downloads.get(data.marker);
      if(!waiting){reply(res,409,{error:'This download is not associated with an active job.'});return;}
      if(waiting.settled){reply(res,200,{ok:true});return;}waiting.settled=true;
      try{
        if(data.error)throw new Error(safeText(data.error));
        const saved=await saveDownload(data.filename,waiting.folder,data.marker,{...waiting.naming,flowTitle:waiting.identity?.title});clearTimeout(waiting.timer);waiting.resolve(saved);reply(res,200,{ok:true});
      }catch(error){clearTimeout(waiting.timer);waiting.reject(error);reply(res,400,{error:safeText(error.message)});}
      return;
    }
    if(url.pathname==='/bridge/select-tab'&&req.method==='POST'){
      if(!isExtension||requestOrigin!==extensionOrigin||!auth(req,extensionToken)){reply(res,401,{error:'The Flow connection is unavailable. Reconnect your project from gflowris bridge.'});return;}
      if(imageQueue.running||pending.size)throw new Error('Wait for the active Flow operation before changing tabs.');
      const data=await body(req),page=new URL(data.page);
      if(!Number.isSafeInteger(data.tabId)||data.tabId<0||page.protocol!=='https:'||!(page.hostname==='flow.google.com'||page.hostname==='labs.google'&&page.pathname.startsWith('/fx/')))throw new Error('Select a Flow tab.');
      targetTab=data.tabId;snapshot=null;lastSeen=0;reply(res,200,{ok:true});return;
    }
    if(['/bridge/arm','/bridge/candidate'].includes(url.pathname)&&req.method==='POST'){
      if(!isExtension||requestOrigin!==extensionOrigin||!auth(req,extensionToken)){reply(res,401,{error:'Extension is not paired.'});return;}
      const data=await body(req),waiting=downloads.get(data.marker);if(!waiting){reply(res,409,{error:'No active image is waiting for this download.'});return;}
      if(url.pathname==='/bridge/arm'){
        if(typeof data.title!=='string'||!data.title.trim()||data.title.length>500||!['1K','2K','4K'].includes(data.resolution)||!Number.isFinite(data.started))throw new Error('Invalid image download identity.');
        waiting.identity={title:data.title,resolution:data.resolution,page:data.page,sourceOrigin:data.sourceOrigin,started:data.started};reply(res,200,{ok:true});
      }else{const decision=matchFlowDownload(data.item,waiting.identity);waiting.lastCandidate={...decision,referrerOrigin:data.item.referrerOrigin,sourceOrigin:data.item.sourceOrigin};reply(res,200,decision);}
      return;
    }
    if(url.pathname==='/bridge/poll'&&req.method==='POST'){
      if(!isExtension||requestOrigin!==extensionOrigin||!auth(req,extensionToken)){reply(res,401,{error:'Pair the extension with the code on the dashboard.'});return;}
      const data=await body(req);
      if(targetTab!==null&&targetTab!==data.tabId){reply(res,409,{error:'Use the selected Flow tab.'});return;}
      targetTab=data.tabId;lastSeen=Date.now();
      if(data.snapshot)snapshot=data.snapshot;
      for(const item of data.results||[]){const p=pending.get(item.id);if(p){clearTimeout(p.timer);pending.delete(item.id);item.error?p.reject(new Error(safeText(item.error))):p.resolve(item.result);}}
      reply(res,200,{command:commands.shift()||null,queue:{id:imageQueue.state.items[0]?.id||null,status:imageQueue.state.status},activeDownloadMarkers:[...downloads.entries()].filter(([,value])=>!value.settled).map(([marker])=>marker)});return;
    }
    if(url.pathname==='/bridge/command-state'&&req.method==='POST'){
      if(!isExtension||requestOrigin!==extensionOrigin||!auth(req,extensionToken)){reply(res,401,{error:'Extension is not paired.'});return;}
      const data=await body(req);if(data.tabId!==targetTab||!/^[-a-f0-9]{36}$/.test(data.id||''))throw new Error('Choose the paired Flow command.');
      reply(res,200,{active:pending.has(data.id)});return;
    }
    if(url.pathname.startsWith('/api/')){
      if(!auth(req,uiToken)){reply(res,401,{error:'Open the dashboard using Start.cmd.'});return;}
      if(req.method==='POST'&&mutationRoutes.has(url.pathname)){if(mutationInProgress)throw new Error('Wait for the current operation to finish.');mutationInProgress=true;reserved=true;}
      if(url.pathname==='/api/state'&&req.method==='GET'){reply(res,200,publicState());return;}
      if(url.pathname==='/api/shutdown'&&req.method==='POST'){
        if(isExtension||Date.now()-desktopSeen<10000||imageQueue.running||postProcessing||startingQueue||mutationInProgress||pending.size||syncing){reply(res,409,{error:'Save edits, stop the queue, and close gflowris before running setup.'});return;}
        shuttingDown=true;
        await Promise.allSettled([queueWrites,settingsWrites,draftQueue.writes]);
        reply(res,200,{ok:true});
        server.close(()=>process.exit(0));server.closeIdleConnections();
        // A stale connection must not keep installation files open indefinitely.
        setTimeout(()=>{server.closeAllConnections();process.exit(0);},1500).unref();return;
      }
      if(url.pathname==='/api/cancel'&&req.method==='POST'){
        const data=await body(req),wasPreparing=startingQueue||data.preparing===true;
        startingController?.abort(cancellationError());
        const cancelled=imageQueue.cancel(wasPreparing);
        // Cancel bypasses the mutation reservation so it can interrupt setup or processing.
        if(imageQueue.running)await imageQueue.running;await queueWrites;
        reply(res,200,{ok:true,cancelled});return;
      }
      if(url.pathname==='/api/output/default'&&req.method==='GET'){reply(res,200,{folder:defaultFolder});return;}
      if(url.pathname==='/api/draft'&&req.method==='POST'){
        if(imageQueue.running||postProcessing||startingQueue)throw new Error('Wait for the current operation before editing prompts.');
        reply(res,200,await draftQueue.update(await body(req)));return;
      }
      if(url.pathname==='/api/extension/info'&&req.method==='GET'){reply(res,200,await extensionInfo());return;}
      if(url.pathname==='/api/queue/clear'&&req.method==='POST'){
        if(imageQueue.running||postProcessing||startingQueue||pending.size)throw new Error('Wait for the current operation before clearing images.');
        await archiveQueue();
        imageQueue.state={status:'idle',items:[],current:null,message:'Images cleared from this view. Your files are kept on disk and in Recent queues.'};
        imageQueue.pauseRequested=false;imageQueue.changed();await queueWrites;
        reply(res,200,{ok:true});return;
      }
      if(url.pathname==='/api/history'&&req.method==='GET'){
        await archiveQueue();const folder=path.join(stateRoot,'queues');let files=[];try{files=await fs.readdir(folder);}catch{}
        const items=[];
        for(const name of files.filter(name=>/^[0-9a-f-]{36}\.json$/.test(name))){try{const queue=JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));if(queue.items?.length)items.push({id:name.slice(0,-5),prompt:queue.items[0].prompt.slice(0,110),created:queue.items[0].startedAt||queue.items[0].finishedAt||new Date(0).toISOString(),count:queue.items.reduce((sum,item)=>sum+(item.files?.length||0),0),status:queue.status});}catch{}}
        reply(res,200,{items:items.sort((a,b)=>b.created.localeCompare(a.created)).slice(0,30)});return;
      }
      if(url.pathname==='/api/history/select'&&req.method==='POST'){
        if(imageQueue.running||postProcessing||startingQueue)throw new Error('Wait for the current operation before changing queues.');
        const data=await body(req);if(!/^[0-9a-f-]{36}$/.test(data.id||''))throw new Error('Choose a saved queue.');
        const saved=JSON.parse(await fs.readFile(path.join(stateRoot,'queues',data.id+'.json'),'utf8'));
        if(!saved.items?.length||saved.status==='running')throw new Error('This queue is not available for review.');
        await archiveQueue();imageQueue.state=saved;imageQueue.changed();reply(res,200,{ok:true});return;
      }
      if(url.pathname==='/api/desktop/heartbeat'&&req.method==='POST'){const data=await body(req);desktopSeen=data.closed?0:Date.now();reply(res,200,{ok:true});return;}
      if(url.pathname==='/api/desktop/focus'&&req.method==='POST'){focusRequest=Date.now();reply(res,200,{desktopOpen:Date.now()-desktopSeen<10000});return;}
      if(url.pathname==='/api/reset-pairing'&&req.method==='POST'){
        if(imageQueue.running||pending.size)throw new Error('Wait for the active Flow operation before replacing its pairing.');
        extensionToken=null;extensionOrigin=null;targetTab=null;lastSeen=0;snapshot=null;pairCode=crypto.randomBytes(5).toString('hex').toUpperCase();await saveSession();reply(res,200,{ok:true});return;
      }
      if(url.pathname==='/api/discover'&&req.method==='POST'){
        if(imageQueue.running)throw new Error('Wait for the active prompt before checking Flow settings.');
        if(!supportedBridges.has(snapshot?.version))throw new Error('Reload the gflowris bridge extension in Chrome, then reload your Flow tab to activate the update.');
        const discovered=await command('discover',{},40000);capabilities={...discovered,ready:true};await fs.writeFile(path.join(stateRoot,'capabilities.json'),JSON.stringify(capabilities));reply(res,200,capabilities);return;
      }
      if(url.pathname==='/api/image'&&req.method==='GET'){
        const item=imageQueue.state.items.find(i=>i.id===url.searchParams.get('item'));
        const original=item?.files?.[Number(url.searchParams.get('index'))];
        const image=url.searchParams.get('variant')==='cutout'?original?.cutout:original;if(!image)throw new Error('Saved image not found.');
        const type=({'.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif'})[path.extname(image.path)];
        const bytes=await fs.readFile(image.path);
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return;
      }
      if(url.pathname==='/api/cutris/status'&&req.method==='POST'){reply(res,200,await cutris.status());return;}
      if(url.pathname==='/api/cutris/batch'&&req.method==='POST'){
        if(imageQueue.running||postProcessing||startingQueue)throw new Error('Wait for the current operation to finish.');
        const data=await body(req),quality=data.quality??'detail',mode=data.mode??'ai';
        if(!Array.isArray(data.targets)||!data.targets.length||data.targets.length>50||!['detail','fast'].includes(quality)||!['ai','white'].includes(mode)||typeof(data.autoCrop??true)!=='boolean')throw new Error('Select 1–50 saved images and valid Cutris settings.');
        const identities=new Set();const targets=data.targets.map(target=>{const id=target.item+':'+target.index;if(identities.has(id)||!Number.isInteger(target.index))throw new Error('Choose each saved image once.');identities.add(id);const item=imageQueue.state.items.find(item=>item.id===target.item),file=item?.files?.[target.index];if(!file)throw new Error('A selected image is unavailable.');return {item,file};});
        postProcessing=true;postProgress={done:0,total:targets.length};
        try{await cutris.preflight(quality);for(const {item,file}of targets){try{if(file.cutout){await syncSavedEdits(imageQueue.state,cutris,{projectId:file.cutout.projectId});file.cutoutHistory=[...(file.cutoutHistory||[]),file.cutout];}file.cutout=await cutris.remove(file,{quality,mode,autoCrop:data.autoCrop??true});delete file.cutrisError;postProgress.done++;imageQueue.changed();}catch(error){file.cutrisError=error.message;imageQueue.changed();throw error;}}reply(res,200,{ok:true,count:targets.length});}
        finally{postProcessing=false;postProgress=null;}return;
      }
      if(url.pathname==='/api/cutris/sync'&&req.method==='POST'){
        if(imageQueue.running||postProcessing||startingQueue)throw new Error('Wait for the current operation to finish.');
        const data=await body(req);if(data.projectId&&!/^[a-f0-9]{32}$/.test(data.projectId))throw new Error('Choose a saved project.');
        postProcessing=true;try{const updates=await syncSavedEdits(imageQueue.state,cutris,{projectId:data.projectId||null});imageQueue.changed();reply(res,200,{ok:true,updates});}finally{postProcessing=false;}return;
      }
      if(url.pathname==='/api/cutris/editor'&&req.method==='POST'){
        const data=await body(req),item=imageQueue.state.items.find(value=>value.id===data.item);
        const file=Number.isInteger(data.index)?item?.files?.[data.index]:null;if(!file?.cutout)throw new Error('Choose a finished cutout.');
        reply(res,200,await cutris.requestEditor(file.cutout));return;
      }
      if(url.pathname==='/api/cutris/refresh'&&req.method==='POST'){
        if(imageQueue.running||postProcessing||startingQueue)throw new Error('Wait for the current operation to finish.');
        const data=await body(req),item=imageQueue.state.items.find(value=>value.id===data.item);
        const file=Number.isInteger(data.index)?item?.files?.[data.index]:null;if(!file?.cutout)throw new Error('Choose a saved cutout.');
        postProcessing=true;
        try{file.cutout=await cutris.refresh(file.cutout);imageQueue.changed();reply(res,200,{ok:true,cutout:file.cutout});}
        finally{postProcessing=false;}return;
      }
      if(url.pathname==='/api/cutris/remove'&&req.method==='POST'){
        if(imageQueue.running||postProcessing||startingQueue)throw new Error('Wait for the current operation to finish.');
        const data=await body(req),item=imageQueue.state.items.find(value=>value.id===data.item);
        const file=Number.isInteger(data.index)?item?.files?.[data.index]:null;if(!file)throw new Error('Choose a saved image.');
        const quality=data.quality??'detail',mode=data.mode??'ai';
        if(!['detail','fast'].includes(quality)||!['ai','white'].includes(mode)||typeof (data.autoCrop??true)!=='boolean')throw new Error('Unknown Cutris setting.');
        postProcessing=true;
        try{if(file.cutout){await syncSavedEdits(imageQueue.state,cutris,{projectId:file.cutout.projectId});file.cutoutHistory=[...(file.cutoutHistory||[]),file.cutout];}file.cutout=await cutris.remove(file,{quality,mode,autoCrop:data.autoCrop??true});delete file.cutrisError;imageQueue.changed();reply(res,200,{ok:true,cutout:file.cutout});}
        catch(error){file.cutrisError=error.message;imageQueue.changed();throw error;}
        finally{postProcessing=false;}return;
      }
      if(url.pathname==='/api/command'&&req.method==='POST'){
        const data=await body(req);
        if(imageQueue.running)throw new Error('Wait for the active prompt before exploring controls.');
        if(!['inspect','describe','click','hover','fill','escape','returnToProject'].includes(data.type))throw new Error('Unknown command.');
        const result=await command(data.type,data.payload);reply(res,200,result);return;
      }
      if(url.pathname==='/api/capabilities'&&req.method==='POST'){
        if(imageQueue.running)throw new Error('Wait for the current queue.');
        const data=await body(req);
        for(const field of ['models','ratios','counts','resolutions'])if(!Array.isArray(data[field])||data[field].length>40)throw new Error('Invalid discovered settings.');
        capabilities={...data,ready:true};await fs.writeFile(path.join(stateRoot,'capabilities.json'),JSON.stringify(capabilities));reply(res,200,capabilities);return;
      }
      if(url.pathname==='/api/run'&&req.method==='POST'){
        if(!supportedBridges.has(snapshot?.version))throw new Error('Load the updated gflowris bridge before generating.');
        if(!capabilities.ready)throw new Error('Flow controls must be mapped before the first generation.');
        if(imageQueue.running||postProcessing||startingQueue)throw new Error('An operation is already running.');
        startingQueue=true;startingController=new AbortController();const signal=startingController.signal;
        try{
        const data=await body(req),items=parsePrompts(data.items?JSON.stringify(data.items):data.prompts,data.defaults,data.items?'json':data.mode||'auto');
        for(const quality of new Set(items.filter(item=>item.removeBackground).map(item=>item.cutrisQuality)))await cancellable(()=>cutris.preflight(quality),signal);
        for(const item of items){
          for(const [field,list] of [['model','models'],['ratio','ratios'],['count','counts'],['resolution','resolutions']])if(!capabilities[list].includes(item[field]))throw new Error(`Prompt ${item.index}: ${field} is not available in this Flow project.`);
          item.outputFolder=settings.outputFolder;
        }
        await prepareOutputFolder(settings.outputFolder);checkCancellation(signal);await archiveQueue();checkCancellation(signal);imageQueue.start(items);reply(res,202,{ok:true});
        }finally{startingQueue=false;startingController=null;}return;
      }
      if(url.pathname==='/api/download-existing'&&req.method==='POST'){
        if(imageQueue.running||postProcessing||startingQueue)throw new Error('An operation is already running.');
        if(!supportedBridges.has(snapshot?.version))throw new Error('Load the updated extension first.');
        startingQueue=true;startingController=new AbortController();const signal=startingController.signal;
        try{
        const data=await body(req);
        if(data.page!==snapshot.page||!snapshot.tiles?.some(tile=>tile.mediaIds.includes(data.mediaId)))throw new Error('Select an existing image in the current project grid.');
        if(!capabilities.resolutions.includes(data.resolution))throw new Error('This download size is not enabled for the account.');
        const [item]=parsePrompts(JSON.stringify([{prompt:data.prompt||'Save existing image',...capabilities.defaults,count:1,resolution:data.resolution}]));
        item.sourceAsset={mediaId:data.mediaId,page:data.page};item.outputFolder=settings.outputFolder;
        await prepareOutputFolder(settings.outputFolder);checkCancellation(signal);await archiveQueue();checkCancellation(signal);imageQueue.start([item]);reply(res,202,{ok:true});
        }finally{startingQueue=false;startingController=null;}return;
      }
      if(url.pathname==='/api/pause'&&req.method==='POST'){if(imageQueue.state.status!=='running')throw new Error('No running queue to pause.');imageQueue.pause();reply(res,200,{ok:true});return;}
      if(url.pathname==='/api/resume'&&req.method==='POST'){
        if(imageQueue.running||postProcessing||startingQueue||!['paused','cancelled','attention'].includes(imageQueue.state.status)||!imageQueue.state.items.some(item=>item.status!=='complete'))throw new Error('No interrupted queue to continue.');
        if(!supportedBridges.has(snapshot?.version))throw new Error('Load the updated gflowris bridge before continuing.');
        startingQueue=true;startingController=new AbortController();const signal=startingController.signal;
        try{
          const unfinished=imageQueue.state.items.filter(item=>item.status!=='complete');
          const originalPage=imageQueue.state.items.flatMap(item=>item.assets||[]).find(asset=>asset?.page)?.page||imageQueue.state.items.find(item=>item.generationTicket?.page)?.generationTicket.page;
          if(originalPage&&snapshot.page?.split('/edit/')[0]!==originalPage)throw new Error('Open the original Flow project before continuing this queue.');
          for(const quality of new Set(unfinished.filter(item=>item.removeBackground&&(item.files.length<item.count||item.files.some(file=>!file.cutout))).map(item=>item.cutrisQuality)))await cancellable(()=>cutris.preflight(quality),signal);
          for(const folder of new Set(unfinished.map(item=>item.outputFolder||settings.outputFolder))){await prepareOutputFolder(folder);checkCancellation(signal);}
          imageQueue.resume();reply(res,202,{ok:true});
        }finally{startingQueue=false;startingController=null;}return;
      }
      if(url.pathname==='/api/settings'&&req.method==='POST'){
        const data=await body(req);
        const saved=await(settingsWrites=settingsWrites.catch(()=>{}).then(async()=>{const updated=validatePreferences(data,settings);const temporary=path.join(stateRoot,'settings.tmp');await fs.writeFile(temporary,JSON.stringify(updated));await fs.rename(temporary,path.join(stateRoot,'settings.json'));settings=updated;return updated;}));
        reply(res,200,saved);return;
      }
      if(url.pathname==='/api/browse'&&req.method==='POST'){
        reply(res,200,await chooseWindowsFolder(settings.outputFolder));return;
      }
      if(url.pathname==='/api/open-folder'&&req.method==='POST'){
        reply(res,200,await openWindowsFolder(settings.outputFolder));return;
      }
      reply(res,404,{error:'Unknown API endpoint.'});return;
    }
    if(req.method!=='GET'){reply(res,405,{error:'Method not allowed.'});return;}
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!['index.html','app.js','queue-ui.js','prompt-input.js','prompt-help.js','style.css','assets/app-256.png','assets/favicon.ico'].includes(name)){reply(res,404,{error:'Not found.'});return;}
    const scripts=url.searchParams.get('desktop')==='1'?"'self' 'unsafe-eval'":"'self'";
    res.writeHead(200,{'Content-Type':mime[path.extname(name)],'Cache-Control':'no-store','Content-Security-Policy':`default-src 'self'; script-src ${scripts}; style-src 'self'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'`,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    res.end(await fs.readFile(path.join(root,'public',name)));
  }catch(error){if(!res.headersSent)reply(res,400,{error:safeText(error.message)});else res.end();}finally{if(reserved)mutationInProgress=false;}
});
server.listen(port,'127.0.0.1',async()=>{
  await saveSession();await fs.writeFile(controlFile,JSON.stringify({origin,token:uiToken,pid:process.pid}));
  console.log(`gflowris is running at ${origin}. Leave this window open.`);
  if(!process.argv.includes('--no-open')){
    const {openRegularChrome}=await import('./browser.mjs');await openRegularChrome(`${origin}/#key=${uiToken}`).catch(()=>console.log('Run npm run dashboard to open the dashboard.'));
  }
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'The companion is already running. Run npm run dashboard.':error.message);process.exitCode=1;});
process.on('SIGINT',()=>{server.close();process.exit(0);});
