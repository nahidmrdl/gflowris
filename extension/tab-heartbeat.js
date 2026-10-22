// The extension worker drives the heartbeat so hidden-page timer throttling
// cannot disconnect the desktop while the user works outside Chrome.
export async function pulseFlowTab(chromeApi){
  const {tabId}=await chromeApi.storage.local.get('tabId');
  if(!Number.isInteger(tabId))return;
  const tab=await chromeApi.tabs.get(tabId);
  const page=new URL(tab.url);
  if(page.protocol!=='https:'||!(page.hostname==='flow.google.com'||page.hostname==='labs.google'&&page.pathname.startsWith('/fx/')))return;
  await chromeApi.tabs.sendMessage(tabId,{type:'native-tick'});
}
