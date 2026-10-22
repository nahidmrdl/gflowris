'use strict';

const geometryState = {source:null, crop:null, canvas:null, autoBounds:undefined, scale:1, drag:null, busy:false, mode:'auto', newCrop:false, initialized:false};
const geometryCropFields = ['geometryCropX','geometryCropY','geometryCropWidth','geometryCropHeight'];

function geometryInteger(id) {
  const value = $(id).value;
  return value.trim() && Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
}

function geometryCropFromFields() {
  const [x,y,width,height] = geometryCropFields.map(geometryInteger), source = geometryState.source;
  if (![x,y,width,height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1) throw new Error('Enter whole pixels: positions start at 0; width and height must be at least 1.');
  if (x + width > source.width || y + height > source.height) throw new Error('Keep the crop area inside the original image.');
  return {x,y,width,height};
}

function geometryOutputSize() {
  if (!$('geometryResizeEnabled').checked) return geometryState.canvas ? {width:geometryState.canvas.size,height:geometryState.canvas.size} : {width:geometryState.crop.width,height:geometryState.crop.height};
  const width = geometryInteger('geometryResizeWidth'), height = geometryInteger('geometryResizeHeight');
  if (![width,height].every(Number.isSafeInteger) || width < 1 || height < 1) throw new Error('Enter a whole pixel width and height, starting at 1.');
  if (width > 12000 || height > 12000 || width * height > 24000000) throw new Error('Choose a size up to 12,000 pixels per side and 24 megapixels in total.');
  return geometryState.canvas ? {width:geometryState.canvas.size,height:geometryState.canvas.size} : {width,height};
}

function geometryError(message = '') {
  $('geometryError').textContent = message;
  $('geometryError').hidden = !message;
}

function geometrySetMode(mode) {
  geometryState.mode = mode;
  for (const [id,value] of [['geometryAutoCrop','auto'],['geometryManualCrop','manual']]) {
    $(id).classList.toggle('active', value === mode);
    $(id).setAttribute('aria-pressed', String(value === mode));
  }
}

function geometrySetNewCrop(enabled) {
  geometryState.newCrop=enabled;
  $('geometryStage').classList.toggle('geometry-draw',enabled);
}

function geometrySyncCropFields() {
  const crop = geometryState.crop;
  geometryCropFields.forEach((id,index) => { $(id).value = [crop.x,crop.y,crop.width,crop.height][index]; });
}

function geometrySyncResize(changed = null) {
  const crop = geometryState.crop;
  if (!$('geometryResizeEnabled').checked) {
    $('geometryResizeWidth').value = crop.width;
    $('geometryResizeHeight').value = crop.height;
  } else if ($('geometryAspectLock').checked && changed) {
    const value = geometryInteger(changed === 'height' ? 'geometryResizeHeight' : 'geometryResizeWidth');
    if (Number.isSafeInteger(value) && value > 0) {
      if (changed === 'height') $('geometryResizeWidth').value = Math.max(1,Math.round(value * crop.width / crop.height));
      else $('geometryResizeHeight').value = Math.max(1,Math.round(value * crop.height / crop.width));
    }
  }
}

function geometryRefresh() {
  if (!geometryState.source) return;
  const resize = $('geometryResizeEnabled').checked;
  for (const id of geometryCropFields) $(id).disabled = geometryState.busy;
  for (const id of ['geometryResizeWidth','geometryResizeHeight','geometryAspectLock']) $(id).disabled = geometryState.busy || !resize;
  for (const id of ['geometryAutoCrop','geometryManualCrop','geometryFullImage','geometryResizeEnabled','geometryResetSize','geometryClose','geometryCancel']) $(id).disabled = geometryState.busy;
  $('geometryResetSize').disabled = geometryState.busy || !resize;
  $('geometryRemoveCanvas').disabled = geometryState.busy;
  $('geometryCanvasSettings').hidden = !geometryState.canvas;
  if (geometryState.canvas) $('geometryCanvasInfo').textContent = `${geometryState.canvas.size} × ${geometryState.canvas.size} px with ${geometryState.canvas.padding} px padding`;
  $('geometryDialog').setAttribute('aria-busy', String(geometryState.busy));
  $('geometryApply').textContent = geometryState.busy ? 'Saving…' : 'Apply changes';
  try {
    geometryCropFromFields();
    const size = geometryOutputSize();
    geometryError();
    $('geometryApply').disabled = geometryState.busy;
    $('geometryOutputDimensions').textContent = `${size.width} × ${size.height} px`;
    const preview = $('geometryOutputPreview'), ratio = Math.min(244 / size.width,122 / size.height,1);
    preview.width = Math.max(1,Math.round(size.width * ratio));
    preview.height = Math.max(1,Math.round(size.height * ratio));
    const context = preview.getContext('2d'), crop = geometryState.crop;
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    if (geometryState.canvas) {
      const {size,padding} = geometryState.canvas;
      const width=resize?geometryInteger('geometryResizeWidth'):crop.width, height=resize?geometryInteger('geometryResizeHeight'):crop.height;
      const scale=Math.min((size-2*padding)/width,(size-2*padding)/height);
      const fittedWidth=Math.max(1,Math.round(width*scale)),fittedHeight=Math.max(1,Math.round(height*scale));
      context.drawImage(geometryState.source,crop.x,crop.y,crop.width,crop.height,(size-fittedWidth)/2*ratio,(size-fittedHeight)/2*ratio,fittedWidth*ratio,fittedHeight*ratio);
    } else context.drawImage(geometryState.source,crop.x,crop.y,crop.width,crop.height,0,0,preview.width,preview.height);
  } catch (error) {
    geometryError(error.message);
    $('geometryApply').disabled = true;
  }
  geometryLayout();
}

function geometryLayout() {
  const source = geometryState.source, dialog = $('geometryDialog');
  if (!source || !dialog.open) return;
  const stage = $('geometryStage'), wrap = $('geometryCanvasWrap'), box = $('geometryCropBox');
  const scale = Math.min((stage.clientWidth - 34) / source.width,(stage.clientHeight - 34) / source.height);
  if (scale <= 0) return;
  geometryState.scale = scale;
  const width = source.width * scale, height = source.height * scale, crop = geometryState.crop;
  Object.assign(wrap.style,{width:`${width}px`,height:`${height}px`,left:`${(stage.clientWidth-width)/2}px`,top:`${(stage.clientHeight-height)/2}px`});
  Object.assign(box.style,{left:`${crop.x*scale}px`,top:`${crop.y*scale}px`,width:`${crop.width*scale}px`,height:`${crop.height*scale}px`});
}

function geometryCropChanged(crop, message) {
  geometryState.crop = crop;
  geometrySyncCropFields();
  geometrySyncResize('width');
  if (message) $('geometryStatus').textContent = message;
  geometryRefresh();
}

function geometryDetectCrop() {
  if (geometryState.autoBounds !== undefined) return geometryState.autoBounds;
  const source = geometryState.source;
  const pixels = source.getContext('2d').getImageData(0,0,source.width,source.height).data;
  let left = source.width, top = source.height, right = -1, bottom = -1;
  // Alpha 1 still belongs to the image: retain soft edges and faint shadows.
  for (let y=0;y<source.height;y++) for (let x=0;x<source.width;x++) {
    if (pixels[(y*source.width+x)*4+3] === 0) continue;
    left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x); bottom=Math.max(bottom,y);
  }
  geometryState.autoBounds = right < left ? null : {x:left,y:top,width:right-left+1,height:bottom-top+1};
  return geometryState.autoBounds;
}

