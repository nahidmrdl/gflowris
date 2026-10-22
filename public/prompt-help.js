import {SEPARATOR} from './prompt-input.js';

export function promptChoices(capabilities={}){
  const strings=key=>Array.isArray(capabilities?.[key])?capabilities[key].filter(value=>typeof value==='string'&&value.trim()):[];
  return {ready:!!capabilities?.ready,models:strings('models'),ratios:strings('ratios'),resolutions:strings('resolutions'),counts:Array.isArray(capabilities?.counts)?capabilities.counts.filter(value=>Number.isInteger(value)&&value>=1&&value<=4):[],defaults:capabilities?.defaults||{}};
}

export function promptExamples(capabilities){
  const choices=promptChoices(capabilities),ratio=choices.ratios.includes('1:1')?'1:1':choices.ratios[0]||'1:1';
  const resolution=choices.resolutions.includes('2K')?'2K':choices.resolutions[0]||'2K',count=choices.counts.includes(1)?1:choices.counts[0]||1;
  const model=choices.models.includes(choices.defaults.model)?choices.defaults.model:choices.models[0];
  const common={...(model?{model}:{}),ratio,count,resolution};
  const icon={title:'Crystal icon',prompt:'A lavender crystal game icon on a plain white background',...common,removeBackground:true,cutrisMode:'white',cutrisQuality:'detail',autoCrop:true};
  const subject={title:'Traveler',prompt:'A traveler wearing a teal jacket, standing in front of a stone building',...common,removeBackground:true,cutrisMode:'ai',cutrisQuality:'detail',autoCrop:true};
  const landscape={title:'Landscape',prompt:'A mountain valley at sunrise with warm light and soft mist',...common,ratio:choices.ratios.includes('16:9')?'16:9':ratio,removeBackground:false};
  const shared={defaults:{...common,removeBackground:true,cutrisMode:'ai',cutrisQuality:'detail',autoCrop:true},prompts:[{title:'Crystal icon',prompt:icon.prompt,cutrisMode:'white'},{title:'Traveler',prompt:subject.prompt}]};
  return {
    single:{description:'One object creates one queue card. This example removes a white background with Best detail and auto crop.',text:JSON.stringify(icon,null,2)},
    white:{description:'Use removeBackground: true with cutrisMode: "white" for a white-background illustration. Quality can be "detail" or "fast".',text:JSON.stringify(icon,null,2)},
    any:{description:'Use removeBackground: true with cutrisMode: "ai" for any background. Change cutrisQuality to "fast" to use the lighter model.',text:JSON.stringify(subject,null,2)},
    keep:{description:'Use removeBackground: false to keep the original scene. Cutris mode, quality, and auto crop are not applied.',text:JSON.stringify(landscape,null,2)},
    shared:{description:'defaults applies to every entry in prompts. The crystal overrides the background mode; the traveler uses the shared mode.',text:JSON.stringify(shared,null,2)},
    individual:{description:'Each object keeps its own settings: white-background removal, any-background removal, or no removal.',text:JSON.stringify([icon,subject,landscape],null,2)},
    blocks:{description:'Put '+SEPARATOR+' on its own line between complete JSON objects or arrays. Each block can choose a different background mode and generation settings.',text:[icon,subject,landscape].map(value=>JSON.stringify(value,null,2)).join('\n'+SEPARATOR+'\n')}
  };
}

export function aiInstructions(capabilities){
  const choices=promptChoices(capabilities),available=[];
  for(const [field,label]of [['models','Models'],['ratios','Ratios'],['counts','Image counts'],['resolutions','Download sizes']])if(choices[field].length)available.push(label+': '+choices[field].join(', '));
  return 'Create image-generation prompts for gflowris using the image brief below. Return one valid JSON object only, without Markdown fences or commentary.\n\n'
    +'Use a defaults object for shared settings and a prompts array containing 1 to 25 entries. Each entry needs a prompt (a string or a structured JSON object). Add a short descriptive title to name its queue card and exported image files. Put different settings directly on an entry to override defaults.\n\n'
    +'Supported generation settings: model (an exact available model name), ratio (an available aspect ratio), count (integer 1, 2, 3, or 4, subject to account availability), resolution ("1K", "2K", or "4K", subject to account availability). Omitted fields use the composer. Do not invent extra settings.\n\n'
    +'Background removal settings:\nremoveBackground: true removes the background; false keeps the full original image. This field accepts booleans only.\ncutrisMode: "ai" means Any background; "white" means White illustration.\ncutrisQuality: "detail" means Best detail; "fast" means Faster.\nautoCrop: true trims unused transparent margins; false keeps the original canvas dimensions.\nMode, quality, and auto crop apply only when removeBackground is true. These settings are independent and can be overridden for each prompt.\n\n'
    +(choices.ready&&available.length?'Use only these choices available in the connected Flow project:\n'+available.join('\n')+'\n\n':'Flow choices have not been loaded. Omit model and ask me for the supported ratios, image counts, and download sizes before selecting unavailable options.\n\n')
    +'Use double quotes, true/false without quotes, and no trailing commas.\n\nExample format:\n'+promptExamples(capabilities).shared.text+'\n\n'
    +'My image brief: [replace this with the subjects, style, number of prompts, and any different settings I want].';
}

