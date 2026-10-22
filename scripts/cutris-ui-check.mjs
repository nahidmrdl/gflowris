import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const descriptor=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
await fs.mkdir(descriptor.output,{recursive:true});
const browser=await chromium.launch({executablePath:path.join(process.env.PROGRAMFILES,'Google','Chrome','Application','chrome.exe'),headless:true});
const errors=[],checks={};
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});page.on('pageerror',error=>errors.push(error.message));
 await page.goto(descriptor.origin);await page.waitForFunction(()=>!!state.token);
 await page.locator('#appSettingsButton').click();await page.locator('#appSettingsDialog').waitFor();
 for(const viewport of [{width:1280,height:720},{width:1024,height:680}]){
   await page.setViewportSize(viewport);
   for(const selector of ['#settingsSave','#prefAutoCrop','#settingsClose']){const box=await page.locator(selector).boundingBox();assert(box&&box.y>=0&&box.y+box.height<=viewport.height);}
   checks['settings_layout_'+viewport.width]=true;
 }
 await page.setViewportSize({width:1280,height:720});await page.screenshot({path:path.join(descriptor.output,'cutris-exports.png')});
 const output=path.join(descriptor.home,'exports');await page.locator('#prefOutputFolder').fill(output);await page.locator('#settingsSave').click();await page.getByText('Settings saved.',{exact:true}).waitFor();
 await page.locator('[data-settings-tab="defaults"]').click();await page.locator('#prefQuality').selectOption('fast');await page.locator('#prefWheelZoom').uncheck();await page.locator('#settingsSave').click();await page.getByText('Settings saved.',{exact:true}).waitFor();
 await page.locator('[data-settings-tab="integrations"]').click();await page.locator('#prefIntegration').check();await page.locator('#settingsSave').click();await page.getByText('Settings saved.',{exact:true}).waitFor();assert.equal(await page.locator('#integrationState').textContent(),'Ready on this computer');checks.integration_started=true;
 await page.screenshot({path:path.join(descriptor.output,'cutris-integrations.png')});
 const preferences=JSON.parse(await fs.readFile(path.join(descriptor.home,'data','settings.json'),'utf8'));assert.equal(preferences.output_folder,output);assert.equal(preferences.quality,'fast');assert.equal(preferences.wheel_zoom,false);checks.preferences_persist=true;
 const integration=JSON.parse(await fs.readFile(path.join(descriptor.home,'data','integration','service.json'),'utf8'));const key=await fs.readFile(integration.key_file,'utf8');const health=await fetch(integration.origin+'/v1/health',{headers:{Authorization:'Bearer '+key.trim()}});assert(health.ok);checks.real_local_api=true;
 await page.reload();await page.waitForFunction(()=>!!state.token);await page.locator('#appSettingsButton').click();await page.locator('[data-settings-tab="defaults"]').click();assert.equal(await page.locator('#prefQuality').inputValue(),'fast');assert.equal(await page.locator('#prefWheelZoom').isChecked(),false);checks.settings_restored=true;
 await page.locator('[data-settings-tab="integrations"]').click();await page.locator('#prefIntegration').uncheck();await page.locator('#settingsSave').click();await page.getByText('Settings saved.',{exact:true}).waitFor();assert.equal(await page.locator('#integrationState').textContent(),'Off');checks.integration_stopped=true;
 if(descriptor.projectId){
   const embedded=await browser.newPage({viewport:{width:1280,height:720}});
   const icon='data:image/png;base64,'+(await fs.readFile(descriptor.icon)).toString('base64');
   await embedded.addInitScript(({icon})=>{window.pywebview={api:{integration_context:async()=>({workspace:'gflowris',icon}),document_state:async()=>{},choose_output_folder:async()=>({}),setup_models:async()=>({}),open_saved_work:async()=>true}};},{icon});
   await embedded.goto(descriptor.origin+'/?embedded=1&job='+descriptor.projectId);
   await embedded.waitForFunction(()=>typeof state!=='undefined'&&state.original&&state.automatic&&document.body.classList.contains('embedded-workspace'));
   await embedded.waitForTimeout(300);await embedded.screenshot({path:path.join(descriptor.output,'gflowris-cutris-editor.png')});
 }
 assert.deepEqual(errors,[]);checks.no_renderer_errors=true;console.log(JSON.stringify({ok:true,checks}));
}finally{await browser.close();}