function geometryAutoCrop() {
  const source = geometryState.source;
  if (!source || geometryState.busy) return;
  geometrySetMode('auto');
  geometrySetNewCrop(false);
  const crop = geometryDetectCrop();
  if (!crop) {
    $('geometryStatus').textContent = 'This image is fully transparent. There is no visible area to crop.';
    geometryRefresh();
    return;
  }
  geometryCropChanged(crop,crop.width === source.width && crop.height === source.height ? 'No empty transparent edges found. The full image is selected.' : 'Empty transparent edges detected. Soft edges and faint shadows are kept.');
}

function geometryPoint(event) {
  const rect = $('geometryCanvasWrap').getBoundingClientRect(), source = geometryState.source;
  return {x:Math.max(0,Math.min(source.width,Math.round((event.clientX-rect.left)/geometryState.scale))),y:Math.max(0,Math.min(source.height,Math.round((event.clientY-rect.top)/geometryState.scale)))};
}

function geometryPointerDown(event) {
  if (event.button !== 0 || !geometryState.source || geometryState.busy) return;
  const wrap = $('geometryCanvasWrap').getBoundingClientRect();
  if (event.clientX < wrap.left || event.clientX > wrap.right || event.clientY < wrap.top || event.clientY > wrap.bottom) return;
  event.preventDefault();
  const point = geometryPoint(event), handle = geometryState.newCrop ? null : event.target.dataset.handle;
  const inside = !geometryState.newCrop && !!event.target.closest('#geometryCropBox');
  geometryState.drag = {start:point,crop:{...geometryState.crop},kind:handle || (inside ? 'move' : 'create'),pointer:event.pointerId};
  try { $('geometryStage').setPointerCapture(event.pointerId); } catch { /* Synthetic pointer events have no active capture. */ }
  geometrySetMode('manual');
  if (!inside) {
    point.x = Math.min(point.x,geometryState.source.width-1); point.y = Math.min(point.y,geometryState.source.height-1);
    geometryCropChanged({x:point.x,y:point.y,width:1,height:1},'Drag to choose the area you want to keep.');
  }
}

