globalThis.createFlowPrototypeAdapter=({activate,visible,startGeneration,startTimeout=12000,getSignal=()=>null,assertActive=async()=>{}})=>{
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const content=element=>(element.innerText||element.textContent||'').trim().replace(/\s+/g,' ');
  const list=selector=>[...document.querySelectorAll(selector)].filter(visible);
  const unique=(elements,label)=>{if(elements.length!==1)throw new Error(`Expected one ${label}; found ${elements.length}. Check Flow before continuing.`);return elements[0];};
  const label=value=>unique(list('[aria-label]').filter(el=>el.getAttribute('aria-label')===value),value);
  const radio=value=>unique(list('button[role="radio"]').filter(el=>content(el)===value||content(el).endsWith(' '+value)),value+' choice');
  const menus=()=>list('[role="menuitem"]');
  const menu=value=>unique(menus().filter(el=>content(el)===value||content(el).replace(/^🍌\s*/,'')===value),value+' menu item');
  const tiles=()=>[...document.querySelectorAll('flow-tile-container')];
  const media=()=>[...document.querySelectorAll('flow-image-tile img[data-media-id]')];
  const mediaIds=()=>media().map(el=>el.getAttribute('data-media-id'));
  const promptText=value=>String(value||'').replace(/\s+/g,' ').trim();
  let sequence=0;const tileIds=new WeakMap(),tickets=new Map();
  const tileId=el=>{if(!tileIds.has(el))tileIds.set(el,'tile-'+(++sequence));return tileIds.get(el);};
  async function waitFor(read,description,timeout=5000){const deadline=Date.now()+timeout;while(Date.now()<deadline){getSignal()?.throwIfAborted();const value=read();if(value)return value;await sleep(120);}throw new Error(description);}
  async function press(element){getSignal()?.throwIfAborted();await assertActive();getSignal()?.throwIfAborted();await activate(element);await sleep(180);}
  function project(){if(!/^\/(?:fx\/tools\/flow\/)?project\/[^/]+\/?$/.test(location.pathname))throw new Error('Open the project grid before running a queue.');}
  async function openSettings(){
    if(!list('button[role="radio"]').some(el=>/\bImage$/.test(content(el)))){await press(label('Settings trigger'));}
    await waitFor(()=>list('button[role="radio"]').some(el=>/\bImage$/.test(content(el))),'Flow image settings did not open.');
    const image=radio('Image');if(image.getAttribute('aria-checked')!=='true')await press(image);
  }
  async function closeSettings(){if(list('button[role="radio"]').some(el=>/\bImage$/.test(content(el))))await press(label('Settings trigger'));}
  async function dismissMenus(){
    if(!menus().length)return;
    const target=document.activeElement||document.body;
    target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));
    await waitFor(()=>!menus().length,'Flow did not close its menu. Press Escape in Flow, then refresh settings.');
  }
  async function discover(){
    await dismissMenus();if(location.pathname.includes('/edit/'))await returnToProject();project();await openSettings();
    const ratios=list('button[role="radio"]').map(content).map(value=>value.match(/(?:^|\s)(\d+:\d+)$/)?.[1]).filter(Boolean);
    const counts=list('button[role="radio"]').map(content).filter(value=>/^x[1-4]$/.test(value)).map(value=>Number(value.slice(1)));
    const chosenRatio=list('button[role="radio"]').find(el=>el.getAttribute('aria-checked')==='true'&&/\d+:\d+$/.test(content(el)));
    const chosenCount=list('button[role="radio"]').find(el=>el.getAttribute('aria-checked')==='true'&&/^x[1-4]$/.test(content(el)));
    const modelButton=label('Select model family'),selected=content(modelButton).replace(/^🍌\s*/,'').replace(/\s*arrow_drop_down$/,'');
    await press(modelButton);await waitFor(()=>menus().length,'Model menu did not open.');
    const models=menus().filter(el=>!el.disabled&&el.getAttribute('aria-disabled')!=='true').map(el=>content(el).replace(/^🍌\s*/,''));
    await press(menu(selected));await closeSettings();
    let resolutionOptions=[{value:'1K',label:'1K (Original)',enabled:true},{value:'2K',label:'2K (Upscaled)',enabled:true},{value:'4K',label:'4K (Upgrade required)',enabled:false}];
    const first=media().find(el=>el.complete&&el.naturalWidth);
    if(first){
      await press(first);await waitFor(()=>list('[aria-label="Download media"]').length,'The image did not open for checking download options.');
      await press(label('Download media'));await waitFor(()=>menus().some(el=>/Original size|Upscaled/.test(content(el))),'Download menu did not open.');
      resolutionOptions=menus().filter(el=>/^(1K Original size|[24]K Upscaled)$/.test(content(el))).map(el=>{const value=content(el).slice(0,2),enabled=!el.disabled&&el.getAttribute('aria-disabled')!=='true';return {value,label:value+' ('+(value==='1K'?'Original':enabled?'Upscaled':'Upgrade required')+')',enabled};});
      await dismissMenus();await returnToProject();
    }
    const resolutions=resolutionOptions.filter(option=>option.enabled).map(option=>option.value);
    return {models,ratios,counts,resolutions,resolutionOptions,defaults:{model:selected,ratio:chosenRatio?content(chosenRatio).match(/\d+:\d+$/)[0]:'1:1',count:chosenCount?Number(content(chosenCount).slice(1)):1,resolution:resolutions.includes('2K')?'2K':'1K'}};
  }
  async function generate({item}){
    const signal=getSignal();
    signal?.throwIfAborted();
    project();
    if([...tickets.values()].some(ticket=>!ticket.finished))throw new Error('A generation is already being tracked.');
    if(list('[role="progressbar"]').length)throw new Error('Flow already has a generation in progress. Wait for it to finish.');
    await openSettings();
    await press(label('Select model family'));await waitFor(()=>menus().length,'Model menu did not open.');await press(menu(item.model));
    for(const [value,expected] of [[item.ratio,item.ratio],['x'+item.count,'x'+item.count]]){
      const option=radio(value);if(option.getAttribute('aria-checked')!=='true')await press(option);
      if(radio(value).getAttribute('aria-checked')!=='true')throw new Error('Flow did not apply '+expected+'.');
    }
    await closeSettings();
    signal?.throwIfAborted();await assertActive();signal?.throwIfAborted();
    const editor=label('What do you want to create?');
    if(editor.textContent.trim())throw new Error('Flow already has a prompt in its composer. Clear it or save it before running the queue.');
    editor.focus();const selection=getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
    if(!document.execCommand('insertText',false,item.prompt))throw new Error('Could not enter the prompt.');
    await waitFor(()=>promptText(editor.innerText??editor.textContent)===promptText(item.prompt)&&!label('Start generation').disabled,'Flow did not accept the prompt.');
    signal?.throwIfAborted();
    const ticket={id:crypto.randomUUID(),page:location.origin+location.pathname,before:mediaIds(),beforeTiles:tiles().map(tileId),submitted:Date.now(),prompt:item.prompt,finished:false};
    tickets.set(ticket.id,ticket);
    // Exactly one activation. A missing start signal stops the queue instead of clicking again.
    if(!startGeneration)throw new Error('Browser input is unavailable. Reload the updated extension.');
    await startGeneration();
    await waitFor(()=>{
      const newTiles=tiles().filter(el=>!ticket.beforeTiles.includes(tileId(el)));
      return newTiles.length||mediaIds().some(id=>!ticket.before.includes(id));
    },'Flow did not confirm a new generation. Click Generate manually if the prompt is still present; the queue has stopped without retrying.',startTimeout);
    return {id:ticket.id,page:ticket.page};
  }
  async function generation({ticket,count}){
    project();const saved=tickets.get(ticket.id);if(!saved||saved.page!==location.origin+location.pathname)throw new Error('Generation tracking was interrupted. Review Flow before starting another queue.');
    const fresh=media().filter(el=>!saved.before.includes(el.getAttribute('data-media-id')));
    const newTiles=tiles().filter(el=>!saved.beforeTiles.includes(tileId(el)));
    const error=newTiles.map(content).find(value=>/generation failed|couldn.t generate|something went wrong|try again|unable to generate/i.test(value));
    if(error)return {error:error.slice(0,300)};
    if(fresh.length>count)throw new Error('Unexpected additional images appeared. Stop interacting with Flow while the queue runs.');
    if(fresh.length!==count||fresh.some(el=>!el.complete||!el.naturalWidth))return {complete:false};
    saved.finished=true;return {complete:true,assets:fresh.map(el=>({mediaId:el.getAttribute('data-media-id'),page:saved.page,width:el.naturalWidth,height:el.naturalHeight}))};
  }
  async function download({asset,item,marker}){
    project();if(asset.page!==location.origin+location.pathname)throw new Error('The Flow project changed.');
    const image=unique(media().filter(el=>el.getAttribute('data-media-id')===asset.mediaId),'generated image');
    let sourceOrigin;try{sourceOrigin=new URL(image.currentSrc||image.src).origin;}catch{}
    await press(image);await waitFor(()=>list('[aria-label="Download media"]').length,'The generated image did not open.');
    await press(label('Download media'));await waitFor(()=>menus().some(el=>/Original size|Upscaled/.test(content(el))),'Download options did not open.');
    const option=menu(item.resolution==='1K'?'1K Original size':item.resolution+' Upscaled');
    if(option.disabled||option.getAttribute('aria-disabled')==='true')throw new Error(item.resolution+' is not available for this account and model.');
    const title=label('Editable text').value?.trim();
    const response=await chrome.runtime.sendMessage({type:'arm-download',marker,page:location.href,title,resolution:item.resolution,sourceOrigin});if(!response?.ok)throw new Error(response?.error||'Could not associate the download with this job.');
    await press(option);
    return {started:true,editPage:location.origin+location.pathname};
  }
  async function returnToProject(){
    if(location.pathname.includes('/edit/'))await press(label('Back button to go to previous page'));
    await waitFor(()=>!location.pathname.includes('/edit/'),'Could not return to the project grid.');
    return {ok:true};
  }
  return {discover,generate,generation,download,returnToProject,cancel(){for(const ticket of tickets.values())ticket.finished=true;}};
};
