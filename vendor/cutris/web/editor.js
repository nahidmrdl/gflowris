'use strict';
// Navigation is a viewport transform only: image pixels and edit coordinates
// always remain at original resolution.
let panPosition=null, panDrag=null, spaceHeld=false, lastViewportSize=null;
let wandWorker=null, wandRequest=0, selection=null, wandSeed=null, toleranceTimer=null;

function applyPan() {
  if(!panPosition || !state.original) return;
  const vp=$('viewport'), w=canvas.width*state.scale,h=canvas.height*state.scale;
  panPosition.x=Math.max(vp.clientWidth/2-w,Math.min(vp.clientWidth/2,panPosition.x));
  panPosition.y=Math.max(vp.clientHeight/2-h,Math.min(vp.clientHeight/2,panPosition.y));
  $('canvasWrap').style.transform=`translate(${panPosition.x}px,${panPosition.y}px)`;
}
function layoutCanvas() {
  if(!state.original) return;
  const vp=$('viewport'), fit=$('zoom').value==='fit';
  state.scale=fit ? Math.max(.001,Math.min((vp.clientWidth-32)/canvas.width,(vp.clientHeight-32)/canvas.height,1)) : Number($('zoom').value);
  const w=canvas.width*state.scale,h=canvas.height*state.scale;
  canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;
  $('canvasWrap').style.width=`${w}px`;$('canvasWrap').style.height=`${h}px`;
  $('canvasWrap').style.marginTop='0';
  if(fit || !panPosition) panPosition={x:(vp.clientWidth-w)/2,y:(vp.clientHeight-h)/2};
  else if(lastViewportSize) {panPosition.x+=(vp.clientWidth-lastViewportSize.w)/2;panPosition.y+=(vp.clientHeight-lastViewportSize.h)/2;}
  lastViewportSize={w:vp.clientWidth,h:vp.clientHeight};applyPan();
}
function changeZoom(value,clientX,clientY) {
  if(!state.original || state.drawing || panDrag) return;
  const vp=$('viewport'), rect=vp.getBoundingClientRect(), bounds=canvas.getBoundingClientRect();
  clientX ??= rect.left+vp.clientWidth/2; clientY ??= rect.top+vp.clientHeight/2;
  const ix=(clientX-bounds.left)/state.scale,iy=(clientY-bounds.top)/state.scale;
  if(value==='fit') {$('zoom').value='fit';layoutCanvas();return;}
  const scale=Math.max(.05,Math.min(8,Number(value)));
  let option=$('zoom').querySelector('[data-custom]');
  if(!option) {option=document.createElement('option');option.dataset.custom='true';$('zoom').append(option);}
  option.value=String(scale);option.textContent=`${Math.round(scale*100)}%`;$('zoom').value=String(scale);
  layoutCanvas();
  panPosition={x:clientX-rect.left-vp.clientLeft-ix*scale,y:clientY-rect.top-vp.clientTop-iy*scale};applyPan();
  $('brushCursor').hidden=true;
}
function setEditorCursor() {
  const pan=!state.tool||spaceHeld;
  const cursor=!state.original?'default':panDrag?'grabbing':pan?'grab':'crosshair';
  canvas.style.cursor=cursor;$('viewport').style.cursor=cursor;
  canvas.style.touchAction=state.original?'none':'auto';
  $('viewport').style.touchAction=state.original&&pan?'none':'auto';
}
function clearSelection() {
  clearTimeout(toleranceTimer); wandRequest++; wandWorker?.terminate();wandWorker=null;
  selection=null;wandSeed=null;
  const overlay=$('selectionOverlay'); if(overlay) {overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);overlay.hidden=true;}
  if($('selectionStatus')) $('selectionStatus').textContent='Click a leftover patch to preview a connected-color selection.';
  if($('eraseSelection')) {$('eraseSelection').disabled=true;$('clearSelection').disabled=true;}
}
function selectConnected(x,y) {
  if(!state.automatic || state.busy || state.view!=='result') return;
  wandWorker?.terminate(); clearTimeout(toleranceTimer);
  const request=++wandRequest, loadId=state.loadId;
  x=Math.floor(x);y=Math.floor(y);
  if(x<0||y<0||x>=canvas.width||y>=canvas.height) return;
  wandSeed=[x,y]; selection=null;
  $('selectionOverlay').hidden=true;$('eraseSelection').disabled=true;$('clearSelection').disabled=false;
  $('selectionStatus').textContent='Finding connected pixels…';
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
  wandWorker=new Worker('/wand-worker.js');
  wandWorker.onmessage=({data})=>{
    if(request!==wandRequest||loadId!==state.loadId) return;
    wandWorker?.terminate();wandWorker=null;
    if(data.error) {$('selectionStatus').textContent=data.error;return;}
    if(!data.pixels) {$('selectionStatus').textContent='That pixel is already transparent. Click inside the leftover patch.';return;}
    selection=data;
    const overlay=$('selectionOverlay');overlay.width=canvas.width;overlay.height=canvas.height;
    const context=overlay.getContext('2d');context.fillStyle='rgba(255,48,150,0.52)';
    for(const [row,left,right] of data.spans) context.fillRect(left,row,right-left,1);
    overlay.hidden=false;$('eraseSelection').disabled=state.busy;
    const percentage=data.pixels/(canvas.width*canvas.height)*100;
    $('selectionStatus').textContent=`${data.pixels.toLocaleString()} pixels selected (${percentage.toFixed(2)}%). ${percentage>10?'Large selection—check carefully or lower tolerance.':'Pink is a preview only; check the frame before erasing.'}`;
  };
  wandWorker.onerror=()=>{if(request===wandRequest){$('selectionStatus').textContent='Selection could not be computed. Try a smaller image or the brush.';wandWorker?.terminate();wandWorker=null;}};
  wandWorker.postMessage({buffer:pixels.data.buffer,width:canvas.width,height:canvas.height,x,y,tolerance:Number($('tolerance').value)},[pixels.data.buffer]);
}
function initializeEditor() {
  const vp=$('viewport');
  // Right-drag is navigation in every tool; suppress the image context menu
  // only in the preview, leaving the rest of the page's context menus intact.
  vp.addEventListener('contextmenu',event=>{if(state.original)event.preventDefault();});
  vp.addEventListener('wheel',event=>{
    if(!state.original || !(event.ctrlKey||event.metaKey||$('wheelZoom').checked)) return;
    event.preventDefault();
    if(!event.deltaY) return;
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?vp.clientHeight:1);
    changeZoom(state.scale*Math.exp(-Math.max(-250,Math.min(250,delta))*.0025),event.clientX,event.clientY);
  },{passive:false});
  vp.addEventListener('pointerdown',event=>{
    if(!state.original || state.drawing || panDrag || !(event.button===2 || event.button===1 || (event.button===0&&(!state.tool||spaceHeld||event.target===vp)))) return;
    event.preventDefault();event.stopPropagation();
    panDrag={pointerId:event.pointerId,buttons:event.button===2?2:event.button===1?4:1,x:event.clientX,y:event.clientY,origin:{...panPosition}};
    vp.setPointerCapture(event.pointerId);$('brushCursor').hidden=true;setEditorCursor();
  },true);
  vp.addEventListener('pointermove',event=>{if(panDrag?.pointerId===event.pointerId){if(!(event.buttons&panDrag.buttons)){endPan(event);return;}panPosition={x:panDrag.origin.x+event.clientX-panDrag.x,y:panDrag.origin.y+event.clientY-panDrag.y};applyPan();event.preventDefault();}});
  function endPan(event){if(panDrag?.pointerId===event.pointerId){panDrag=null;if(vp.hasPointerCapture(event.pointerId))vp.releasePointerCapture(event.pointerId);setEditorCursor();}}
  vp.addEventListener('pointerup',endPan);vp.addEventListener('pointercancel',endPan);vp.addEventListener('lostpointercapture',()=>{panDrag=null;setEditorCursor();});
  document.addEventListener('keydown',event=>{
    if(/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)||document.querySelector('dialog[open]'))return;
    if(event.code==='Space'&&state.original){event.preventDefault();spaceHeld=true;setEditorCursor();}
    if(event.key==='Escape'){if(selection||wandWorker||wandSeed)clearSelection();else setTool(null);}
  });
  document.addEventListener('keyup',event=>{if(event.code==='Space'){spaceHeld=false;setEditorCursor();}});
  window.addEventListener('blur',()=>{spaceHeld=false;panDrag=null;setEditorCursor();});
  $('zoom').onchange=()=>changeZoom($('zoom').value);
  $('fit').onclick=()=>changeZoom('fit');$('actual').onclick=()=>changeZoom(1);
  $('zoomIn').onclick=()=>changeZoom(state.scale*1.25);$('zoomOut').onclick=()=>changeZoom(state.scale/1.25);
  function syncBrush(value){const size=Math.round(Math.max(1,Math.min(500,Number(value)||1)));$('brushSize').value=size;$('brushNumber').value=size;$('brushCursor').hidden=true;}
  $('brushSize').oninput=()=>syncBrush($('brushSize').value);
  $('brushNumber').oninput=()=>{const n=Number($('brushNumber').value);if($('brushNumber').value&&Number.isFinite(n)&&n>=1&&n<=500)$('brushSize').value=Math.round(n);};
  $('brushNumber').onchange=()=>syncBrush($('brushNumber').value);
  $('brushNumber').onkeydown=event=>{if(event.key==='Enter'){syncBrush(event.target.value);event.target.blur();}};
  function tolerance(value){const n=Math.round(Math.max(0,Math.min(100,Number(value)||0)));$('tolerance').value=n;$('toleranceNumber').value=n;clearTimeout(toleranceTimer);if(wandSeed){const seed=[...wandSeed];clearSelection();wandSeed=seed;$('selectionStatus').textContent='Updating selection…';toleranceTimer=setTimeout(()=>selectConnected(...seed),150);}}
  $('tolerance').oninput=()=>tolerance($('tolerance').value);
  $('toleranceNumber').onchange=()=>tolerance($('toleranceNumber').value);
  $('clearSelection').onclick=clearSelection;
  $('eraseSelection').onclick=()=>{
    if(!selection||state.busy)return;
    if(state.strokes.length>=500||state.strokes.reduce((n,s)=>n+(s.spans?.length||0),0)+selection.spans.length>200000){notice('Too many edits for this image. Undo or reset some edits before adding this selection.');return;}
    state.strokes.push({mode:'wand',size:1,points:[],spans:selection.spans});state.redo=[];state.dirty=true;
    clearSelection();renderCanvas();updateTools();
  };
}
