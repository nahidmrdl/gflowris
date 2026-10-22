import {parsePromptInput,SEPARATOR,promptOptions} from './prompt-input.js';

const $=selector=>document.querySelector(selector);
const node=(tag,className,text)=>{const element=document.createElement(tag);element.className=className||'';if(text!==undefined)element.textContent=text;return element;};
const optionKeys=['model','ratio','count','resolution','removeBackground','cutrisQuality','cutrisMode','autoCrop'];
const labels={model:'Model',ratio:'Ratio',count:'Images',resolution:'Download',removeBackground:'Remove background',cutrisQuality:'AI quality',cutrisMode:'Background',autoCrop:'Auto crop'};
const description=(key,value)=>typeof value==='boolean'?(value?'On':'Off'):key==='cutrisQuality'?(value==='detail'?'Best detail':'Faster'):key==='cutrisMode'?(value==='ai'?'Any background':'White illustration'):String(value);

export function insertSeparator(input){
  const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
  const before=input.value.slice(0,start),after=input.value.slice(end);
  const text=(before&&!before.endsWith('\n')?'\n':'')+SEPARATOR+'\n';
  input.setRangeText(text,start,end,'end');input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));
}

export function createQueueWorkspace({api,getValues,setValues,notice,isActive,saveComposer,onRun,onChange=()=>{}}){
  let items=[],revision=-1,busy=false,editingId=null,currentRun=null,renderToken='';
  const selected=new Set();
  const locked=()=>busy||isActive()||currentRun?.status==='paused';
  const safe=fn=>async(...args)=>{try{await fn(...args);}catch(error){notice(error.message,true);if($('#import-dialog').open)$('#import-error').textContent=error.message;}};
  const button=(text,action,disabled=false)=>{const element=node('button','queue-action',text);element.type='button';element.disabled=disabled;element.onclick=safe(action);return element;};
  function showTab(tab){
    sessionStorage.setItem('workspace-tab',tab);
    for(const element of document.querySelectorAll('[data-workspace-tab]')){const match=element.dataset.workspaceTab===tab;element.classList.toggle('active',match);element.setAttribute('aria-selected',String(match));}
    $('#queue-pane').hidden=tab!=='queue';$('#results-pane').hidden=tab!=='images';
  }
  function composer(){
    $('#composer-title').textContent=editingId?'Edit prompt '+(items.findIndex(item=>item.id===editingId)+1):'New prompt';
    $('#add-prompt').textContent=editingId?'Save prompt':'Add to queue';$('#cancel-prompt-edit').hidden=!editingId;
    $('#input-mode').disabled=!!editingId;
    $('#insert-separator').hidden=$('#input-mode').value==='single';
    $('#prompts').placeholder=$('#input-mode').value==='single'?'Describe the image you want to create…':$('#input-mode').value==='json'?'Paste a JSON object, array, or multiple JSONs…':'Describe the first image…\n---PROMPT---\nDescribe the next image…';
    $('#prompt-help').textContent=$('#input-mode').value==='single'?'Add this prompt as its own queue card.':$('#input-mode').value==='json'?'Paste objects, arrays, or several JSONs. Use Insert separator between blocks.':'One prompt per block. Separate blocks with '+SEPARATOR+'.';
    let canAdd=false;
    try{const parsed=parsePromptInput($('#prompts').value,getValues(),$('#input-mode').value);canAdd=!!editingId||items.length+parsed.length<=25;$('#draft-summary').textContent=canAdd?parsed.length+' prompt'+(parsed.length===1?'':'s'):'Queue limit: 25';$('#draft-summary').title='';}
    catch(error){$('#draft-summary').textContent=$('#prompts').value.trim()?'Check input':'Text or JSON';$('#draft-summary').title=error.message;}
    $('#add-prompt').disabled=locked()||!canAdd;
  }
  function render(){
    const disabled=locked();
    const token=JSON.stringify([items,[...selected],disabled,isActive()?currentRun:null]);if(token===renderToken){composer();return;}renderToken=token;
    $('#queued-count').textContent=items.length+' of 25 prompts';$('#queue-tab-count').textContent=items.length;
    const count=items.reduce((sum,item)=>sum+item.count,0);$('#run-summary').textContent=items.length+' prompts, '+count+' images';
    $('#apply-settings').disabled=disabled||!items.length;$('#import-json').disabled=disabled;
    $('#add-prompt').disabled=disabled;$('#save-defaults').disabled=disabled;$('#cancel-prompt-edit').disabled=disabled;
    const allSelected=items.length>0&&items.every(item=>selected.has(item.id));
    $('#queue-select-all').disabled=disabled||!items.length;$('#queue-select-all').textContent=allSelected?'Deselect all':'Select all';$('#queue-select-all').setAttribute('aria-pressed',String(allSelected));
    $('#remove-prompts').disabled=disabled||!selected.size;$('#clear-queue').disabled=disabled||!items.length;
    $('#prompt-selection-count').hidden=!selected.size;$('#prompt-selection-count').textContent=selected.size+' selected';
    $('#clear-queue').title=currentRun?.status==='paused'?'Cancel the paused queue before clearing prompt cards.':'Remove all prompt cards. Saved images and files are kept.';
    $('#queue-empty').hidden=!!items.length;$('#draft-list').replaceChildren();
    for(const [index,item]of items.entries()){
      const card=node('article','prompt-card'+(selected.has(item.id)?' selected':''));card.dataset.promptId=item.id;card.draggable=!disabled;
      const selection=node('input');selection.type='checkbox';selection.checked=selected.has(item.id);selection.disabled=disabled;selection.setAttribute('aria-label','Select prompt '+(index+1));selection.onchange=()=>{selection.checked?selected.add(item.id):selected.delete(item.id);render();};
      const moves=node('div','prompt-moves');moves.append(button('↑',()=>move(index,index-1),disabled||index===0),button('↓',()=>move(index,index+1),disabled||index===items.length-1));
      moves.children[0].setAttribute('aria-label','Move prompt '+(index+1)+' up');moves.children[1].setAttribute('aria-label','Move prompt '+(index+1)+' down');
      const number=node('span','prompt-number',String(index+1).padStart(2,'0')),copy=node('div','prompt-copy');
      copy.append(node('h3','',item.title||item.prompt.split('\n')[0].slice(0,70)),node('p','prompt-excerpt',item.prompt));
      const badges=node('div','metadata');for(const value of [item.model||'Choose a model',item.ratio,item.count+' image'+(item.count===1?'':'s'),item.resolution,item.removeBackground?'Cutris on':'Background kept'])badges.append(node('span','',value));copy.append(badges);
      const actions=node('div','prompt-card-actions');
      const running=isActive()&&currentRun?.items[index]?.prompt===item.prompt?currentRun.items[index]:null;
      actions.append(node('small','prompt-state',running?.stage||'Ready'),button('Edit',()=>edit(item),disabled),button('Duplicate',()=>commit(next=>{if(next.length===25)throw new Error('The queue already has 25 prompts.');next.splice(index+1,0,{...item,id:crypto.randomUUID()});return next;}),disabled||items.length===25),button('Remove',()=>commit(next=>next.filter(entry=>entry.id!==item.id)),disabled));
      card.append(moves,selection,number,copy,actions);
      card.ondragstart=event=>{if(disabled||event.target.closest('button,input')){event.preventDefault();return;}event.dataTransfer.setData('text/plain',item.id);};
      card.ondragover=event=>{if(!disabled)event.preventDefault();};
      card.ondrop=safe(async event=>{event.preventDefault();const from=items.findIndex(entry=>entry.id===event.dataTransfer.getData('text/plain'));if(from>=0)await move(from,index);});
      $('#draft-list').append(card);
    }
    $('#apply-settings').textContent=selected.size?'Apply settings ('+selected.size+')':'Apply settings';composer();onChange();
  }
  function acceptItems(saved){
    items=saved.items;revision=saved.revision;
    for(const id of selected)if(!items.some(item=>item.id===id))selected.delete(id);
    if(editingId&&!items.some(item=>item.id===editingId)){editingId=null;saveComposer();}
  }
  async function commit(change){
    if(locked())throw new Error(currentRun?.status==='paused'?'Resume or cancel the paused queue before editing prompts.':'Wait for the current operation before editing prompts.');
    const next=change(structuredClone(items));if(next.length>25)throw new Error('A queue can contain up to 25 prompts.');
    busy=true;render();
    try{acceptItems(await api('draft',{revision,items:next}));}
    finally{busy=false;render();}
  }
  async function move(from,to){if(to<0||to>=items.length||from===to)return;await commit(next=>{next.splice(to,0,next.splice(from,1)[0]);return next;});}
  function edit(item){editingId=item.id;$('#prompts').value=item.prompt;$('#input-mode').value='single';setValues(item);composer();saveComposer();$('#prompts').focus();}
  async function add(){
    const entries=parsePromptInput($('#prompts').value,getValues(),editingId?'single':$('#input-mode').value);
    const editId=editingId;
    await commit(next=>editId?next.map(item=>item.id===editId?{...item,...entries[0]}:item):next.concat(entries.map(entry=>({...entry,id:crypto.randomUUID()}))));
    editingId=null;$('#prompts').value='';composer();saveComposer();showTab('queue');notice(editId?'Prompt updated.':'Added '+entries.length+' prompt'+(entries.length===1?'':'s')+' to the queue.');
  }
  function previewImport(){
    $('#import-error').textContent='';$('#confirm-import').disabled=true;$('#import-preview').replaceChildren();
    if(!$('#bulk-source').value.trim()){return [];}
    try{
      const parsed=parsePromptInput($('#bulk-source').value,getValues(),$('#bulk-format').value);
      if(parsed.length+items.length>25)throw new Error('There are '+items.length+' prompts queued. Add up to '+(25-items.length)+' more.');
      for(const [index,item]of parsed.entries()){
        const row=node('div','import-preview-row');row.append(node('strong','',String(index+1).padStart(2,'0')+' '+(item.title||item.prompt.split('\n')[0]).slice(0,100)),node('small','',item.ratio+' / '+item.count+' images / '+item.resolution));$('#import-preview').append(row);
      }
      $('#confirm-import').textContent='Add '+parsed.length+' prompt'+(parsed.length===1?'':'s');$('#confirm-import').disabled=busy||isActive();return parsed;
    }catch(error){$('#import-error').textContent=error.message;return [];}
  }
  $('#add-prompt').onclick=safe(add);$('#insert-separator').onclick=()=>insertSeparator($('#prompts'));
  $('#queue-select-all').onclick=()=>{if(locked())return;if(items.every(item=>selected.has(item.id)))selected.clear();else for(const item of items)selected.add(item.id);render();};
  $('#remove-prompts').onclick=safe(async()=>{const count=selected.size;if(!count)return;const ids=new Set(selected);await commit(next=>next.filter(item=>!ids.has(item.id)));notice('Removed '+count+' prompt'+(count===1?'':'s')+' from the queue.');});
  $('#clear-queue').onclick=safe(async()=>{if(!items.length)return;await commit(()=>[]);notice('Queue cleared. Saved images and files are kept.');});
  $('#prompts').addEventListener('input',()=>{composer();saveComposer();});$('#input-mode').onchange=()=>{composer();saveComposer();};
  $('#cancel-prompt-edit').onclick=()=>{editingId=null;$('#prompts').value='';composer();saveComposer();};
  $('#save-defaults').onclick=safe(async()=>{await api('settings',{defaults:getValues()});notice('Defaults saved. Newly added prompts use these settings.');});
  $('#import-json').onclick=()=>{$('#import-error').textContent='';$('#bulk-source').value='';previewImport();$('#import-dialog').showModal();};
  $('#bulk-source').oninput=previewImport;$('#bulk-format').onchange=previewImport;$('#bulk-insert-separator').onclick=()=>insertSeparator($('#bulk-source'));
  $('#confirm-import').onclick=safe(async()=>{const parsed=previewImport();if(!parsed.length)return;await commit(next=>next.concat(parsed.map(entry=>({...entry,id:crypto.randomUUID()}))));$('#import-dialog').close();showTab('queue');notice('Prompts imported. Each card keeps its own settings.');});
  $('#import-files').onchange=safe(async()=>{const files=[...$('#import-files').files];if(files.reduce((sum,file)=>sum+file.size,0)>150000)throw new Error('Import up to 150 KB of prompt text.');$('#bulk-source').value=(await Promise.all(files.map(file=>file.text()))).join('\n'+SEPARATOR+'\n');$('#bulk-format').value='json';previewImport();$('#import-files').value='';});
  $('#apply-settings').onclick=()=>{
    const current=getValues();$('#apply-fields').replaceChildren();
    for(const key of optionKeys){const label=node('label','apply-field'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=true;checkbox.value=key;label.append(checkbox,node('span','',labels[key]),node('strong','',description(key,current[key])));$('#apply-fields').append(label);}
    $('#apply-scope').replaceChildren();if(selected.size){const option=node('option','','Selected prompts ('+selected.size+')');option.value='selected';$('#apply-scope').append(option);}const all=node('option','','All prompts ('+items.length+')');all.value='all';$('#apply-scope').append(all);$('#apply-dialog').showModal();
  };
  $('#confirm-apply').onclick=safe(async()=>{const keys=[...$('#apply-fields').querySelectorAll('input:checked')].map(input=>input.value);if(!keys.length)throw new Error('Choose at least one setting to apply.');const values=getValues(),patch=Object.fromEntries(keys.map(key=>[key,values[key]])),all=$('#apply-scope').value==='all';await commit(next=>next.map(item=>all||selected.has(item.id)?{...item,...promptOptions({...item,...patch})}:item));$('#apply-dialog').close();notice('Settings applied. Other prompts keep their settings.');});
  for(const tab of document.querySelectorAll('[data-workspace-tab]'))tab.onclick=()=>showTab(tab.dataset.workspaceTab);
  $('#run').onclick=safe(async()=>{if(isActive())return;if(busy)throw new Error('Wait for the queue to finish saving.');await onRun(structuredClone(items));});
  showTab(sessionStorage.getItem('workspace-tab')||'queue');
  return {accept(saved,run){const draftChanged=saved&&saved.revision!==revision;const showImages=run?.status==='running'&&currentRun?.status!=='running'||!currentRun&&run?.items?.some(item=>item.files?.length);currentRun=run;if(showImages)showTab('images');else if(draftChanged&&run?.status==='idle')showTab('queue');if(!busy&&draftChanged){acceptItems(saved);render();}else render();},hydrate(settings){$('#input-mode').value=settings.inputMode||'single';editingId=items.some(item=>item.id===settings.editingId)?settings.editingId:null;composer();},get items(){return items;},get editingId(){return editingId;},get busy(){return busy;},showTab,composer};
}
