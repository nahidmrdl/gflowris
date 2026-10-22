'use strict';

function applyPreferences(preferences) {
  if (!preferences) return;
  state.preferences = preferences;
  if ([...$('quality').options].some(option => option.value === preferences.quality && !option.disabled)) $('quality').value = preferences.quality;
  $('mode').value = preferences.mode;
  $('wheelZoom').checked = preferences.wheel_zoom;
  document.querySelector(`[data-bg="${preferences.preview_background}"]`)?.click();
  $('download').title = preferences.output_folder ? 'Save a PNG to your export folder' : 'Download a PNG with your saved crop settings';
}
let settingsInfo = null;
function settingsTab(name) {
  document.querySelectorAll('[data-settings-tab]').forEach(button => {
    const selected = button.dataset.settingsTab === name;
    button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-settings-panel]').forEach(panel => panel.hidden = panel.dataset.settingsPanel !== name);
}
function showSettingsInfo(info) {
  settingsInfo = info;
  const p = info.preferences;
  $('prefOutputFolder').value = p.output_folder;
  $('prefQuality').value = p.quality; $('prefMode').value = p.mode;
  $('prefAutoCrop').checked = p.auto_crop; $('prefWheelZoom').checked = p.wheel_zoom;
  $('prefBackground').value = p.preview_background; $('prefIntegration').checked = p.integration_enabled;
  $('prefIntegration').disabled = !!info.integration.managed_by;
  if (info.integration.managed_by) $('prefIntegration').checked = true;
  $('integrationState').textContent = info.integration.managed_by ? 'Connected inside gflowris' : info.integration.enabled ? 'Ready on this computer' : 'Off';
  $('integrationState').classList.toggle('online', !!info.integration.enabled);
  $('integrationAddress').textContent = info.integration.origin || 'Enable connections to show the API address.';
  $('copyApiAddress').disabled = !info.integration.enabled; $('copyApiKey').disabled = !info.integration.enabled;
  $('settingsModels').replaceChildren(...['detail', 'fast'].map(name => {
    const badge = document.createElement('span'), label = document.createElement('strong'), status = document.createElement('small');
    label.textContent = name === 'detail' ? 'Maximum detail' : 'Faster';
    status.textContent = info.models[name] ? 'Installed' : 'Not installed';
    badge.append(label, status); return badge;
  }));
  showNativeSettingsActions();
}
function showNativeSettingsActions() {
  $('prefBrowse').hidden = !desktopMethod('choose_output_folder');
  $('prefOpenFolder').hidden = !desktopMethod('open_output_folder');
  $('settingsModelSetup').hidden = !desktopMethod('setup_models');
}
window.addEventListener('pywebviewready', showNativeSettingsActions);
$('appSettingsButton').onclick = safely(async () => {
  $('settingsStatus').textContent = ''; settingsTab('exports');
  showSettingsInfo(await api('/settings')); $('appSettingsDialog').showModal();
});
for (const button of document.querySelectorAll('[data-settings-tab]')) button.onclick = () => settingsTab(button.dataset.settingsTab);
for (const id of ['settingsClose', 'settingsCancel']) $(id).onclick = () => $('appSettingsDialog').close();
$('prefBrowse').onclick = safely(async () => {const result = await desktopAction('choose_output_folder'); if (result.folder) $('prefOutputFolder').value = result.folder;});
$('prefOpenFolder').onclick = safely(async () => {if (settingsInfo.preferences.output_folder) await desktopAction('open_output_folder'); else $('settingsStatus').textContent = 'Save an export folder first.';});
$('prefAskFolder').onclick = () => $('prefOutputFolder').value = '';
$('settingsModelSetup').onclick = () => $('modelsButton').click();
$('copyApiAddress').onclick = safely(async () => {await navigator.clipboard.writeText(settingsInfo.integration.origin); $('settingsStatus').textContent = 'API address copied.';});
$('copyApiKey').onclick = safely(async () => {const result = await api('/integration/key'); await navigator.clipboard.writeText(result.key); $('settingsStatus').textContent = 'API key copied. Keep it private.';});
$('settingsSave').onclick = async () => {
  $('settingsSave').disabled = true; $('settingsStatus').textContent = 'Saving…';
  try {
    const result = await api('/settings', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      output_folder:$('prefOutputFolder').value.trim(), quality:$('prefQuality').value, mode:$('prefMode').value,
      auto_crop:$('prefAutoCrop').checked, wheel_zoom:$('prefWheelZoom').checked,
      preview_background:$('prefBackground').value, integration_enabled:settingsInfo.integration.managed_by ? settingsInfo.preferences.integration_enabled : $('prefIntegration').checked
    })});
    showSettingsInfo(result); applyPreferences(result.preferences); $('settingsStatus').textContent = 'Settings saved.';
  } catch (error) { $('settingsStatus').textContent = error.message; }
  finally { $('settingsSave').disabled = false; }
};

async function exportWithPreferences(itemId) {
  if (state.dirty || !state.job) return;
  if (!state.preferences?.output_folder) {
    window.location.href = itemId ? imageURL(currentItem()) + '&download=true' : `/api/jobs/${state.job.id}/download.zip`;
    return;
  }
  const button = $(itemId ? 'download' : 'zip'); button.disabled = true; state.busy = true;
  try {
    const result = await api(`/exports/${state.job.id}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({item_id:itemId || null})});
    notice(`Saved ${result.name} to your export folder.`);
  } catch (error) { notice(error.message); }
  finally { state.busy = false; updateTools(); renderQueue(); }
}
$('download').onclick = () => exportWithPreferences(currentItem()?.id);
$('zip').onclick = () => exportWithPreferences(null);
if (state.preferences) applyPreferences(state.preferences);
if (new URLSearchParams(location.search).get('settings') === '1') $('appSettingsButton').click();

let checkingEditorRequest = false;
setInterval(async () => {
  if (checkingEditorRequest || !state.token || state.busy || $('confirmDialog').open || $('appSettingsDialog').open) return;
  checkingEditorRequest = true;
  try {
    const request = await api('/integration/next', {method:'POST'});
    if (request.project_id && await canLeave()) {
      const job = await api(`/jobs/${request.project_id}`);
      emptyPreview(); state.job = job; localStorage.setItem('cutout-job', job.id);
      renderQueue(); await selectFile(job.items.find(item => item.status === 'done')?.id);
      notice('Opened from a local integration. Review the edges and save any touch-ups.');
    }
  } catch {} finally { checkingEditorRequest = false; }
}, 1200);