function geometryPointerMove(event) {
  const drag = geometryState.drag, source = geometryState.source;
  if (!drag || event.pointerId !== drag.pointer || geometryState.busy) return;
  event.preventDefault();
  const point = geometryPoint(event), crop = drag.crop;
  if (drag.kind === 'move') {
    geometryCropChanged({...crop,x:Math.max(0,Math.min(source.width-crop.width,crop.x+point.x-drag.start.x)),y:Math.max(0,Math.min(source.height-crop.height,crop.y+point.y-drag.start.y))},'Drag the edges or corners to fine-tune your crop.');
    return;
  }
  let left=crop.x, top=crop.y, right=crop.x+crop.width, bottom=crop.y+crop.height;
  if (drag.kind === 'create') { left=drag.start.x; top=drag.start.y; right=point.x; bottom=point.y; }
  else {
    if (drag.kind.includes('w')) left=point.x;
    if (drag.kind.includes('e')) right=point.x;
    if (drag.kind.includes('n')) top=point.y;
    if (drag.kind.includes('s')) bottom=point.y;
  }
  const x=Math.min(left,right), y=Math.min(top,bottom);
  geometryCropChanged({x:Math.min(x,source.width-1),y:Math.min(y,source.height-1),width:Math.max(1,Math.abs(right-left)),height:Math.max(1,Math.abs(bottom-top))},'Drag the edges or corners to fine-tune your crop.');
}

function geometryPointerUp(event) {
  if (geometryState.drag?.pointer !== event.pointerId) return;
  if (geometryState.drag.kind==='create') geometrySetNewCrop(false);
  geometryState.drag = null;
  if ($('geometryStage').hasPointerCapture(event.pointerId)) $('geometryStage').releasePointerCapture(event.pointerId);
}

function updateGeometryButton() {
  $('geometryButton').disabled = !state.automatic || currentItem()?.status !== 'done' || state.busy;
}

function openGeometry() {
  if (state.busy || !state.automatic || currentItem()?.status !== 'done') return;
  if (state.dirty) { notice('Save your touch-up before cropping or resizing.'); return; }
  setTool(null);
  const source = getWorkingCanvas(), item = currentItem(), transform = item.transform || {};
  geometryState.crop = transform.crop ? {...transform.crop} : {x:0,y:0,width:source.width,height:source.height};
  geometryState.canvas = transform.canvas ? {...transform.canvas} : null;
  geometryState.drag = null; geometryState.busy = false;
  const preview = $('geometrySource'); preview.width=source.width; preview.height=source.height; preview.getContext('2d').drawImage(source,0,0);
  geometryState.source = preview; geometryState.autoBounds = undefined;
  geometrySyncCropFields();
  const detected = geometryDetectCrop();
  const matchesAuto = transform.crop && detected && ['x','y','width','height'].every(key => transform.crop[key] === detected[key]);
  const auto = !transform.resize && !transform.canvas && (!transform.crop || matchesAuto);
  geometrySetMode(auto ? 'auto' : 'manual'); geometrySetNewCrop(false);
  $('geometryResizeEnabled').checked = !!transform.resize;
  $('geometryResizeWidth').value = transform.resize?.width || geometryState.crop.width;
  $('geometryResizeHeight').value = transform.resize?.height || geometryState.crop.height;
  $('geometryAspectLock').checked = !transform.resize || Math.abs(transform.resize.width/transform.resize.height-geometryState.crop.width/geometryState.crop.height)<.001;
  $('geometryCropX').max=source.width-1; $('geometryCropY').max=source.height-1;
  $('geometryCropWidth').max=source.width; $('geometryCropHeight').max=source.height;
  $('geometryStatus').textContent = 'Your saved crop is ready. Drag the box or adjust its dimensions to change it.';
  $('geometryDialog').showModal();
  if (auto) geometryAutoCrop(); else geometryRefresh();
  requestAnimationFrame(geometryLayout);
}

