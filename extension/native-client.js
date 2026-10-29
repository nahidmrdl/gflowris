const HOST='com.automationflowgen.bridge';
let port=null,nextAttempt=0,lastError='Desktop connection unavailable. Open gflowris, then reopen the extension popup.';
const pending=new Map();
function connect(){
  if(port)return port;
  if(Date.now()<nextAttempt)throw new Error(lastError);
  const current=chrome.runtime.connectNative(HOST);port=current;
  current.onMessage.addListener(message=>{
    const entry=pending.get(message.id);if(!entry)return;clearTimeout(entry.timer);pending.delete(message.id);
    message.ok?entry.resolve(message.result):entry.reject(new Error(message.error||'Native operation failed.'));
  });
  current.onDisconnect.addListener(()=>{
    const reason=chrome.runtime.lastError?.message||'Desktop connection closed.';
    lastError=reason;
    if(port===current){port=null;nextAttempt=Date.now()+3000;}
    for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error(reason));}pending.clear();
  });
  return current;
}
export function nativeRequest(action,endpoint,data){
  return new Promise((resolve,reject)=>{
    let connection;try{connection=connect();}catch(error){reject(error);return;}
    const id=crypto.randomUUID();
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('The desktop app did not respond. No action was retried.'));},20000);
    pending.set(id,{resolve,reject,timer});
    try{connection.postMessage({id,action,endpoint,data});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
  });
}
