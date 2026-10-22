import {SEPARATOR} from './prompt-input.js';

const icon={title:'Crystal icon',prompt:'A lavender crystal game icon on a plain white background',ratio:'1:1',count:1,resolution:'2K',removeBackground:true,autoCrop:true};
const landscape={title:'Landscape',prompt:'A mountain valley at sunrise with warm light and soft mist',ratio:'16:9',count:1,resolution:'2K',removeBackground:false};
const shared={defaults:{ratio:'1:1',count:1,resolution:'2K',removeBackground:true,autoCrop:true,cutrisQuality:'detail',cutrisMode:'ai'},prompts:[{title:'Crystal icon',prompt:icon.prompt},{title:'Backpack icon',prompt:'A mint adventure backpack icon on a plain white background'}]};
const examples={
  single:{description:'One object creates one queue card. Model and other omitted choices use the composer.',text:JSON.stringify(icon,null,2)},
  shared:{description:'defaults applies to every entry in prompts. Add up to 25 entries.',text:JSON.stringify(shared,null,2)},
  individual:{description:'Each object has its own settings. This keeps the landscape background and removes the icon background.',text:JSON.stringify([icon,landscape],null,2)},
  blocks:{description:'Put '+SEPARATOR+' on its own line between complete JSON objects or arrays. Use JSON mode or Import JSON.',text:JSON.stringify(icon,null,2)+'\n'+SEPARATOR+'\n'+JSON.stringify(landscape,null,2)},
};

function aiInstructions(){
  const choices=[];
  for(const [id,label]of [['model','Models'],['ratio','Ratios'],['resolution','Download sizes']]){
    const select=document.getElementById(id);
    if(select&&!select.disabled){const values=[...select.options].filter(option=>!option.disabled&&option.value).map(option=>option.value);if(values.length)choices.push(label+': '+values.join(', '));}
  }
  return 'Create image-generation prompts for gflowris using the image brief below. Return one valid JSON object only, without Markdown fences or commentary.\n\n'
    +'Use a defaults object for shared settings and a prompts array containing 1 to 25 entries. Each entry needs a prompt (a string or a structured JSON object); title is optional. Put different settings directly on that entry to override defaults.\n\n'
    +'Supported settings: model, ratio, count (integer 1 to 4), resolution, removeBackground (boolean), autoCrop (boolean), cutrisQuality ("detail" or "fast"), cutrisMode ("ai" for any background or "white" for a white illustration). Omitted settings use the app composer. Do not invent extra settings.\n\n'
    +(choices.length?'Use only these currently available Flow choices:\n'+choices.join('\n')+'\n\n':'Omit model. Use an aspect ratio and download size available in my Flow project.\n\n')
    +'Set removeBackground to true for transparent icons or isolated subjects, and false when the full scene should be kept. Use double quotes, true/false without quotes, and no trailing commas.\n\n'
    +'Example format:\n'+JSON.stringify(shared,null,2)+'\n\n'
    +'My image brief: [replace this with the subjects, style, number of prompts, and any different settings I want].';
}

export function initPromptHelp(){
  const $=selector=>document.querySelector(selector),dialog=$('#prompt-help-dialog'),status=$('#prompt-copy-status');
  function showExample(){const example=examples[$('#prompt-example-kind').value];$('#prompt-json-example').textContent=example.text;$('#prompt-example-description').textContent=example.description;status.textContent='Examples leave your current draft unchanged.';delete status.dataset.tone;}
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
  $('#prompt-help-open').onclick=()=>{showExample();$('#prompt-ai-instructions').value=aiInstructions();if(!dialog.open)dialog.showModal();};
  $('#prompt-example-kind').onchange=showExample;
  $('#copy-prompt-example').onclick=()=>copy($('#prompt-json-example').textContent,'Example');
  $('#copy-ai-instructions').onclick=()=>copy($('#prompt-ai-instructions').value,'AI instructions');
}
