'use strict';

const batchState = {selected:new Set(), busy:false, timer:null, controller:null, generation:0};

function updateBatchTools() {
  $('batchTools').disabled = state.busy || state.dirty || !state.job
    || !['paused','complete','stopped'].includes(state.job.status) || !state.job.items.some(item => item.status === 'done');
}

function batchTargets() {
  return (state.job?.items || []).filter(item => item.status === 'done' && batchState.selected.has(item.id));
}

function batchError(message = '') {
  $('batchError').textContent = message; $('batchError').hidden = !message;
}

function batchRequest(items = batchTargets()) {
  const number = id => {
    const value = $(id).value;
    if (!value.trim() || !Number.isSafeInteger(Number(value))) throw new Error('Enter whole pixel dimensions.');
    return Number(value);
  };
  const request = {items:items.map(item => ({id:item.id,revision:item.revision || 0})),operation:$('batchOperation').value};
  if (!items.length) throw new Error('Select at least one image.');
  if (request.operation === 'resize') {
    request.width=number('batchWidth'); request.height=number('batchHeight');
    request.keep_proportions=$('batchKeepProportions').checked;
    if (Math.min(request.width,request.height)<1 || Math.max(request.width,request.height)>12000 || request.width*request.height>24000000) throw new Error('Choose dimensions up to 12,000 pixels per side and 24 megapixels.');
  } else if (request.operation === 'square') {
    request.size=number('batchSquareSize'); request.padding=number('batchPadding');
    if (request.size<1 || request.size*request.size>24000000) throw new Error('Choose a square canvas up to 4,898 pixels per side.');
    if (request.padding<0 || request.padding*2>=request.size) throw new Error('Padding must leave room for the image.');
  }
  return request;
}

function cancelBatchPreview() {
  clearTimeout(batchState.timer); batchState.controller?.abort(); batchState.generation++;
}

