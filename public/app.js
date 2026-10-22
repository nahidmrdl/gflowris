import {createQueueWorkspace} from './queue-ui.js';
import {initPromptHelp} from './prompt-help.js';
const $=selector=>document.querySelector(selector);
const key=new URLSearchParams(location.hash.slice(1)).get('key');
if(key){sessionStorage.setItem('flow-key',key);history.replaceState(null,'',location.pathname+location.search);}
let state=null,hydrated=false,capabilityKey='',jobsKey='',filter='all',selecting=false,preview=null,noticeUntil=0,saveTimer,saveChain=Promise.resolve(),workspace,startingRun=false,cancellingRun=false,runController=null;
const selected=new Set(),previews=new Map();
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const badges=(selector,values)=>$(selector).replaceChildren(...values.map(value=>element('span','',value)));
async function api(route,data,signal){
  const response=await fetch('/api/'+route,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+sessionStorage.getItem('flow-key'),'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'The operation could not finish.');return result;
}
function message(text,error=false){$('#message').textContent=text;$('#message').dataset.tone=error?'error':'normal';noticeUntil=Date.now()+8000;}
const active=()=>startingRun||cancellingRun||state?.queue?.status==='running'||state?.postProcessing||state?.preparing;
function runControls(){
  if(!state)return;
  $('#run').disabled=!state.connected||!state.capabilities?.ready||active()||workspace.busy||(!workspace.items.length&&state.queue.status!=='paused');
  $('#run').textContent=cancellingRun?'Cancelling…':startingRun||state.preparing?'Starting…':state.queue.status==='running'?'Running…':state.postProcessing?'Processing…':state.queue.status==='paused'?'Resume queue':'Run queue ('+workspace.items.length+')';
  $('#run').setAttribute('aria-busy',String(!!active()));
  $('#pause').disabled=cancellingRun||startingRun||state.queue.status!=='running';$('#inspect').disabled=active();$('#history-open').disabled=active();$('#clear-images').disabled=active()||!state.queue.items.length;
  $('#cancel').disabled=cancellingRun||!(startingRun||state.preparing||['running','paused'].includes(state.queue.status));$('#cancel').textContent=cancellingRun?'Cancelling…':'Cancel queue';
}
function defaults(){return {model:$('#model').value,ratio:$('#ratio').value,count:Number($('#count').value),resolution:$('#resolution').value,removeBackground:$('#remove-background').checked,autoCrop:$('#composer-auto-crop').checked,cutrisQuality:$('#cutris-quality').value,cutrisMode:$('#cutris-mode').value};}
function setComposerValues(values={}){
  for(const id of ['model','ratio','count','resolution'])if(values[id]!=null){const select=$('#'+id),value=String(values[id]);if(![...select.options].some(option=>option.value===value)){const option=element('option','',value+' (unavailable)');option.value=value;option.disabled=true;select.append(option);}select.value=value;}
  $('#remove-background').checked=values.removeBackground??false;$('#cutris-quality').value=values.cutrisQuality||'detail';$('#cutris-mode').value=values.cutrisMode||'ai';$('#composer-auto-crop').checked=values.autoCrop!==false;$('#auto-crop').checked=$('#composer-auto-crop').checked;processingSummary();
}
function scheduleSave(){
  clearTimeout(saveTimer);$('#settings-save-status').textContent='Saving…';
  saveTimer=setTimeout(()=>{const value={composerDefaults:defaults(),draft:$('#prompts').value,inputMode:$('#input-mode').value,editingId:workspace?.editingId||null};saveChain=saveChain.catch(()=>{}).then(()=>api('settings',value)).then(()=>$('#settings-save-status').textContent='All changes saved.').catch(error=>{$('#settings-save-status').textContent=error.message;});},500);
}
function processingSummary(){badges('#processing-summary',[]);}
let extensionDownloadLoading=false;
async function loadExtensionDownload(){
  if(extensionDownloadLoading)return;
  extensionDownloadLoading=true;$('#extension-download').href='https://github.com/nahidmrdl/gflowris/releases/latest';$('#extension-download').textContent='View latest release';$('#extension-status').textContent='Checking the latest extension download…';
  try{
    const info=await api('extension/info');
    $('#extension-download').href=info.downloadUrl;
    $('#extension-download').textContent=info.direct?'Download extension ZIP':'View latest release';
    $('#extension-status').textContent=info.direct?'Latest release: '+info.version:'Open the latest release and download the chrome-extension.zip asset.';
  }catch{
    $('#extension-download').href='https://github.com/nahidmrdl/gflowris/releases/latest';
    $('#extension-download').textContent='View latest release';
    $('#extension-status').textContent='Open the latest release and download the chrome-extension.zip asset.';
  }finally{extensionDownloadLoading=false;}
}
function showSettings(tab='workspace'){
  $('#settings-cutris-quality').value=$('#cutris-quality').value;$('#settings-cutris-mode').value=$('#cutris-mode').value;
  for(const button of document.querySelectorAll('[data-settings-tab]')){const match=button.dataset.settingsTab===tab;button.classList.toggle('active',match);button.setAttribute('aria-selected',String(match));}
  for(const panel of document.querySelectorAll('[data-settings-panel]'))panel.hidden=panel.dataset.settingsPanel!==tab;
  $('#settings-output').textContent=$('#output').value||'Choose a folder in the workspace.';
  if(!$('#workspace-settings-dialog').open)$('#workspace-settings-dialog').showModal();
  if(tab==='connection')loadExtensionDownload();
}
async function update(){
  try{
    state=await api('state');const firstLoad=!hydrated;
    $('#connection').textContent=state.connected?'Flow connected':'Connect Flow';$('#connection').classList.toggle('online',state.connected);$('#setup').hidden=state.connected;
    $('#flow-health').textContent=state.connected?'Connected to '+(state.snapshot?.version?'extension '+state.snapshot.version:'your Flow project'):'Open your Flow project and connect it from the extension.';
    if(!hydrated){
      const values=state.settings.composerDefaults||state.settings.defaults||{};
      $('#prompts').value=state.settings.draft||'';$('#remove-background').checked=!!values.removeBackground;
      $('#cutris-quality').value=values.cutrisQuality||'detail';$('#cutris-mode').value=values.cutrisMode||'ai';$('#auto-crop').checked=values.autoCrop!==false;hydrated=true;processingSummary();
    }
    if(document.activeElement!==$('#output')&&!$('#output').dataset.edited)$('#output').value=state.settings.outputFolderDisplay||state.settings.outputFolder;
    if(state.snapshot){$('#control-count').textContent=state.snapshot.controls.length+' controls in extension '+(state.snapshot.version||'');$('#snapshot').textContent=JSON.stringify(state.snapshot,null,2);}
    const caps=state.capabilities;
    if(caps?.ready&&JSON.stringify(caps)!==capabilityKey){
      capabilityKey=JSON.stringify(caps);
      for(const [id,field]of[['model','models'],['ratio','ratios'],['count','counts'],['resolution','resolutions']]){
        const select=$('#'+id);select.replaceChildren();
        const choices=id==='resolution'&&caps.resolutionOptions?caps.resolutionOptions:caps[field].map(value=>({value,label:String(value),enabled:true}));
        for(const choice of choices){const label=String(choice.label).replace(/\s[·•]\s/g,' '),option=element('option','',id==='resolution'&&choice.enabled?choice.value:label);option.value=choice.value;option.title=label;option.disabled=!choice.enabled;select.append(option);}
        const saved=state.settings.defaults?.[id],preferred=caps[field].map(String).includes(String(saved))?saved:caps.defaults?.[id];
        if(caps[field].map(String).includes(String(preferred)))select.value=preferred;select.disabled=false;
      }
    }
    workspace.accept(state.draftQueue||{revision:0,items:[]},state.queue);
    if(firstLoad){const initial={...caps?.defaults,...(state.settings.composerDefaults||state.settings.defaults)};if(!initial.model)initial.model=caps?.defaults?.model||'';setComposerValues(initial);workspace.hydrate(state.settings);}
    runControls();
    $('#batch-download-note').hidden=!active()||state.queue.items.reduce((sum,item)=>sum+item.count,0)<=1;
    const originals=state.queue.items.reduce((sum,item)=>sum+(item.files?.length||0),0),cutouts=state.queue.items.reduce((sum,item)=>sum+(item.files?.filter(file=>file.cutout).length||0),0);
    badges('#results-summary',originals?[originals+' original'+(originals===1?'':'s'),...(cutouts?[cutouts+' cutout'+(cutouts===1?'':'s')]:[])]:['Originals always kept']);
    $('#images-tab-count').textContent=originals;
    $('#queue-progress').hidden=!active();
    const total=state.queue.items.reduce((sum,item)=>sum+item.count*(item.removeBackground?2:1),0),done=state.queue.items.reduce((sum,item)=>sum+(item.files?.length||0)+(item.removeBackground?(item.files?.filter(file=>file.cutout).length||0):0),0);
    $('#queue-progress-bar').value=state.postProgress?state.postProgress.done/state.postProgress.total:total?done/total:0;$('#queue-progress-label').textContent=state.postProgress?`Processing ${state.postProgress.done} of ${state.postProgress.total}`:state.postProcessing?'Working in Cutris…':state.queue.items.find(item=>item.id===state.queue.current)?.stage||'Preparing';
    if(Date.now()>noticeUntil){$('#message').dataset.tone='normal';$('#message').textContent=state.queue.items.length?state.queue.message.replace(/\s[·•]\s/g,': '):state.connected?'Ready. Add your prompts and choose Run queue.':'Connect your project to load the available models and image sizes.';}
    const nextKey=JSON.stringify([state.queue,!!active(),filter,selecting,[...selected]]);
    if(nextKey!==jobsKey){jobsKey=nextKey;renderJobs();}
    if(preview&&$('#preview-dialog').open){const item=state.queue.items.find(value=>value.id===preview.itemId),file=item?.files[preview.index];if(file){const version=preview.variant==='cutout'?file.cutout?.name:file.name;if(version!==preview.version)await showPreview(item,preview.index,preview.variant);}}
  }catch(error){$('#connection').textContent='Companion offline';$('#connection').classList.remove('online');message(error.message,true);}
}
async function imageURL(item,index,variant){
  const file=item.files[index],id=item.id+'-'+index+'-'+variant+'-'+(variant==='cutout'?file.cutout?.name:file.name);
  if(previews.has(id))return previews.get(id);
  const version=encodeURIComponent(variant==='cutout'?file.cutout.name+':'+file.cutout.revision:file.name);
  const response=await fetch(`/api/image?item=${encodeURIComponent(item.id)}&index=${index}&variant=${variant}&v=${version}`,{cache:'no-store',headers:{Authorization:'Bearer '+sessionStorage.getItem('flow-key')}});
  if(!response.ok)throw new Error('The saved image could not be opened.');
  const url=URL.createObjectURL(await response.blob());previews.set(id,url);return url;
}
function reprocessOptions(item,index){
  const values=defaults(),dialog=$('#reprocess-dialog');
  $('#reprocess-quality').value=values.cutrisQuality;$('#reprocess-mode').value=values.cutrisMode;$('#reprocess-crop').checked=values.autoCrop;
  return new Promise(resolve=>{
    const finish=value=>{dialog.close();dialog.oncancel=null;resolve(value);};
    $('#reprocess-close').onclick=()=>finish(null);dialog.oncancel=event=>{event.preventDefault();finish(null);};
    $('#reprocess-confirm').onclick=()=>finish({...values,cutrisQuality:$('#reprocess-quality').value,cutrisMode:$('#reprocess-mode').value,autoCrop:$('#reprocess-crop').checked});
    $('#reprocess-edit').onclick=()=>{finish(null);openEditor(item,index);};dialog.showModal();
  });
}
async function removeOne(item,index){
  try{let options=defaults();if(item.files[index].cutout){options=await reprocessOptions(item,index);if(!options)return;}message('Removing the background. Your original stays saved.');await api('cutris/remove',{item:item.id,index,quality:options.cutrisQuality,mode:options.cutrisMode,autoCrop:options.autoCrop});await update();message('Cutout saved and ready to edit.');}catch(error){message(error.message,true);}
}
async function openEditor(item,index){
  try{
    if(window.pywebview?.api?.open_editor){const opened=await window.pywebview.api.open_editor(item.files[index].cutout.projectId);if(!opened.ok)throw new Error(opened.error);if(opened.url)location.assign(opened.url);return;}
    const result=await api('cutris/editor',{item:item.id,index});
    if(result.embedded){if(!window.pywebview?.api?.open_editor)throw new Error('Open the desktop workspace to use the Cutris editor.');const opened=await window.pywebview.api.open_editor(item.files[index].cutout.projectId);if(!opened.ok)throw new Error(opened.error);}
    message('Saved changes sync back automatically. Update PNG is also available.');
  }catch(error){message(error.message,true);}
}
async function refreshCutout(item,index){
  try{await api('cutris/refresh',{item:item.id,index});await update();message('Updated PNG saved. Earlier files are kept.');if(preview?.itemId===item.id&&preview.index===index)await showPreview(state.queue.items.find(value=>value.id===item.id),index,'cutout');}catch(error){message(error.message,true);}
}
function actionButton(text,className,handler,disabled=false){const button=element('button',className,text);button.disabled=disabled;button.onclick=handler;return button;}
function renderJobs(){
  const container=$('#jobs');container.replaceChildren();container.classList.remove('empty');let rendered=0;
  for(const item of state.queue.items){
    const files=(item.files||[]).map((file,index)=>({file,index})).filter(({file})=>filter!=='cutout'||file.cutout);
    if(filter==='cutout'&&!files.length)continue;
    const card=element('article','job'+(files.length>2?' wide':'')),heading=element('div','job-heading'),title=element('div','job-title');
    title.append(element('span','job-index',String(item.index).padStart(2,'0')),document.createTextNode(item.title||item.prompt.split('\n')[0]));title.title=item.prompt;
    const status=element('span','job-state '+item.status,item.status==='complete'?'Saved':item.status==='attention'?'Needs attention':item.status==='queued'?'Queued':item.stage);
    heading.append(title,status);const metadata=element('div','metadata');
    for(const text of [item.model,item.ratio,item.count+' image'+(item.count===1?'':'s'),item.resolution])if(text)metadata.append(element('span','',text));
    metadata.append(actionButton('Use prompt','text-button',()=>{ $('#prompts').value=item.prompt;for(const id of ['model','ratio','count','resolution'])if([...$('#'+id).options].some(option=>option.value===String(item[id])))$('#'+id).value=item[id];workspace.composer();scheduleSave();$('#prompts').focus();}));
    card.append(heading,metadata);
    if(files.length){
      const gallery=element('div','gallery');
      for(const {file,index}of files){
        const variant=filter==='original'?'original':file.cutout?'cutout':'original',id=item.id+':'+index;
        const figure=element('figure','image-card'+(file.cutout?' cutout':'')+(selected.has(id)?' selected':''));
        const top=element('div','image-topbar'),label=element('label');
        if(selecting){const checkbox=element('input');checkbox.type='checkbox';checkbox.checked=selected.has(id);checkbox.setAttribute('aria-label','Select image '+(index+1));checkbox.onchange=()=>{checkbox.checked?selected.add(id):selected.delete(id);jobsKey='';renderJobs();};label.append(checkbox);}
        label.append(element('strong','','Image '+String(index+1).padStart(2,'0')));top.append(label,element('span','image-type',variant==='cutout'?'Transparent PNG':'Original'));
        const media=element('div','image-preview'+(variant==='cutout'?' checker':'')),image=element('img');image.alt=variant==='cutout'?'Transparent cutout '+(index+1):'Generated original '+(index+1);image.title='Open preview';image.tabIndex=0;
        media.append(image);media.onclick=()=>showPreview(item,index,variant).catch(error=>message(error.message,true));image.onkeydown=event=>{if(event.key==='Enter')media.click();};imageURL(item,index,variant).then(url=>image.src=url).catch(()=>{});
        const foot=element('figcaption','image-footer'),dimensions=element('div','image-dimensions',variant==='cutout'?file.cutout.width+' × '+file.cutout.height+' px':'Original at '+item.resolution+' resolution');dimensions.title=variant==='cutout'?file.cutout.name:file.name;
        const controls=element('div','image-actions');
        if(file.cutout){
          controls.append(actionButton('Edit in Cutris','edit-button',()=>openEditor(item,index),active()));
          const secondary=element('div','image-secondary-actions');secondary.append(actionButton('Update PNG','',()=>refreshCutout(item,index),active()),actionButton('Reprocess','',()=>removeOne(item,index),active()));controls.append(secondary);
        }else controls.append(actionButton('Remove background','secondary',()=>removeOne(item,index),active()));
        foot.append(dimensions,controls);if(file.syncError)foot.append(element('p','image-error',file.syncError));if(file.cutrisError)foot.append(element('p','image-error',file.cutrisError));figure.append(top,media,foot);gallery.append(figure);
      }
      card.append(gallery);
    }
    if(item.status==='attention')card.append(element('p','image-error',item.stage));container.append(card);rendered++;
  }
  if(!rendered){container.classList.add('empty');container.append(element('h3','',filter==='cutout'?'Your cutouts will appear here.':'Ready for your next idea.'),element('p','',filter==='cutout'?'Process an image with Cutris to create a transparent PNG.':'Add a prompt and run the queue.'));}
  $('#bulk-process').hidden=!selecting;$('#bulk-process').disabled=!selected.size||active();$('#selection-count').hidden=!selected.size;$('#selection-count').textContent=selected.size+' selected';$('#select-images').textContent=selecting?'Done selecting':'Select images';
}
async function showPreview(item,index,variant){
  const file=item.files[index];preview={itemId:item.id,index,variant,version:variant==='cutout'?file.cutout.name:file.name};
  $('#preview-title').textContent=(variant==='cutout'?'Cutout ':'Original ')+String(index+1).padStart(2,'0');
  $('#preview-image').onload=()=>$('#preview-dimensions').textContent=$('#preview-image').naturalWidth+' × '+$('#preview-image').naturalHeight+' px';
  $('#preview-image').src=await imageURL(item,index,variant);$('#preview-image').className='fit';$('#preview-zoom').textContent='100%';
  for(const kind of ['original','cutout'])$('#preview-'+kind).classList.toggle('active',kind===variant);
  $('#preview-cutout').disabled=!file.cutout;$('#preview-edit').hidden=!file.cutout;$('#preview-refresh').hidden=!file.cutout;
  if(!$('#preview-dialog').open)$('#preview-dialog').showModal();
}
async function checkCutris(){
  $('#cutris-status').textContent='Checking Cutris…';
  try{const info=await api('cutris/status',{});$('#cutris-connection-state').textContent=info.owner==='gflowris'?'Built into gflowris':info.source==='desktop'?'Desktop connected':'Background engine ready';$('#cutris-status').textContent=(info.owner==='gflowris'?'The complete Cutris workspace is ready inside gflowris. ':info.source==='desktop'?'Using the Cutris desktop app. ':'Standalone processing is ready. ')+Object.entries(info.models).filter(([,ready])=>ready).map(([name])=>name==='detail'?'Best detail installed':'Lite model installed').join('. ');}
  catch(error){$('#cutris-connection-state').textContent='Check setup';$('#cutris-status').textContent=error.message;}
}
async function openCutris(){try{if(!window.pywebview?.api?.open_cutris)throw new Error('Reopen the desktop workspace to load the Cutris settings action.');const response=await window.pywebview.api.open_cutris();if(!response.ok)throw new Error(response.error);if(response.url)location.assign(response.url);}catch(error){message(error.message,true);}}
initPromptHelp();
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$('#'+button.dataset.close).close();
for(const button of document.querySelectorAll('[data-settings-tab]'))button.onclick=()=>showSettings(button.dataset.settingsTab);
$('#workspace-settings').onclick=()=>showSettings();$('#processing-options').onclick=()=>showSettings('processing');$('#connection-help').onclick=()=>showSettings('connection');$('#extension-setup').onclick=()=>showSettings('connection');$('#cutris-connection').onclick=()=>{showSettings('connection');checkCutris();};
$('#launch-cutris').onclick=async()=>{try{const result=await window.pywebview.api.open_editor_home();if(!result.ok)throw new Error(result.error);if(result.url)location.assign(result.url);}catch(error){message(error.message,true);}};
$('#open-cutris').onclick=openCutris;$('#connection-cutris-settings').onclick=openCutris;$('#check-cutris').onclick=checkCutris;
for(const id of ['remove-background','cutris-quality','cutris-mode','composer-auto-crop','model','ratio','count','resolution'])$('#'+id).onchange=()=>{ $('#auto-crop').checked=$('#composer-auto-crop').checked;processingSummary();workspace.composer();scheduleSave();};
$('#auto-crop').onchange=()=>{$('#composer-auto-crop').checked=$('#auto-crop').checked;scheduleSave();};
for(const kind of ['quality','mode'])$('#settings-cutris-'+kind).onchange=()=>{$('#cutris-'+kind).value=$('#settings-cutris-'+kind).value;processingSummary();scheduleSave();};

$('#output').oninput=()=>$('#output').dataset.edited='true';
$('#output').onchange=async()=>{try{await api('settings',{outputFolder:$('#output').value});delete $('#output').dataset.edited;}catch(error){message(error.message,true);}};
function folderMessage(text,error=false){message(text,error);$('#settings-folder-status').textContent=text;$('#settings-folder-status').dataset.tone=error?'error':'normal';}
async function folderAction(nativeName,route){
  const bridge=window.pywebview?.api;
  const result=typeof bridge?.[nativeName]==='function'?await bridge[nativeName]():await api(route,{});
  if(!result||result.ok===false)throw new Error(result?.error||'The folder action could not finish. Reopen gflowris and try again.');
  return result;
}
async function browse(){
  if($('#browse').disabled||$('#settings-browse').disabled)return;
  $('#browse').disabled=true;$('#settings-browse').disabled=true;folderMessage('Choose an output folder…');
  try{const result=await folderAction('choose_workspace_output_folder','browse');if(result.folder){await api('settings',{outputFolder:result.folder});await update();$('#settings-output').textContent=$('#output').value;folderMessage('Output folder updated.');}else folderMessage('Folder selection cancelled.');}
  catch(error){folderMessage(error.message,true);}finally{$('#browse').disabled=false;$('#settings-browse').disabled=false;}
}
$('#browse').onclick=browse;$('#settings-browse').onclick=browse;
$('#open-folder').onclick=async()=>{
  const button=$('#open-folder');button.disabled=true;button.textContent='Opening…';
  try{await folderAction('open_workspace_output_folder','open-folder');folderMessage('Opened the output folder.');}
  catch(error){folderMessage(error.message,true);}finally{button.disabled=false;button.textContent='Open folder';}
};
$('#inspect').onclick=async()=>{try{$('#inspect').disabled=true;message('Checking the settings available in Flow…');await api('discover',{});capabilityKey='';await update();message('Flow settings refreshed.');}catch(error){message(error.message,true);}finally{$('#inspect').disabled=false;}};
async function runDraft(items){
  if(active())return;
  if(state.queue.status!=='paused'&&!items.length)throw new Error('Add at least one prompt to the queue.');
  startingRun=true;runController=new AbortController();const signal=runController.signal;runControls();workspace.accept(null,state.queue);
  try{
    if(state.queue.status==='paused'){await api('resume',{},signal);}else{
      clearTimeout(saveTimer);await saveChain;
      signal.throwIfAborted();await api('settings',{outputFolder:state.settings.outputFolder,composerDefaults:defaults(),draft:$('#prompts').value,inputMode:$('#input-mode').value,editingId:workspace.editingId},signal);
      signal.throwIfAborted();selected.clear();await api('run',{items},signal);
    }
    workspace.showTab('images');noticeUntil=0;
  }catch(error){if(error.name!=='AbortError')throw error;}finally{
    startingRun=false;runController=null;await update();runControls();
  }
}
$('#pause').onclick=()=>api('pause',{}).then(update).catch(error=>message(error.message,true));
$('#cancel').onclick=async()=>{
  if(cancellingRun||$('#cancel').disabled)return;
  const preparing=startingRun;cancellingRun=true;runController?.abort();runControls();message('Cancelling the queue…');
  try{await api('cancel',{preparing});message('Queue cancelled. Saved files are kept. Work already submitted may still finish.');}
  catch(error){message(error.message,true);}finally{cancellingRun=false;await update();runControls();}
};
for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{filter=button.dataset.filter;for(const choice of document.querySelectorAll('[data-filter]')){choice.classList.toggle('active',choice===button);choice.setAttribute('aria-pressed',String(choice===button));}jobsKey='';renderJobs();};
$('#select-images').onclick=()=>{selecting=!selecting;if(!selecting)selected.clear();jobsKey='';renderJobs();};
$('#bulk-process').onclick=async()=>{try{$('#bulk-process').disabled=true;const options=defaults();const targets=[...selected].map(value=>{const [item,index]=value.split(':');return {item,index:Number(index)};});message('Processing selected images in order. Originals are kept.');await api('cutris/batch',{targets,quality:options.cutrisQuality,mode:options.cutrisMode,autoCrop:options.autoCrop});selected.clear();selecting=false;await update();message('Selected cutouts saved.');}catch(error){message(error.message,true);await update();}};
$('#preview-close').onclick=()=>$('#preview-dialog').close();
for(const variant of ['original','cutout'])$('#preview-'+variant).onclick=()=>{const item=state.queue.items.find(value=>value.id===preview.itemId);showPreview(item,preview.index,variant).catch(error=>message(error.message,true));};
$('#preview-zoom').onclick=()=>{const fit=$('#preview-image').classList.toggle('actual');$('#preview-image').classList.toggle('fit',!fit);$('#preview-zoom').textContent=fit?'Fit':'100%';};
$('#preview-edit').onclick=()=>{const item=state.queue.items.find(value=>value.id===preview.itemId);openEditor(item,preview.index);};$('#preview-refresh').onclick=()=>{const item=state.queue.items.find(value=>value.id===preview.itemId);refreshCutout(item,preview.index);};
$('#history-open').onclick=async()=>{try{const history=await api('history');$('#history-list').replaceChildren();for(const item of history.items){const button=element('button','recent-queue'),text=element('div');text.append(element('strong','',item.prompt),element('small','',new Date(item.created).toLocaleString()+' ('+item.count+' images)'));button.append(text,element('span','',item.status));button.onclick=async()=>{try{await api('history/select',{id:item.id});selected.clear();releasePreviews();$('#history-dialog').close();jobsKey='';await update();workspace.showTab('images');}catch(error){message(error.message,true);}};$('#history-list').append(button);}if(!history.items.length)$('#history-list').append(element('p','','Your completed queues will appear here.'));$('#history-dialog').showModal();}catch(error){message(error.message,true);}};
function releasePreviews(){for(const url of previews.values())URL.revokeObjectURL(url);previews.clear();preview=null;}
$('#clear-images').onclick=async()=>{try{await api('queue/clear',{});selected.clear();selecting=false;releasePreviews();$('#preview-dialog').close();jobsKey='';await update();message('Images cleared from this view. Your files and recent queues are kept.');}catch(error){message(error.message,true);}};
$('#settings-default-folder').onclick=async()=>{
  const button=$('#settings-default-folder');button.disabled=true;
  try{const value=await api('output/default');await api('settings',{outputFolder:value.folder});delete $('#output').dataset.edited;await update();$('#settings-output').textContent=$('#output').value;folderMessage('Default output folder selected. It will be created when needed.');}
  catch(error){folderMessage(error.message,true);}finally{button.disabled=false;}
};
workspace=createQueueWorkspace({api,getValues:defaults,setValues:setComposerValues,notice:message,isActive:active,saveComposer:scheduleSave,onRun:runDraft,onChange:runControls});
update().then(checkCutris);setInterval(update,1800);
