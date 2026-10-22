'use strict';
const $ = id => document.getElementById(id);
const state = {token: '', files: [], job: null, selected: null, original: null, automatic: null, output: null, strokes: [], redo: [], dirty: false, tool: null, view: 'result', scale: 1, drawing: null, busy: false, loadId: 0, editRevision: 0};
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const escapeText = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
async function api(path, options = {}) {
  const response = await fetch('/api' + path, {...options, headers: {'X-Cutout-Token': state.token, ...options.headers}});
  if (!response.ok) { let message; try { const error = await response.json(); message = typeof error.detail === 'string' ? error.detail : 'Invalid image or touch-up data.'; } catch { message = `Request failed (${response.status}).`; } throw new Error(message); }
  return response.json();
}
function safely(fn) { return async (...args) => { try { await fn(...args); } catch (error) { notice(error.message); } }; }
function confirmAction(text, title = 'Unsaved touch-up', yes = 'Discard changes', no = 'Keep editing') {
  return new Promise(resolve => {
    $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmYes').textContent = yes;
    $('confirmNo').textContent = no;
    const dialog = $('confirmDialog'); dialog.showModal();
    const finish = answer => { dialog.close(); dialog.oncancel = null; resolve(answer); };
    $('confirmYes').onclick = () => finish(true); $('confirmNo').onclick = () => finish(false);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
  });
}
async function canLeave() { return !state.dirty || await confirmAction('Your latest brush strokes have not been saved. Save them first, or discard these changes.'); }
function imageURL(item, kind = 'result') { return `/api/jobs/${state.job.id}/items/${item.id}/${kind}?v=${item.revision || 0}`; }
function currentItem() { return state.job?.items.find(item => item.id === state.selected); }
function renderQueue() {
  const job = state.job;
  $('setup').hidden = !!job; $('settings').hidden = !!job; $('batchActions').hidden = !job;
  $('queueCount').textContent = `${job ? job.items.length : state.files.length} / 50`;
  $('start').disabled = !state.files.length || state.busy || (state.models && !state.models[$('quality').value]);
  const processing = job && ['queued','running','pausing','stopping'].includes(job.status);
  $('clear').disabled = (!job && !state.files.length) || state.busy || !!processing;
  $('clear').title = processing ? 'Stop the queue before clearing it.' : 'Clear this view. Saved images and previous batches are kept.';
  $('sort').hidden = !!job; $('sort').disabled = state.busy;
  const list = job ? job.items : state.files;
  const queueHTML = list.length ? list.map((item, index) => {
    const name = job ? item.name : item.file.name;
    const src = job ? (item.width ? imageURL(item, item.status === 'done' ? 'thumbnail' : 'original-thumbnail') : '') : item.url;
    const status = job ? ({waiting: 'Waiting', running: 'Working on the details…', done: item.revision ? 'Saved changes ready' : 'Ready to review', error: 'Could not process', cancelled: 'Cancelled'}[item.status]) : `${(item.file.size / 1024 / 1024).toFixed(1)} MB`;
    return `<div class="queue-item ${state.selected === item.id ? 'selected' : ''}" data-id="${item.id}" tabindex="0" role="button" aria-label="Preview ${escapeText(name)}"><span class="queue-number">${String(index + 1).padStart(2, '0')}</span>${src ? `<img src="${src}" alt="" loading="lazy">` : '<span>!</span>'}<div class="queue-copy"><strong title="${escapeText(name)}">${escapeText(name)}</strong><small>${status}</small></div>${job ? `<span class="status-dot ${item.status}"></span>` : `<div class="moves"><button data-move="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move ${escapeText(name)} up" title="Move up">↑</button><button data-move="1" ${index === list.length - 1 ? 'disabled' : ''} aria-label="Move ${escapeText(name)} down" title="Move down">↓</button><button data-remove="1" aria-label="Remove ${escapeText(name)}" title="Remove from queue">×</button></div>`}</div>`;
  }).join('') : '<div class="empty-queue">Your next batch of images belongs here.</div>';
  if (state.queueHTML !== queueHTML) { $('queue').innerHTML = queueHTML; state.queueHTML = queueHTML; }
  if (job) {
    const completed = job.items.filter(i => ['done', 'error', 'cancelled'].includes(i.status)).length;
    const ready = job.items.filter(i => i.status === 'done').length;
    const failed = job.items.filter(i => i.status === 'error').length;
    $('progressBar').style.width = `${completed / job.items.length * 100}%`;
    $('progressLabel').textContent = `${ready} of ${job.items.length} ready${failed ? `, ${failed} failed` : ''}`;
    $('stage').textContent = job.status === 'pausing' ? 'Will pause as soon as this image is finished.' : job.stage;
    $('pause').hidden = false; $('pause').disabled = state.busy || !['queued','running','paused'].includes(job.status);
    $('pause').textContent = job.status === 'paused' ? 'Resume queue' : 'Pause queue';
    $('stopQueue').disabled = state.stoppingQueue || !['queued','running','pausing','paused'].includes(job.status);
    $('stopQueue').textContent = state.stoppingQueue || job.status === 'stopping' ? 'Stopping…' : 'Stop queue';
    $('retry').hidden = !failed || !['paused', 'complete', 'stopped'].includes(job.status);
    $('zip').disabled = !ready || state.dirty || state.busy; $('zip').textContent = `Download ${ready} PNG${ready === 1 ? '' : 's'} (ZIP)`;
    $('newBatch').disabled = state.busy || !['paused', 'complete', 'stopped'].includes(job.status);
  }
  if (typeof updateBatchTools === 'function') updateBatchTools();
}
async function addFiles(files) {
  if (state.job || state.busy) return;
  const incoming = Array.from(files);
  if (state.files.length + incoming.length > 50) { notice('A batch can contain up to 50 images. No files were added; choose a smaller selection.'); return; }
  const rejected = incoming.filter(file => file.size > 30 * 1024 * 1024 || !/\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name));
  const accepted = incoming.filter(file => !rejected.includes(file));
  accepted.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
  state.files.push(...accepted.map(file => ({id: crypto.randomUUID(), file, url: URL.createObjectURL(file)})));
  notice(rejected.length ? `${rejected.length} file(s) were skipped. Use JPG, PNG, WebP, BMP, or TIFF, no larger than 30 MB each.` : 'Queue starts in filename order. Use ↑ and ↓ to change the output order.');
  renderQueue(); if (!state.selected && state.files.length) await selectFile(state.files[0].id);
}
$('files').onchange = safely(async event => { await addFiles(event.target.files); event.target.value = ''; });
$('dropZone').onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); $('files').click(); } };
for (const name of ['dragenter', 'dragover']) $('dropZone').addEventListener(name, event => { event.preventDefault(); $('dropZone').classList.add('over'); });
$('dropZone').ondragleave = () => $('dropZone').classList.remove('over');
$('dropZone').ondrop = safely(async event => { event.preventDefault(); $('dropZone').classList.remove('over'); await addFiles(event.dataTransfer.files); });
window.addEventListener('dragover', event => event.preventDefault()); window.addEventListener('drop', event => event.preventDefault());
$('sort').onclick = () => { state.files.sort((a,b) => a.file.name.localeCompare(b.file.name, undefined, {numeric:true})); renderQueue(); };
$('clear').onclick = safely(async () => {
  if (state.busy || state.job && ['queued','running','pausing','stopping'].includes(state.job.status)) return;
  if (!await canLeave()) return;
  state.files.forEach(f => URL.revokeObjectURL(f.url)); state.files = []; state.job = null;
  localStorage.removeItem('cutout-job'); emptyPreview(); renderQueue(); updateTools();
  notice('Queue cleared. Saved files and previous batches are kept.');
});
$('queue').onclick = safely(async event => {
  const row = event.target.closest('.queue-item'); if (!row || state.busy) return;
  const index = state.files.findIndex(f => f.id === row.dataset.id);
  const button = event.target.closest('button');
  if (!state.job && button?.dataset.move) { const target = index + Number(button.dataset.move); if (target >= 0 && target < state.files.length) [state.files[index], state.files[target]] = [state.files[target], state.files[index]]; renderQueue(); }
  else if (!state.job && button?.dataset.remove) { URL.revokeObjectURL(state.files[index].url); state.files.splice(index, 1); if (state.selected === row.dataset.id) emptyPreview(); renderQueue(); }
  else await selectFile(row.dataset.id);
});
$('queue').onkeydown = event => { if (event.target.classList.contains('queue-item') && ['Enter',' '].includes(event.key)) { event.preventDefault(); event.target.click(); } };
function emptyPreview() { clearSelection(); state.loadId++; state.selected = null; state.original = null; state.automatic = null; state.output = null; state.strokes = []; state.redo = []; state.dirty = false; $('canvasWrap').hidden = true; $('previewEmpty').hidden = false; $('imageName').textContent = 'A clean little workspace'; $('imageStatus').textContent = 'Nothing is uploaded to a cloud service.'; $('dimensions').textContent = 'Full-resolution preview'; updateTools(); }
function loadImage(url) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Could not load this image preview.')); image.src = url; }); }
async function selectFile(id, force = false) {
  if (!force && state.selected === id) return;
  if (!force && !await canLeave()) return;
  const item = state.job ? state.job.items.find(i => i.id === id) : state.files.find(i => i.id === id);
  if (!item) return;
  const loadId = ++state.loadId;
  state.selected = id; state.original = null; state.automatic = null; state.output = null; state.strokes = []; state.redo = []; state.dirty = false; state.drawing = null; setTool(null);
  $('canvasWrap').hidden = true; $('previewEmpty').hidden = false;
  renderQueue(); updateTools();
  $('imageName').textContent = state.job ? item.name : item.file.name;
  $('imageStatus').textContent = item.error || 'Loading preview…';
  if (state.job && !item.width) { notice(item.error || 'This file could not be read.'); return; }
  let original, automatic, output;
  try { [original, automatic, output] = await Promise.all([loadImage(state.job ? imageURL(item, 'original') : item.url), state.job && item.status === 'done' ? loadImage(imageURL(item, 'automatic')) : Promise.resolve(null), state.job && item.status === 'done' ? loadImage(imageURL(item)) : Promise.resolve(null)]); }
  catch (error) { if (!state.job && /\.tiff?$/i.test(item.file.name)) { $('imageStatus').textContent = 'TIFF preview will be available after processing.'; return; } throw error; }
  if (loadId !== state.loadId) return;
  state.original = original; state.automatic = automatic; state.output = output; state.strokes = structuredClone(item.strokes || []); state.editRevision = item.revision || 0;
  state.view = automatic ? 'result' : 'original'; $('zoom').value = 'fit';
  canvas.width = original.naturalWidth; canvas.height = original.naturalHeight;
  $('previewEmpty').hidden = true; $('canvasWrap').hidden = false;
  $('dimensions').textContent = `${canvas.width} × ${canvas.height} px`;
  $('imageStatus').textContent = automatic ? 'Transparent PNG at original dimensions' : item.error || (state.job ? 'Original image; cutout not ready yet' : 'Original image ready for the queue');
  $('notes').innerHTML = (item.notes?.length ? item.notes : ['Inspect the edges at 100%, especially pale details. White-on-white features may need a touch-up.']).map(note => `<p>${escapeText(note)}</p>`).join('');
  resizeCanvas(); renderCanvas(); updateTools();
}
function resizeCanvas() {
  layoutCanvas();
}
new ResizeObserver(resizeCanvas).observe($('viewport'));
function paint(stroke, points = stroke.points, target = ctx) {
  const surface = target.canvas;
  if (stroke.mode === 'wand') { for (const [y,x0,x1] of stroke.spans) target.clearRect(x0,y,x1-x0,1); return; }
  if (!points.length) return;
  target.save(); target.lineCap = 'round'; target.lineJoin = 'round'; target.lineWidth = stroke.size;
  target.beginPath(); target.moveTo(...points[0]);
  if (points.length === 1) { target.arc(points[0][0], points[0][1], stroke.size / 2, 0, Math.PI*2); }
  else for (const point of points.slice(1)) target.lineTo(...point);
  if (stroke.mode === 'erase') { target.globalCompositeOperation = 'destination-out'; target.strokeStyle = '#000'; target.fillStyle = '#000'; if (points.length === 1) target.fill(); else target.stroke(); }
  else {
    // A temporary stroke mask restores pixels from the untouched full-size source.
    const pad = stroke.size / 2 + 2;
    const x0 = Math.max(0, Math.floor(Math.min(...points.map(p=>p[0])) - pad));
    const y0 = Math.max(0, Math.floor(Math.min(...points.map(p=>p[1])) - pad));
    const x1 = Math.min(surface.width, Math.ceil(Math.max(...points.map(p=>p[0])) + pad));
    const y1 = Math.min(surface.height, Math.ceil(Math.max(...points.map(p=>p[1])) + pad));
    if (x1 <= x0 || y1 <= y0) { target.restore(); return; }
    const brush = document.createElement('canvas'); brush.width = x1-x0; brush.height = y1-y0;
    const b = brush.getContext('2d'); b.translate(-x0,-y0); b.lineWidth = stroke.size; b.lineCap = 'round'; b.lineJoin = 'round'; b.beginPath(); b.moveTo(...points[0]);
    if (points.length === 1) { b.arc(points[0][0], points[0][1], stroke.size / 2, 0, Math.PI*2); b.fill(); }
    else { for (const point of points.slice(1)) b.lineTo(...point); b.stroke(); }
    b.globalCompositeOperation = 'source-in'; b.drawImage(state.original, 0, 0); target.drawImage(brush, x0, y0);
  }
  target.restore();
}
function getWorkingCanvas() {
  const working = document.createElement('canvas');
  working.width = state.original.naturalWidth; working.height = state.original.naturalHeight;
  const context = working.getContext('2d');
  context.drawImage(state.automatic || state.original, 0, 0);
  if (state.automatic) state.strokes.forEach(stroke => paint(stroke, stroke.points, context));
  return working;
}
function outputDimensions(item = currentItem()) {
  return [item?.output_width || item?.width || canvas.width, item?.output_height || item?.height || canvas.height];
}
function renderCanvas() {
  if (!state.original) return;
  const previousWidth = canvas.width, previousHeight = canvas.height;
  const result = state.view === 'result' && !!state.automatic;
  const outputView = result && !state.tool;
  if (outputView && !state.dirty && state.output) {
    canvas.width = state.output.naturalWidth; canvas.height = state.output.naturalHeight;
    ctx.drawImage(state.output, 0, 0);
  } else {
    canvas.width = state.original.naturalWidth; canvas.height = state.original.naturalHeight;
    ctx.drawImage(result ? state.automatic : state.original, 0, 0);
    if (result) state.strokes.forEach(stroke => paint(stroke));
    const transform = currentItem()?.transform;
    if (outputView && (transform?.crop || transform?.resize || transform?.canvas)) {
      const crop = transform.crop || {x:0, y:0, width:canvas.width, height:canvas.height};
      const width = transform.resize?.width || crop.width, height = transform.resize?.height || crop.height;
      const preview = document.createElement('canvas'); preview.width = width; preview.height = height;
      const context = preview.getContext('2d'); context.imageSmoothingQuality = 'high';
      context.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      if (transform.canvas) {
        const {size, padding} = transform.canvas, scale = Math.min((size-2*padding)/width,(size-2*padding)/height);
        const fittedWidth = Math.max(1,Math.round(width*scale)), fittedHeight = Math.max(1,Math.round(height*scale));
        canvas.width = size; canvas.height = size;
        ctx.imageSmoothingQuality = 'high'; ctx.drawImage(preview,(size-fittedWidth)/2,(size-fittedHeight)/2,fittedWidth,fittedHeight);
      } else { canvas.width = width; canvas.height = height; ctx.drawImage(preview, 0, 0); }
    }
  }
  $('dimensions').textContent = `${canvas.width} × ${canvas.height} px`;
  const [width, height] = outputDimensions();
  const transformed = !!(currentItem()?.transform?.crop || currentItem()?.transform?.resize || currentItem()?.transform?.canvas);
  $('imageStatus').textContent = !result ? (currentItem()?.error || 'Original image unchanged') : state.tool && transformed ? `Editing the full canvas for a ${width} × ${height} px output` : transformed ? `Transparent PNG, ${currentItem().transform.canvas ? 'square canvas' : currentItem().transform.crop ? (currentItem().transform.resize ? 'cropped and resized' : 'cropped') : 'resized'}` : 'Transparent PNG at original dimensions';
  if (previousWidth !== canvas.width || previousHeight !== canvas.height) panPosition = null;
  layoutCanvas();
}
async function acceptGeometryResult(result) {
  const item = currentItem(), loadId = state.loadId;
  state.editGeneration = (state.editGeneration || 0) + 1;
  Object.assign(item, result); state.editRevision = result.revision; state.output = null; state.view = 'result';
  renderCanvas(); renderQueue();
  const output = await loadImage(imageURL(item));
  if (loadId !== state.loadId) return;
  state.output = output; renderCanvas();
}
function updateTools() {
  if (typeof syncDesktopState === 'function') syncDesktopState();
  const ready = !!state.automatic && currentItem()?.status === 'done';
  if (typeof updateGeometryButton === 'function') updateGeometryButton();
  if (typeof updateBatchTools === 'function') updateBatchTools();
  for (const id of ['eraseTool','restoreTool','wandTool','brushSize','brushNumber','tolerance','toleranceNumber']) $(id).disabled = !ready || state.busy;
  $('doneEditing').hidden = !state.tool;
  $('doneEditing').disabled = state.busy;
  setEditorCursor();
  $('eraseSelection').disabled = !selection || !ready || state.busy;
  $('undo').disabled = !ready || !state.strokes.length || state.busy; $('redo').disabled = !ready || !state.redo.length || state.busy;
  $('reset').disabled = !ready || !(state.strokes.length || currentItem()?.strokes?.length || state.dirty) || state.busy;
  $('historyButton').disabled = state.busy;
  if (state.job) $('newBatch').disabled = state.busy || !['paused','complete'].includes(state.job.status);
  $('save').disabled = !ready || !state.dirty || state.busy; $('download').disabled = !ready || state.dirty || state.busy;
  if (state.job) $('zip').disabled = state.busy || state.dirty || !state.job.items.some(i => i.status === 'done');
  $('dirtyLabel').textContent = state.dirty ? 'Save your touch-up before downloading' : ready ? 'Saved. Your original is safely preserved.' : 'Select a finished image to touch up.';
  $('resultView').classList.toggle('active', state.view === 'result'); $('originalView').classList.toggle('active', state.view === 'original');
  $('resultView').setAttribute('aria-pressed', state.view === 'result'); $('originalView').setAttribute('aria-pressed', state.view === 'original');
  $('resultView').disabled = !ready;
}
function setTool(tool) { clearSelection(); state.tool = tool; for (const name of ['erase','restore','wand']) { $(name + 'Tool').classList.toggle('active', name === tool); $(name + 'Tool').setAttribute('aria-pressed', name === tool); } if (tool) state.view = 'result'; renderCanvas(); $('wandPanel').hidden = tool !== 'wand'; $('brushCursor').hidden = true; setEditorCursor(); updateTools(); }
for (const tool of ['erase','restore','wand']) $(tool+'Tool').onclick = () => setTool(state.tool === tool ? null : tool);
$('doneEditing').onclick = () => setTool(null);
function point(event) { const rect = canvas.getBoundingClientRect(); return [Math.max(-250,Math.min(canvas.width+250,(event.clientX - rect.left) * canvas.width / rect.width)), Math.max(-250,Math.min(canvas.height+250,(event.clientY - rect.top) * canvas.height / rect.height))]; }
function cursor(event) { if (!['erase','restore'].includes(state.tool) || spaceHeld || state.view !== 'result') { $('brushCursor').hidden = true; return; } const [x,y] = point(event); const c = $('brushCursor'); c.hidden = false; c.style.left = `${x * state.scale}px`; c.style.top = `${y * state.scale}px`; c.style.width = c.style.height = `${Number($('brushSize').value) * state.scale}px`; }
canvas.onpointerdown = event => {
  if (event.button !== 0 || !state.tool || !state.automatic || state.busy) return;
  if (state.tool === 'wand') { event.preventDefault(); selectConnected(...point(event)); return; }
  if (state.strokes.length >= 500) { notice('This image has reached 500 brush strokes. Start a new batch with the saved PNG for further edits.'); return; }
  event.preventDefault(); canvas.setPointerCapture(event.pointerId);
  state.drawing = {mode:state.tool, size:Number($('brushSize').value), points:[point(event)]}; state.strokes.push(state.drawing); state.redo = []; state.dirty = true; paint(state.drawing); cursor(event); updateTools();
};
canvas.onpointermove = event => { cursor(event); if (!state.drawing) return; for (const sample of (event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event])) { const p = point(sample), last = state.drawing.points.at(-1); if (Math.hypot(p[0]-last[0],p[1]-last[1]) < .4) continue; if (state.drawing.points.length >= 20000) break; state.drawing.points.push(p); paint(state.drawing, [last,p]); } };
function finishStroke(event) { if (state.drawing) { state.drawing = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); renderCanvas(); } }
canvas.onpointerup = finishStroke; canvas.onpointercancel = finishStroke; canvas.onlostpointercapture = () => { state.drawing = null; }; canvas.onpointerleave = () => { $('brushCursor').hidden = true; };
$('undo').onclick = () => { if (!state.strokes.length || state.busy) return; clearSelection(); state.redo.push(state.strokes.pop()); state.dirty = true; renderCanvas(); updateTools(); };
$('redo').onclick = () => { if (!state.redo.length || state.busy) return; clearSelection(); state.strokes.push(state.redo.pop()); state.dirty = true; renderCanvas(); updateTools(); };
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); (event.shiftKey ? $('redo') : $('undo')).click(); } });
$('reset').onclick = safely(async () => {
  if (state.busy || !state.automatic || !currentItem()) return;
  if (!await confirmAction('Remove all brush and magic-wand touch-ups from this image? Your crop and output size will stay the same. The source image is untouched. Redo can reapply the edits in this tab.', 'Back to processed version?', 'Undo all touch-ups', 'Keep touch-ups')) return;
  const item = currentItem(), loadId = state.loadId;
  const previous = structuredClone(state.strokes.length ? state.strokes : (item.strokes || []));
  state.busy = true; updateTools();
  try {
    const result = await api(`/jobs/${state.job.id}/items/${item.id}/edits`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revision:state.editRevision, strokes:[]})});
    Object.assign(item, result); item.strokes = [];
    if (state.loadId === loadId) {
      clearSelection(); state.editRevision = result.revision; state.redo = previous.reverse(); state.strokes = []; state.dirty = false; state.view = 'result';
      await acceptGeometryResult(result); notice('All touch-ups undone. Your crop and output size are kept.');
    }
  } finally { state.busy = false; updateTools(); }
});
$('save').onclick = safely(async () => {
  if (state.busy || !currentItem()) return;
  state.busy = true; updateTools();
  try { const item = currentItem(); const result = await api(`/jobs/${state.job.id}/items/${item.id}/edits`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revision:state.editRevision, strokes:state.strokes})}); item.strokes = structuredClone(state.strokes); state.dirty = false; await acceptGeometryResult(result); notice('Touch-up saved. Your crop and output size are kept.'); }
  finally { state.busy = false; updateTools(); }
});
$('download').onclick = () => { if (!state.dirty && currentItem()) window.location.href = imageURL(currentItem()) + '&download=true'; };
$('zip').onclick = () => { if (!state.dirty) window.location.href = `/api/jobs/${state.job.id}/download.zip`; };
for (const view of ['result','original']) $(view+'View').onclick = () => { state.view = view; if (view === 'original') setTool(null); renderCanvas(); updateTools(); };
document.querySelectorAll('[data-bg]').forEach(button => button.onclick = () => { document.querySelectorAll('[data-bg]').forEach(b => b.classList.remove('active')); button.classList.add('active'); const bg = button.dataset.bg; $('viewport').classList.toggle('checker', bg === 'checker'); $('viewport').style.backgroundColor = bg === 'checker' ? '' : bg; });
$('backgroundColor').oninput = event => { document.querySelectorAll('[data-bg]').forEach(b => b.classList.remove('active')); $('viewport').classList.remove('checker'); $('viewport').style.backgroundColor = event.target.value; };
initializeEditor();
$('start').onclick = safely(async () => {
  if (state.busy || !state.files.length) return; state.busy = true; renderQueue(); $('start').textContent = 'Preparing your images…'; notice('Preparing the batch locally. Large images may take a moment.');
  try { const form = new FormData(); state.files.forEach(item => form.append('files',item.file,item.file.name)); form.append('quality',$('quality').value); form.append('mode',$('mode').value); const job = await api('/jobs',{method:'POST',body:form}); state.files.forEach(f => URL.revokeObjectURL(f.url)); state.files = []; emptyPreview(); state.job = job; localStorage.setItem('cutout-job',job.id); renderQueue(); notice('AI is running locally. The first image takes longer while the model loads; you can leave this tab open or return later.'); await selectFile(job.items.find(i => i.width)?.id); }
  finally { state.busy = false; $('start').innerHTML = 'Remove backgrounds <span>↗</span>'; renderQueue(); updateTools(); }
});
$('pause').onclick = safely(async () => { await api(`/jobs/${state.job.id}/${state.job.status === 'paused' ? 'resume' : 'pause'}`,{method:'POST'}); await poll(); });
$('stopQueue').onclick = safely(async () => {
  if (!state.job || state.stoppingQueue || $('stopQueue').disabled) return;
  state.stoppingQueue = true; renderQueue();
  try { await api(`/jobs/${state.job.id}/stop`, {method:'POST'}); await poll(); }
  finally { state.stoppingQueue = false; renderQueue(); }
});
$('retry').onclick = safely(async () => { await api(`/jobs/${state.job.id}/retry`,{method:'POST'}); await poll(); });
$('newBatch').onclick = safely(async () => { if (!await canLeave()) return; state.job = null; localStorage.removeItem('cutout-job'); emptyPreview(); renderQueue(); notice('Ready for a new batch. Your earlier results are saved under Previous batches.'); });
let polling = false;
async function poll() {
  if (!state.job || polling || state.busy) return; polling = true;
  try {
    const id = state.job.id, selected = currentItem(), generation = state.editGeneration || 0;
    const previousStatus = selected?.status, previousRevision = selected?.revision || 0;
    const job = await api(`/jobs/${id}`);
    if (state.job?.id !== id || state.busy || generation !== (state.editGeneration || 0)) return;
    // Keep the active edit's settings together until it can be safely refreshed.
    const incoming = job.items.find(item => item.id === state.selected);
    const changed = incoming?.status === 'done' && (previousStatus !== 'done' || incoming.revision !== previousRevision);
    const modal = !!document.querySelector('dialog[open]');
    if (changed && selected && (state.dirty || modal)) {
      job.items[job.items.indexOf(incoming)] = selected;
    }
    state.job = job; renderQueue();
    if (changed && !state.dirty && !modal) {
      notice(previousStatus !== 'done' ? 'Your cutout is ready to inspect. Try the dark background to check the edges.' : 'The saved changes from another window are ready to review.');
      await selectFile(state.selected, true);
    }
  }
  catch (error) { notice(`Connection interrupted: ${error.message} Keep the local server running; your saved work is still on disk.`); }
  finally { polling = false; }
}
setInterval(poll, 1600);
$('historyButton').onclick = safely(async () => { const jobs = await api('/jobs'); $('historyList').innerHTML = jobs.length ? jobs.map(job => `<button data-job="${job.id}">${new Date(job.created*1000).toLocaleString()}<small class="history-details"><span>${job.count} images</span><span>${escapeText(job.status)}</span></small></button>`).join('') : '<p>No batches yet. Your first one will appear here.</p>'; $('historyDialog').showModal(); });
$('closeHistory').onclick = () => $('historyDialog').close();
$('historyList').onclick = safely(async event => { const button = event.target.closest('[data-job]'); if (!button) return; $('historyDialog').close(); if (!await canLeave()) return; const job = await api(`/jobs/${button.dataset.job}`); emptyPreview(); state.job = job; localStorage.setItem('cutout-job',job.id); renderQueue(); notice(); await selectFile(job.items.find(i=>i.status === 'done')?.id || job.items.find(i=>i.width)?.id); });
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
safely(async () => { const config = await api('/config'); state.token = config.token; applyBranding(config); applyModelAvailability(config.models); state.preferences = config.preferences; if (typeof applyPreferences === 'function') applyPreferences(config.preferences); if (!config.models.detail && !config.models.fast) notice('No AI model is installed. Open AI models to download one, or run Setup.cmd when using the source project.'); const requested = new URLSearchParams(location.search).get('job'); const id = requested && /^[a-f0-9]{32}$/.test(requested) ? requested : localStorage.getItem('cutout-job'); if (id) { try { state.job = await api(`/jobs/${id}`); renderQueue(); await selectFile(state.job.items.find(i=>i.status==='done')?.id || state.job.items.find(i=>i.width)?.id); } catch { localStorage.removeItem('cutout-job'); state.job = null; renderQueue(); } } updateTools(); })();