async function batchPreview() {
  let request;
  try { request=batchRequest(batchTargets().slice(0,1)); } catch { return; }
  const generation=batchState.generation, controller=new AbortController(); batchState.controller=controller;
  $('batchPreviewSize').textContent='Preparing preview…';
  let url;
  try {
    const response=await fetch(`/api/jobs/${state.job.id}/geometry/preview`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-Cutout-Token':state.token},body:JSON.stringify(request)});
    if (!response.ok) { const body=await response.json(); throw new Error(typeof body.detail==='string' ? body.detail : 'Could not prepare this preview.'); }
    url=URL.createObjectURL(await response.blob()); const image=await loadImage(url);
    if (generation!==batchState.generation || !$('batchDialog').open) return;
    const preview=$('batchPreview'), context=preview.getContext('2d');
    context.clearRect(0,0,preview.width,preview.height);
    const scale=Math.min((preview.width-16)/image.naturalWidth,(preview.height-16)/image.naturalHeight);
    context.drawImage(image,(preview.width-image.naturalWidth*scale)/2,(preview.height-image.naturalHeight*scale)/2,image.naturalWidth*scale,image.naturalHeight*scale);
    $('batchPreviewSize').textContent=`${batchTargets()[0].name} (${response.headers.get('X-Output-Width')} × ${response.headers.get('X-Output-Height')} px)`;
  } catch (error) {
    if (generation===batchState.generation && error.name!=='AbortError') { $('batchPreviewSize').textContent='Preview unavailable'; batchError(error.message); }
  } finally { if (url) URL.revokeObjectURL(url); }
}

function refreshBatchDialog() {
  if (batchState.busy) return;
  cancelBatchPreview(); batchError();
  const operation=$('batchOperation').value, targets=batchTargets();
  $('batchSelectedCount').textContent=`${targets.length} selected`;
  $('batchResizeOptions').hidden=operation!=='resize'; $('batchSquareOptions').hidden=operation!=='square';
  $('batchOperationHint').textContent={auto:'Trim transparent margins. Resets existing output sizes and square canvases.',resize:'Keep existing crops and set a new output size. Replaces square canvases.',square:'Auto crop, fit, and center each subject on a square canvas.'}[operation];
  $('batchApply').textContent=`Apply to ${targets.length} image${targets.length===1?'':'s'}`;
  const preview=$('batchPreview'); preview.getContext('2d').clearRect(0,0,preview.width,preview.height);
  try {
    batchRequest(); $('batchApply').disabled=false;
    $('batchPreviewSize').textContent='Preparing preview…';
    batchState.timer=setTimeout(batchPreview,220);
  } catch (error) { $('batchApply').disabled=true; $('batchPreviewSize').textContent=''; if (targets.length) batchError(error.message); }
}

function openBatchTools() {
  if ($('batchTools').disabled) return;
  setTool(null);
  const items=state.job.items.filter(item=>item.status==='done');
  batchState.selected=new Set(items.map(item=>item.id));
  $('batchImageList').innerHTML=items.map(item=>`<label class="batch-image"><input type="checkbox" data-item="${item.id}" checked><img src="${imageURL(item,'thumbnail')}" alt=""><span><strong>${escapeText(item.name)}</strong><small>${item.output_width || item.width} × ${item.output_height || item.height} px</small></span></label>`).join('');
  $('batchDialog').showModal(); refreshBatchDialog();
}

async function applyBatchTools() {
  if (batchState.busy || state.busy || state.dirty) return;
  let request;
  try { request=batchRequest(); } catch(error) { batchError(error.message); return; }
  cancelBatchPreview(); batchState.busy=true; state.busy=true; updateTools();
  $('batchDialog').setAttribute('aria-busy','true');
  for(const input of $('batchDialog').querySelectorAll('input,button,select')) input.disabled=true;
  $('batchApply').textContent='Applying…'; batchError();
  let failure='';
  try {
    const result=await api(`/jobs/${state.job.id}/geometry`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    state.editGeneration=(state.editGeneration || 0)+1;
    for(const updated of result.items) {
      Object.assign(state.job.items.find(item=>item.id===updated.id),updated,{geometry_applied:true});
      batchState.selected.delete(updated.id);
    }
    const selected=result.items.find(item=>item.id===state.selected);
    if(selected) await acceptGeometryResult(selected);
    renderQueue();
    notice(`Updated ${result.items.length} image${result.items.length===1?'':'s'}. Your originals and touch-ups are kept.`);
    if(result.errors.length) {
      failure=result.errors.map(error=>`${state.job.items.find(item=>item.id===error.id)?.name || 'Image'}: ${error.error}`).join(' ');
      for(const input of $('batchImageList').querySelectorAll('input')) input.checked=batchState.selected.has(input.dataset.item);
    } else $('batchDialog').close();
  } catch(error) { failure=error.message; }
  finally {
    batchState.busy=false; state.busy=false; $('batchDialog').setAttribute('aria-busy','false');
    for(const input of $('batchDialog').querySelectorAll('input,button,select')) input.disabled=false;
    updateTools(); if($('batchDialog').open) { refreshBatchDialog(); if(failure) batchError(failure); }
  }
}

$('batchTools').onclick=openBatchTools;
$('batchImageList').onchange=event=>{ const id=event.target.dataset.item; if(!id)return; event.target.checked?batchState.selected.add(id):batchState.selected.delete(id);refreshBatchDialog(); };
for(const [id,selected] of [['batchSelectAll',true],['batchSelectNone',false]]) $(id).onclick=()=>{ for(const input of $('batchImageList').querySelectorAll('input')) { input.checked=selected; selected?batchState.selected.add(input.dataset.item):batchState.selected.delete(input.dataset.item); } refreshBatchDialog(); };
for(const id of ['batchOperation','batchWidth','batchHeight','batchKeepProportions','batchSquareSize','batchPadding']) $(id).addEventListener('input',refreshBatchDialog);
$('batchApply').onclick=applyBatchTools;
for(const id of ['batchCancel','batchClose']) $(id).onclick=()=>{if(!batchState.busy)$('batchDialog').close();};
$('batchDialog').addEventListener('cancel',event=>{if(batchState.busy)event.preventDefault();});
$('batchDialog').addEventListener('close',cancelBatchPreview);
updateBatchTools();