export function initPromptHelp({getCapabilities=()=>null}={}){
  const $=selector=>document.querySelector(selector),dialog=$('#prompt-help-dialog'),status=$('#prompt-copy-status');
  function showExample(){const example=promptExamples(getCapabilities())[$('#prompt-example-kind').value];$('#prompt-json-example').textContent=example.text;$('#prompt-example-description').textContent=example.description;status.textContent='Examples leave your current draft unchanged.';delete status.dataset.tone;}
  function showOptions(){
    const choices=promptChoices(getCapabilities()),quote=values=>values.map(value=>JSON.stringify(value)).join(', ');
    $('#prompt-available-status').textContent=choices.ready?'Generation choices below come from the connected Flow project.':'Connect Flow and refresh Flow settings to load every available model, ratio, image count, and download size.';
    const fields=[
      ['title','A short descriptive name','Optional. Names the card and exported files.'],
      ['prompt','Text or a JSON object','Required image description.'],
      ['model',choices.models.length?quote(choices.models):'Load Flow settings to see model names','Use the exact model name. Omit to use the composer.'],
      ['ratio',choices.ratios.length?quote(choices.ratios):'Load Flow settings to see aspect ratios','Available ratios depend on the selected Flow model and account.'],
      ['count',choices.counts.length?choices.counts.join(', '):'1, 2, 3, 4','An integer. Use a count available in your Flow project.'],
      ['resolution',choices.resolutions.length?quote(choices.resolutions):'"1K", "2K", "4K"','Use a download size enabled for your account.'],
      ['removeBackground','true, false','true removes the background; false keeps the original scene.'],
      ['cutrisMode','"ai", "white"','"ai": Any background. "white": White illustration.'],
      ['cutrisQuality','"detail", "fast"','"detail": Best detail. "fast": Faster.'],
      ['autoCrop','true, false','Trim transparent margins, or keep the original canvas size.']
    ];
    const body=$('#prompt-options-body');body.replaceChildren();
    for(const [key,values,description]of fields){const row=document.createElement('tr');for(const [index,value]of[key,values,description].entries()){const cell=document.createElement(index===0?'th':'td');if(index===0){cell.scope='row';const code=document.createElement('code');code.textContent=value;cell.append(code);}else cell.textContent=value;row.append(cell);}body.append(row);}
  }
  async function copy(text,label){
    try{
      try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(text);}
      catch{
        const previous=document.activeElement,helper=document.createElement('textarea');helper.className='clipboard-helper';helper.value=text;helper.setAttribute('aria-label','Copy text');dialog.append(helper);
        try{helper.focus();helper.select();if(!document.execCommand('copy'))throw new Error('Clipboard unavailable');}
        finally{helper.remove();previous?.focus({preventScroll:true});}
      }
      status.textContent=label+' copied.';delete status.dataset.tone;
    }catch{status.textContent='Copy unavailable. Select the text and press Ctrl+C.';status.dataset.tone='error';}
  }
  $('#prompt-help-open').onclick=()=>{showOptions();showExample();$('#prompt-ai-instructions').value=aiInstructions(getCapabilities());if(!dialog.open)dialog.showModal();};
  $('#prompt-example-kind').onchange=showExample;
  $('#copy-prompt-example').onclick=()=>copy($('#prompt-json-example').textContent,'Example');
  $('#copy-ai-instructions').onclick=()=>copy($('#prompt-ai-instructions').value,'AI instructions');
}
