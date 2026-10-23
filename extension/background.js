import {handleGenerationMessage} from './generation-bridge.js';
import {nativeRequest} from './native-client.js';
import {pulseFlowTab} from './tab-heartbeat.js';
let pulsing=false;
async function pulse(){if(pulsing)return;pulsing=true;try{await pulseFlowTab(chrome);}catch{}finally{pulsing=false;}}
setInterval(pulse,1000);pulse();
const flowUrl=url=>{try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='flow.google.com'||(u.hostname==='labs.google'&&u.pathname.startsWith('/fx/')));}catch{return false;}};
async function bridge(endpoint,data){return nativeRequest('bridge',endpoint,data);}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  (async()=>{
    if(sender.id!==chrome.runtime.id)throw new Error('Unknown sender.');
    if(message.type==='pair'&&!sender.tab){
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tab||!flowUrl(tab.url))throw new Error('Open your Flow project, then connect from its extension popup.');
      await nativeRequest('status');
      await bridge('/bridge/select-tab',{tabId:tab.id,page:tab.url});
      await chrome.storage.local.set({native:true,tabId:tab.id});return {ok:true,reconnected:true};
    }
    if(message.type==='status'&&!sender.tab){const status=await nativeRequest('status');const {tabId}=await chrome.storage.local.get('tabId');const [active]=await chrome.tabs.query({active:true,currentWindow:true});return {paired:true,native:true,tabId,...status,activeFlow:!!active&&flowUrl(active.url),selected:!!active&&active.id===tabId};}
    if(message.type==='desktop-open'&&!sender.tab)return nativeRequest('desktop-open');
    if(message.type==='poll'&&sender.tab&&flowUrl(sender.url)){
      const {token,tabId}=await chrome.storage.local.get(['token','tabId']);
      if(tabId!==sender.tab.id)return {idle:true};
      const {pendingReport}=await chrome.storage.session.get('pendingReport');
      try{await reconcileDownload();}catch{}
      const result=await bridge('/bridge/poll',{tabId,snapshot:message.snapshot,results:message.results},token);
      const {armed}=await chrome.storage.session.get('armed');if(armed&&Array.isArray(result.activeDownloadMarkers)&&!result.activeDownloadMarkers.includes(armed.marker)){if(armed.downloadId!==undefined)await chrome.downloads.cancel(armed.downloadId).catch(()=>{});await chrome.storage.session.remove(['armed','pendingReport']);}
      if(pendingReport&&Array.isArray(result.activeDownloadMarkers)&&!result.activeDownloadMarkers.includes(pendingReport.armed.marker))await chrome.storage.session.remove('pendingReport');
      return result;
    }
    if(message.type==='command-state'&&sender.tab&&flowUrl(sender.url)){
      const {tabId}=await chrome.storage.local.get('tabId');if(tabId!==sender.tab.id)throw new Error('Wrong Flow tab.');
      return bridge('/bridge/command-state',{tabId,id:message.id});
    }
    if(message.type==='arm-download'&&sender.tab&&flowUrl(sender.url)){
      const {tabId}=await chrome.storage.local.get('tabId');if(tabId!==sender.tab.id)throw new Error('Wrong Flow tab.');
      if(!/^[0-9a-f-]{36}-[1-4]$/.test(message.marker))throw new Error('Invalid download marker.');
      const {armed}=await chrome.storage.session.get('armed');if(armed&&Date.now()-armed.started<15*60*1000)throw new Error('Another image download is pending.');
      const page=(await chrome.tabs.get(tabId)).url;
      if(page!==message.page||!flowUrl(page)||!message.title?.trim()||!['1K','2K','4K'].includes(message.resolution))throw new Error('The selected image’s download identity is unavailable.');
      const pending={marker:message.marker,page,started:Date.now(),title:message.title,resolution:message.resolution,sourceOrigin:message.sourceOrigin};
      const {token}=await chrome.storage.local.get('token');await bridge('/bridge/arm',pending,token);
      await chrome.storage.session.set({armed:pending});return {ok:true};
    }
    if(['generation-ready','click-generate'].includes(message.type))return handleGenerationMessage(chrome,message,sender,async()=>{if(!message.commandId)return;const {tabId}=await chrome.storage.local.get('tabId');const state=await bridge('/bridge/command-state',{tabId,id:message.commandId});if(!state.active)throw new Error('Queue cancelled.');});
    throw new Error('The extension could not handle this request. Reload gflowris bridge in chrome://extensions, then reload Flow and reconnect.');
  })().then(result=>sendResponse({ok:true,...result}),error=>sendResponse({ok:false,error:error.message}));
  return true;
});
function urlOrigin(value){try{return new URL(value).origin;}catch{return null;}}
chrome.downloads.onDeterminingFilename.addListener((item,suggest)=>{
  (async()=>{
    const {armed}=await chrome.storage.session.get('armed');
    if(!armed||armed.downloadId!==undefined||Date.now()-armed.started>15*60*1000||Date.parse(item.startTime)<armed.started)return;
    if(!item.mime?.startsWith('image/')&&!/\.(png|jpe?g|webp|avif)$/i.test(item.filename))return;
    const {token}=await chrome.storage.local.get('token');
    let decision;
    try{decision=await bridge('/bridge/candidate',{marker:armed.marker,item:{filename:item.filename.split(/[\\/]/).pop(),mime:item.mime,startTime:item.startTime,referrerOrigin:urlOrigin(item.referrer),sourceOrigin:urlOrigin(item.url)}},token);}
    catch(error){await chrome.storage.session.set({pendingReport:{armed,delta:{error:{current:'Download association failed: '+error.message}}}});throw error;}
    if(!decision.match)return;
    const ext=decision.extension;
    armed.downloadId=item.id;await chrome.storage.session.set({armed});
    suggest({filename:`gflowris/${armed.marker}.${ext}`,conflictAction:'uniquify'});return true;
  })().then(handled=>{if(!handled)suggest();},()=>suggest());return true;
});
const downloadReports=new Map();
async function reportDownload(armed,data){
  if(downloadReports.has(armed.marker))return downloadReports.get(armed.marker);
  const reporting=(async()=>{
    const {token}=await chrome.storage.local.get('token');await bridge('/bridge/download',{marker:armed.marker,...data},token);
    const current=await chrome.storage.session.get(['armed','pendingReport']);
    if(current.armed?.marker===armed.marker)await chrome.storage.session.remove('armed');
    if(current.pendingReport?.armed.marker===armed.marker)await chrome.storage.session.remove('pendingReport');
  })();
  downloadReports.set(armed.marker,reporting);
  try{return await reporting;}finally{downloadReports.delete(armed.marker);}
}
async function reconcileDownload(){
  const {armed,pendingReport}=await chrome.storage.session.get(['armed','pendingReport']);
  if(!armed)return;
  if(armed.downloadId===undefined){if(pendingReport?.armed.marker===armed.marker)await reportDownload(armed,{error:pendingReport.delta.error?.current||'Download association failed.'});return;}
  const [item]=await chrome.downloads.search({id:armed.downloadId});
  if(item?.state==='complete')await reportDownload(armed,{filename:item.filename});
  else if(item?.state==='interrupted')await reportDownload(armed,{error:item.error||pendingReport?.delta.error?.current||'Chrome interrupted the download.'});
}
chrome.downloads.onChanged.addListener(async delta=>{
  const {armed}=await chrome.storage.session.get('armed');if(!armed||delta.id!==armed.downloadId)return;
  if(!['complete','interrupted'].includes(delta.state?.current))return;
  await chrome.storage.session.set({pendingReport:{armed,delta}});
  try{await reconcileDownload();}catch{}
});
