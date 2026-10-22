const $=selector=>document.querySelector(selector);
let available=false;
function note(text,error=false){$('#status').hidden=false;$('#status').textContent=text;$('#status').classList.toggle('error',error);}
function connectionError(error){
  const detail=error.message||String(error);available=false;$('#desktop-state').textContent='Setup needed';$('#project-state').textContent='Not connected';$('#status-dot').classList.remove('online');$('#diagnostics').hidden=false;$('#error-detail').textContent=detail;
  if(/host not found/i.test(detail))note('Run Setup-native.cmd from the app folder once, then reopen this popup.',true);
  else if(/forbidden|not registered/i.test(detail))note('Run desktop setup again with this extension’s ID to restore the connection.',true);
  else note(detail,true);
}
async function status(){
  try{
    const result=await chrome.runtime.sendMessage({type:'status'});if(!result.ok)throw new Error(result.error);
    available=true;$('#diagnostics').hidden=true;$('#status-dot').classList.toggle('online',!!result.flowConnected);$('#desktop-state').textContent=result.desktopOpen?'Open':'Ready';$('#desktop-state').classList.add('ready');
    const connected=result.selected&&result.flowConnected;
    $('#project-state').textContent=connected?'Connected':result.activeFlow?'Ready to connect':'Open a Flow project';$('#project-state').classList.toggle('ready',connected);
    $('#connect').disabled=!result.activeFlow;$('#connect').textContent=connected?'Reconnect project':'Connect this project';
    $('#connect').className=connected?'secondary':'primary';$('#open-desktop').className=connected?'primary':'secondary';$('#open-flow').hidden=!!result.activeFlow;
    $('#instructions').textContent=connected?'Your project is linked. Work in the desktop app and keep this Flow tab open.':'Connect the project in this tab. The desktop app handles your prompts, downloads, and cutouts.';
    $('#queue-row').hidden=!result.queueStatus||result.queueStatus==='idle';$('#queue-state').textContent=({running:'Running',paused:'Paused',complete:'Saved',cancelled:'Cancelled',attention:'Needs attention'})[result.queueStatus]||result.queueStatus||'';
  }catch(error){connectionError(error);$('#connect').disabled=false;}
}
$('#connect').onclick=async()=>{
  $('#connect').disabled=true;note('Connecting your project…');
  try{const result=await chrome.runtime.sendMessage({type:'pair'});if(!result.ok)throw new Error(result.error);note('Project connected. You can return to the desktop app.');await status();}
  catch(error){connectionError(error);}finally{$('#connect').disabled=false;}
};
$('#open-desktop').onclick=async()=>{
  $('#open-desktop').disabled=true;
  try{const result=await chrome.runtime.sendMessage({type:'desktop-open'});if(!result.ok)throw new Error(result.error);note('Opening your desktop workspace…');}
  catch(error){connectionError(error);}finally{$('#open-desktop').disabled=false;}
};
$('#open-flow').onclick=()=>chrome.tabs.create({url:'https://flow.google.com/'});
$('#copy-extension').onclick=async()=>{await navigator.clipboard.writeText(chrome.runtime.id);note('Extension ID copied.');};
status();
