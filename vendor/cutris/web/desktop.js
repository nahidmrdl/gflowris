'use strict';

function applyBranding(info = {}) {
  const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim() : $('appName').textContent;
  const embedded = document.body.classList.contains('embedded-workspace');
  document.title = embedded ? 'gflowris Cutris editor' : `${name} Background Remover`;
  $('appName').textContent = embedded ? 'gflowris' : name;
  $('aboutAppName').textContent = name;
  $('footerAppName').textContent = name;
  $('appBrandLink').setAttribute('aria-label', `${name} home`);
  if (info.version != null) $('appVersion').textContent = String(info.version);
}

function applyModelAvailability(models) {
  state.models = models;
  for (const option of $('quality').options) option.disabled = !models[option.value];
  if (!models[$('quality').value]) {
    const available = [...$('quality').options].find(option => !option.disabled);
    if (available) $('quality').value = available.value;
  }
  renderQueue();
}

function desktopMethod(name) {
  const bridge = window.pywebview?.api;
  return typeof bridge?.[name] === 'function' ? bridge[name].bind(bridge) : null;
}

async function desktopAction(name, ...args) {
  const method = desktopMethod(name);
  if (!method) throw new Error('The desktop connection is still starting. Try again in a moment.');
  return method(...args);
}

function syncDesktopState() {
  if (window.leavingWorkspace) return;
  const report = desktopMethod('document_state');
  // pywebview creates api={} before it injects the callable methods.
  if (!report) return;
  const processing = ['queued', 'running', 'pausing', 'stopping'].includes(state.job?.status);
  try { Promise.resolve(report(state.dirty, processing)).catch(() => {}); } catch {}
}

function connectDesktop() {
  if (!desktopMethod('document_state')) return;
  $('modelsButton').hidden = !desktopMethod('setup_models');
  $('savedWorkButton').hidden = !desktopMethod('open_saved_work');
  syncDesktopState();
  const contextMethod = desktopMethod('integration_context');
  if (!contextMethod) return;
  Promise.resolve().then(() => contextMethod()).then(context => {
    if (!context?.workspace) return;
    document.body.classList.add('embedded-workspace');
    $('backToWorkspace').hidden = false; $('returnToWorkspace').hidden = false;
    $('appName').textContent = context.workspace; $('appSubtitle').textContent = 'CUTRIS EDITOR';
    if (context.icon) document.querySelector('.brand-icon').src = context.icon;
    document.title = 'gflowris Cutris editor';
    $('returnToWorkspace').title = 'Save your edits and update the image in gflowris';
  }).catch(() => {});
}
window.addEventListener('pywebviewready', connectDesktop);
if (desktopMethod('document_state')) connectDesktop();

$('modelsButton').onclick = safely(async () => {
  if ($('modelsDialog').open) return;
  const info = await api('/settings');
  applyModelAvailability(info.models);
  const ready = Object.values(info.models).filter(Boolean).length;
  $('modelsSummary').textContent = ready === 2 ? 'Both AI models are installed and ready to use.' : ready ? 'One AI model is installed. You can add the other whenever you need it.' : 'Choose an AI model to download before removing backgrounds.';
  $('modelAvailability').replaceChildren(...['detail','fast'].map(quality => {
    const row = document.createElement('div'), name = document.createElement('strong'), status = document.createElement('span');
    name.textContent = quality === 'detail' ? 'Maximum detail' : 'Faster';
    status.textContent = info.models[quality] ? 'Installed' : 'Not installed';
    status.className = info.models[quality] ? 'model-installed' : 'model-missing';
    row.append(name, status); return row;
  }));
  $('modelsManage').textContent = ready === 2 ? 'Verify or repair models' : 'Download models';
  if (!$('modelsDialog').open) $('modelsDialog').showModal();
});
for (const id of ['modelsClose','modelsDone']) $(id).onclick = () => $('modelsDialog').close();
$('modelsManage').onclick = safely(async () => {
  $('modelsDialog').close();
  $('modelsButton').disabled = true;
  notice('AI model setup is open in a separate window.');
  try {
    const result = await desktopAction('setup_models');
    if (result.models) applyModelAvailability(result.models);
    notice(result.message || (result.ok ? 'AI models are ready. Processing stays offline.' : 'Model setup was cancelled. Previously installed models are still available.'));
  } finally { $('modelsButton').disabled = false; }
});
$('savedWorkButton').onclick = safely(async () => { await desktopAction('open_saved_work'); });
$('aboutButton').onclick = safely(async () => {
  const info = await api('/about');
  applyBranding(info);
  $('licenseNotices').textContent = info.notices;
  $('aboutDialog').showModal();
});
$('closeAbout').onclick = () => $('aboutDialog').close();
$('returnToWorkspace').onclick = safely(async () => {
  if (state.busy) return;
  if (state.dirty) await $('save').onclick();
  if (state.dirty || state.busy) return;
  await desktopAction('document_state', state.dirty, false);
  const result = await desktopAction('return_to_workspace', state.job?.id || null);
  if (!result.ok) throw new Error(result.error || 'The workspace could not update. Your saved edits remain in Cutris.');
  if (result.url) { window.leavingWorkspace = true; window.location.assign(result.url); }
});
$('backToWorkspace').onclick = () => $('returnToWorkspace').click();
setInterval(syncDesktopState, 1000);
$('quality').addEventListener('change', renderQueue);