async function geometryApply() {
  if (geometryState.busy || !geometryState.source) return;
  let crop, resize;
  try {
    crop = geometryCropFromFields(); geometryOutputSize();
    resize = $('geometryResizeEnabled').checked ? {width:geometryInteger('geometryResizeWidth'),height:geometryInteger('geometryResizeHeight')} : null;
  } catch (error) { geometryError(error.message); return; }
  const source=geometryState.source, item=currentItem();
  if (crop.x===0 && crop.y===0 && crop.width===source.width && crop.height===source.height) crop=null;
  geometryState.busy=true; state.busy=true; updateTools(); geometryRefresh();
  let failure='';
  try {
    const result = await api(`/jobs/${state.job.id}/items/${item.id}/transform`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.editRevision,crop,resize,canvas:geometryState.canvas})});
    await acceptGeometryResult(result);
    $('geometryDialog').close();
  } catch (error) { failure=error.message; }
  finally { geometryState.busy=false; state.busy=false; updateTools(); if ($('geometryDialog').open) { geometryRefresh(); if (failure) geometryError(failure); } }
}

function initializeGeometry() {
  if (geometryState.initialized) return;
  geometryState.initialized=true;
  $('geometryButton').onclick=safely(openGeometry);
  $('geometryAutoCrop').onclick=geometryAutoCrop;
  $('geometryManualCrop').onclick=() => { geometrySetMode('manual'); geometrySetNewCrop(true); $('geometryStatus').textContent='Drag to draw a new crop box. Then move the box or adjust its edges and corners.'; $('geometryStage').focus(); };
  $('geometryFullImage').onclick=() => { geometrySetMode('manual'); geometrySetNewCrop(true); const s=geometryState.source; geometryCropChanged({x:0,y:0,width:s.width,height:s.height},'The full image is selected.'); };
  for (const id of geometryCropFields) $(id).oninput=() => {
    geometrySetMode('manual'); geometrySetNewCrop(false);
    try { geometryState.crop=geometryCropFromFields(); geometrySyncResize('width'); geometryRefresh(); }
    catch (error) { geometryError(error.message); $('geometryApply').disabled=true; }
  };
  const manualResize = changed => { geometrySetMode('manual'); geometrySetNewCrop(false); geometrySyncResize(changed); geometryRefresh(); };
  $('geometryResizeEnabled').onchange=() => manualResize();
  $('geometryResizeWidth').oninput=() => manualResize('width');
  $('geometryResizeHeight').oninput=() => manualResize('height');
  $('geometryAspectLock').onchange=() => manualResize('width');
  $('geometryResetSize').onclick=() => { $('geometryResizeEnabled').checked=false; $('geometryAspectLock').checked=true; manualResize(); };
  $('geometryRemoveCanvas').onclick=() => { geometryState.canvas=null; geometrySetMode('manual'); geometryRefresh(); };
  $('geometryApply').onclick=geometryApply;
  const close=() => { if (!geometryState.busy) $('geometryDialog').close(); };
  $('geometryCancel').onclick=close; $('geometryClose').onclick=close;
  $('geometryDialog').addEventListener('cancel',event => { if (geometryState.busy) event.preventDefault(); });
  $('geometryDialog').addEventListener('close',() => { geometryState.drag=null; geometryState.source=null; $('geometrySource').width=1; $('geometrySource').height=1; });
  $('geometryDialog').addEventListener('keydown',event => { if (event.key==='Enter' && event.target.matches('input[type=number]')) { event.preventDefault(); if (!$('geometryApply').disabled) geometryApply(); } });
  $('geometryStage').addEventListener('pointerdown',geometryPointerDown);
  $('geometryStage').addEventListener('pointermove',geometryPointerMove);
  $('geometryStage').addEventListener('pointerup',geometryPointerUp);
  $('geometryStage').addEventListener('pointercancel',geometryPointerUp);
  $('geometryStage').addEventListener('lostpointercapture',geometryPointerUp);
  new ResizeObserver(geometryLayout).observe($('geometryStage'));
  updateGeometryButton();
}

initializeGeometry();
