globalThis.FlowPrototypeActivate=element=>new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();element.setAttribute('data-flow-prototype-target',id);
  const cleanup=()=>{clearTimeout(timer);document.removeEventListener('flow-prototype:activated',listener);element.removeAttribute('data-flow-prototype-target');};
  const listener=event=>{try{const result=JSON.parse(event.detail);if(result.id!==id)return;cleanup();result.error?reject(new Error(result.error)):resolve();}catch{}};
  const timer=setTimeout(()=>{cleanup();reject(new Error('The page activation helper is missing. Reload the extension and Flow tab. No click was retried.'));},2500);
  document.addEventListener('flow-prototype:activated',listener);
  document.dispatchEvent(new CustomEvent('flow-prototype:activate',{detail:JSON.stringify({id})}));
});
