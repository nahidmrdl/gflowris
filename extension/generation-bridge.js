import {clickGenerate,isFlowProject} from './browser-input.js';

// MessageSender.url can describe the document's initial SPA route. Authorize
// its origin, then validate the tab's live URL before either readiness or input.
export async function handleGenerationMessage(chromeApi,message,sender,assertActive=async()=>{}){
  if(sender.id!==chromeApi.runtime.id||!sender.tab||sender.frameId!==0)throw new Error('Generate must come from the connected Flow project’s main page.');
  if(!isFlowProject(message.page))throw new Error('Open the Flow project grid before generating.');
  let source;
  try{source=new URL(sender.url);}catch{throw new Error('The Flow page identity is unavailable. Reload Flow and reconnect.');}
  if(source.origin!==new URL(message.page).origin)throw new Error('The Generate request came from a different website.');
  const {native,tabId}=await chromeApi.storage.local.get(['native','tabId']);
  if(!native||tabId!==sender.tab.id)throw new Error('Connect this Flow project from the extension first.');
  const tab=await chromeApi.tabs.get(tabId);
  if(tab.url!==message.page||!isFlowProject(tab.url))throw new Error('The Flow project changed. Open its grid and reconnect.');
  await assertActive();
  if(message.type==='generation-ready')return {ready:true,protocol:1,version:chromeApi.runtime.getManifest().version};
  if(message.type!=='click-generate')throw new Error('Unsupported Generate operation.');
  return clickGenerate(chromeApi,tabId,message.page,assertActive);
}
