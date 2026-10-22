export function isFlowProject(url){
  try{const page=new URL(url);return page.protocol==='https:'&&(page.hostname==='flow.google.com'||page.hostname==='labs.google')&&/^\/(?:fx\/tools\/flow\/)?project\/[^/]+\/?$/.test(page.pathname);}catch{return false;}
}

// This module exposes one fixed operation. It does not accept arbitrary CDP commands or JavaScript.
export async function clickGenerate(chromeApi,tabId,expectedPage,assertActive=async()=>{}){
  const before=await chromeApi.tabs.get(tabId);
  if(!isFlowProject(before.url)||before.url!==expectedPage)throw new Error('Open the paired Flow project grid before generating.');
  const target={tabId};let attached=false;
  try{
    await chromeApi.debugger.attach(target,'1.3');attached=true;
    const current=await chromeApi.tabs.get(tabId);
    if(current.url!==expectedPage||!isFlowProject(current.url))throw new Error('The Flow tab navigated before the click.');
    const expression=`(${function(){
      const buttons=[...document.querySelectorAll('button[aria-label="Start generation"]')].filter(el=>el.getClientRects().length>0);
      if(buttons.length!==1)return {error:'The Generate button could not be identified uniquely.'};
      const button=buttons[0],prompt=document.querySelector('[contenteditable="true"][aria-label="What do you want to create?"]');
      if(!prompt?.textContent.trim()||button.disabled||button.getAttribute('aria-disabled')==='true')return {error:'Flow is not ready to generate this prompt.'};
      button.scrollIntoView({block:'nearest',inline:'nearest'});
      const box=button.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2,hit=document.elementFromPoint(x,y);
      if(!hit||!(hit===button||button.contains(hit)))return {error:'A panel covers the Generate button. Close it before continuing.'};
      return {x,y};
    }.toString()})()`;
    const result=await chromeApi.debugger.sendCommand(target,'Runtime.evaluate',{expression,returnByValue:true});
    if(result.exceptionDetails)throw new Error('Could not inspect the Generate button.');
    const point=result.result?.value;if(point?.error)throw new Error(point.error);
    if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))throw new Error('Generate button position is unavailable.');
    await chromeApi.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y,button:'none',buttons:0,pointerType:'mouse'});
    await assertActive();
    await chromeApi.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1,pointerType:'mouse'});
    await chromeApi.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',buttons:0,clickCount:1,pointerType:'mouse'});
    return {clicked:true};
  }finally{if(attached)await chromeApi.debugger.detach(target).catch(()=>{});}
}
