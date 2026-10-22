// Run DOM activation in the page's JavaScript world. No extension credentials or APIs are exposed here.
(()=>{
  if(globalThis.__flowPrototypePageActions)return;globalThis.__flowPrototypePageActions=true;
  document.addEventListener('flow-prototype:activate',async event=>{
    let request;
    try{
      request=JSON.parse(event.detail);if(!/^[0-9a-f-]{36}$/.test(request.id))return;
      const element=document.querySelector(`[data-flow-prototype-target="${request.id}"]`);
      if(!element?.isConnected)throw new Error('The control changed before activation.');
      if(element.disabled||element.getAttribute('aria-disabled')==='true')throw new Error('The control is disabled.');
      element.scrollIntoView({block:'nearest',inline:'nearest'});element.focus({preventScroll:true});
      const deadline=Date.now()+1800;let x,y,previous=null,ready=false;
      while(Date.now()<deadline){
        const rect=element.getBoundingClientRect();x=rect.left+rect.width/2;y=rect.top+rect.height/2;
        const hit=document.elementFromPoint(x,y),uncovered=hit&&(hit===element||element.contains(hit));
        if(uncovered&&previous&&Math.abs(previous.x-x)<1&&Math.abs(previous.y-y)<1){ready=true;break;}
        previous=uncovered?{x,y}:null;await new Promise(resolve=>setTimeout(resolve,70));
      }
      if(!ready)throw new Error('Another panel covers '+(element.getAttribute('aria-label')||element.textContent.trim().slice(0,60))+'. Close it before continuing.');
      const init={bubbles:true,cancelable:true,composed:true,view:window,clientX:x,clientY:y,button:0};
      element.dispatchEvent(new PointerEvent('pointerdown',{...init,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:1}));
      element.dispatchEvent(new MouseEvent('mousedown',{...init,buttons:1}));
      element.dispatchEvent(new PointerEvent('pointerup',{...init,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:0}));
      element.dispatchEvent(new MouseEvent('mouseup',{...init,buttons:0}));
      HTMLElement.prototype.click.call(element);
      document.dispatchEvent(new CustomEvent('flow-prototype:activated',{detail:JSON.stringify({id:request.id,ok:true})}));
    }catch(error){if(request?.id)document.dispatchEvent(new CustomEvent('flow-prototype:activated',{detail:JSON.stringify({id:request.id,error:error.message})}));}
  });
})();
