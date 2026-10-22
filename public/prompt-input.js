export const MAX_PROMPTS=25;
export const SEPARATOR='---PROMPT---';
export const OPTION_DEFAULTS={model:'',ratio:'1:1',count:1,resolution:'2K',removeBackground:false,cutrisQuality:'detail',cutrisMode:'ai',autoCrop:true};

export function promptOptions(entry={},defaults={}){
  const values={...OPTION_DEFAULTS,...defaults,...entry.settings,...Object.fromEntries(Object.keys(OPTION_DEFAULTS).filter(key=>key in entry).map(key=>[key,entry[key]]))};
  if(entry.aspectRatio!==undefined&&entry.ratio===undefined&&entry.settings?.ratio===undefined)values.ratio=entry.aspectRatio;
  for(const key of ['model','ratio','resolution'])if(typeof values[key]!=='string'||values[key].length>100)throw new Error('Invalid '+key+' setting.');
  values.count=Number(values.count);
  if(!Number.isInteger(values.count)||values.count<1||values.count>4)throw new Error('Image count must be between 1 and 4.');
  if(typeof values.removeBackground!=='boolean')throw new Error('removeBackground must be true or false. Choose the background treatment with cutrisMode.');
  if(typeof values.autoCrop!=='boolean')throw new Error('autoCrop must be true or false.');
  if(!['detail','fast'].includes(values.cutrisQuality))throw new Error('cutrisQuality must be "detail" or "fast".');
  if(!['ai','white'].includes(values.cutrisMode))throw new Error('cutrisMode must be "ai" (Any background) or "white" (White illustration).');
  return values;
}

function jsonValues(source){
  source=source.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1').trim();
  const values=[];let position=0;
  while(position<source.length){
    while(/[\s,]/.test(source[position]||'')&&position<source.length)position++;
    if(position===source.length)break;
    if(source[position]!=='{'&&source[position]!=='[')throw new Error('Paste a JSON object or array. Separate objects with '+SEPARATOR+' if needed.');
    const start=position;let depth=0,quoted=false,escaped=false,complete=false;
    for(;position<source.length;position++){
      const char=source[position];
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"')quoted=true;
      else if(char==='{'||char==='[')depth++;
      else if(char==='}'||char===']'){if(--depth===0){position++;complete=true;break;}}
    }
    if(!complete)throw new Error('The JSON is incomplete. Check brackets and quoted text.');
    try{values.push(JSON.parse(source.slice(start,position)));}catch{throw new Error('The JSON is invalid. Check commas, brackets, and quoted text.');}
  }
  return values;
}

function flatten(value){
  if(Array.isArray(value))return value.flatMap(flatten);
  if(value&&typeof value==='object'&&Array.isArray(value.prompts))return value.prompts.flatMap(entry=>typeof entry==='string'?{prompt:entry,settings:value.defaults||{}}:{...entry,settings:{...value.defaults,...entry.settings}});
  return [value];
}

export function parsePromptInput(source,defaults={},mode='auto'){
  if(typeof source!=='string'||!source.trim())throw new Error('Write at least one prompt.');
  if(source.length>150000)throw new Error('This queue is too large.');
  if(!['single','bulk','json','auto'].includes(mode))throw new Error('Choose an input mode.');
  let entries;
  if(mode==='single')entries=[{prompt:source.trim()}];
  else{
    const blocks=source.trim().split(/^---PROMPT---\r?$/m);
    if(blocks.some(block=>!block.trim()))throw new Error('A separator has an empty prompt beside it. Fill it in or remove the separator.');
    entries=blocks.flatMap(block=>{
      const text=block.trim();
      return mode==='json'||/^(?:[\[{]|```(?:json)?\s*\n)/i.test(text)?jsonValues(text).flatMap(flatten):[{prompt:text}];
    });
  }
  if(!entries.length||entries.length>MAX_PROMPTS)throw new Error('Use between 1 and 25 prompts per queue.');
  return entries.map((entry,index)=>{
    try{
      if(typeof entry==='string')entry={prompt:entry};
      if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('Each entry needs a prompt or a JSON object.');
      if(entry.settings!==undefined&&(!entry.settings||typeof entry.settings!=='object'||Array.isArray(entry.settings)))throw new Error('Settings must be a JSON object.');
      const structured=entry.prompt===undefined;
      const prompt=typeof entry.prompt==='string'?entry.prompt:JSON.stringify(structured?entry:entry.prompt,null,2);
      if(!prompt?.trim()||prompt.length>16000)throw new Error('The prompt must contain between 1 and 16,000 characters.');
      if(entry.title!==undefined&&(typeof entry.title!=='string'||entry.title.length>120))throw new Error('The prompt title is too long.');
      return {prompt:prompt.trim(),title:structured?'':entry.title||'',...promptOptions(structured?{}:entry,defaults)};
    }catch(error){throw new Error('Prompt '+(index+1)+': '+error.message);}
  });
}
