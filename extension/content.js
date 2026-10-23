(()=>{
  if(globalThis.__flowPrototypeBridge)return;globalThis.__flowPrototypeBridge=true;
  let refs=new Map(),seq=0,results=[],busy=false,lastSnapshot=0;
  const ids=new WeakMap();
  const redact=value=>String(value||'').replace(/Google Account:[\s\S]*/i,'Google Account [details hidden]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email hidden]');
  const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  const text=el=>redact(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,350);
  function id(el){if(!ids.has(el))ids.set(el,'e'+(++seq));const key=ids.get(el);refs.set(key,el);return key;}
  function info(el){
    const attrs={};for(const a of ['role','aria-label','title','placeholder','type','data-testid','aria-expanded','aria-selected','aria-checked','aria-pressed','data-state','contenteditable','aria-disabled'])if(el.hasAttribute(a))attrs[a]=redact(el.getAttribute(a));
    return {id:id(el),tag:el.tagName.toLowerCase(),text:text(el),attrs,disabled:!!el.disabled||el.getAttribute('aria-disabled')==='true',value:el.matches('select')?el.value:undefined};
  }
  function snapshot(){
    const controls=[...document.querySelectorAll('button,[role="button"],input:not([type="password"]),textarea,select,[role="combobox"],[role="option"],[role="menuitem"],[role="tab"],[contenteditable="true"]')].filter(visible).slice(0,250).map(info);
    const images=[...document.querySelectorAll('img')].filter(visible).filter(el=>el.width>=120||el.height>=120).slice(0,40).map(el=>({id:id(el),alt:redact(el.alt),width:el.naturalWidth,height:el.naturalHeight,loaded:el.complete&&el.naturalWidth>0,parentText:text(el.parentElement)}));
    const dialogs=[...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[role="alert"],[role="status"],[role="progressbar"]')].filter(visible).map(el=>({id:id(el),role:el.getAttribute('role'),text:text(el)}));
    const tiles=[...document.querySelectorAll('flow-tile-container')].map(el=>({id:id(el),text:text(el),mediaIds:[...el.querySelectorAll('img[data-media-id]')].map(img=>img.getAttribute('data-media-id'))}));
    return {time:Date.now(),version:chrome.runtime.getManifest().version,page:location.origin+location.pathname,controls,images,dialogs,tiles};
  }
  function get(key){const el=refs.get(key);if(!el?.isConnected||!visible(el))throw new Error('Control changed. Inspect Flow again.');return el;}
  let activeExecution=null,checkingCancellation=false,trackedQueue=null;
  async function assertActive(){
    const execution=activeExecution;if(!execution)return;
    execution.controller.signal.throwIfAborted();
    const result=await chrome.runtime.sendMessage({type:'command-state',id:execution.id});
    if(activeExecution!==execution)return;
    if(!result?.ok)throw new Error(result?.error||'The queue state is unavailable.');
    if(!result.active){execution.controller.abort(new DOMException('Queue cancelled.','AbortError'));adapter.cancel();execution.controller.signal.throwIfAborted();}
  }
  async function checkCancellation(){if(!activeExecution||checkingCancellation)return;checkingCancellation=true;try{await assertActive();}catch{}finally{checkingCancellation=false;}}
  async function executeActive(cmd){
    const p=cmd.payload||{};
    if(cmd.type==='generate'){
      const ready=await chrome.runtime.sendMessage({type:'generation-ready',page:location.href,commandId:cmd.id});
      if(!ready?.ok||!ready.ready||ready.protocol!==1)throw new Error(ready?.error&&ready.error!=='Unknown message.'?ready.error:'Reload gflowris bridge in chrome://extensions, then reload Flow and reconnect. Generate support is not ready; no prompt was entered or click attempted.');
    }
    if(['discover','generate','generation','download','returnToProject'].includes(cmd.type))return adapter[cmd.type](p);
    if(cmd.type==='inspect')return snapshot();
    if(cmd.type==='describe'){
      let el=get(p.id),parents=[];
      for(let i=0;i<5&&el&&el!==document.body;i++,el=el.parentElement)parents.push({tag:el.tagName,attrs:[...el.attributes].filter(a=>!['src','href','style'].includes(a.name)).map(a=>[a.name,redact(a.value)]),text:text(el),html:redact(el.outerHTML.replace(/(?:src|href)="[^"]*"/g,'').slice(0,18000))});
      return {parents};
    }
    if(cmd.type==='escape'){document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,250));return snapshot();}
    const el=get(p.id);
    if(cmd.type==='click'){if(el.disabled||el.getAttribute('aria-disabled')==='true')throw new Error('Control is disabled.');await FlowPrototypeActivate(el);}
    else if(cmd.type==='hover'){for(const type of ['pointerover','pointerenter','mouseover','mouseenter'])el.dispatchEvent(new MouseEvent(type,{bubbles:true,view:window}));}
    else if(cmd.type==='fill'){
      el.focus();const value=String(p.value||'');
      if(el.matches('textarea,input')){const proto=el.matches('textarea')?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
      else if(el.isContentEditable){const selection=getSelection(),range=document.createRange();range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);document.execCommand('insertText',false,value);}
      else throw new Error('This is not a prompt field.');
    }else throw new Error('Unsupported command.');
    await new Promise(r=>setTimeout(r,450));return snapshot();
  }
  async function execute(cmd){activeExecution={id:cmd.id,controller:new AbortController()};try{return await executeActive(cmd);}finally{activeExecution=null;}}
  const adapter=createFlowPrototypeAdapter({activate:FlowPrototypeActivate,visible,getSignal:()=>activeExecution?.controller.signal,assertActive,startGeneration:async()=>{
    const response=await chrome.runtime.sendMessage({type:'click-generate',page:location.href,commandId:activeExecution?.id});
    if(!response?.ok)throw new Error(response?.error||'Chrome could not activate Generate.');
  }});
  async function tick(){
    if(busy)return;busy=true;
    try{
      const include=Date.now()-lastSnapshot>3500;const outgoing=results;
      const response=await chrome.runtime.sendMessage({type:'poll',snapshot:include?snapshot():undefined,results:outgoing});
      if(response?.ok)results=results.filter(item=>!outgoing.includes(item));
      if(response?.ok&&response.queue){
        if(response.queue.id!==trackedQueue||response.queue.status!=='running')adapter.cancel();
        trackedQueue=response.queue.id;
      }
      if(include)lastSnapshot=Date.now();
      if(response?.command){const cmd=response.command;try{results.push({id:cmd.id,result:await execute(cmd)});}catch(e){results.push({id:cmd.id,error:e.message});}}
    }catch{}finally{busy=false;}
  }
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(sender.id===chrome.runtime.id&&message?.type==='native-tick'){checkCancellation();tick();sendResponse({ok:true});}
  });
  tick();
})();
