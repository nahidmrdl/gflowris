import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parsePromptInput,MAX_PROMPTS} from '../public/prompt-input.js';

export function normalizeDraftItems(items){
  if(!Array.isArray(items)||items.length>MAX_PROMPTS)throw new Error('A queue can contain up to 25 prompts.');
  if(!items.length)return [];
  const normalized=parsePromptInput(JSON.stringify(items));
  const seen=new Set();
  return normalized.map((entry,index)=>{
    const id=items[index].id||randomUUID();
    if(!/^[0-9a-f-]{36}$/.test(id)||seen.has(id))throw new Error('Choose each prompt once.');
    seen.add(id);return {id,...entry};
  });
}

export class DraftQueue{
  constructor(file){this.file=file;this.state={revision:0,items:[]};this.writes=Promise.resolve();}
  async load(){try{const saved=JSON.parse(await fs.readFile(this.file,'utf8'));if(Number.isInteger(saved.revision)&&saved.revision>=0)this.state={revision:saved.revision,items:normalizeDraftItems(saved.items)};}catch{}return this;}
  update(data){
    const operation=this.writes.catch(()=>{}).then(async()=>{
      if(!data||data.revision!==this.state.revision)throw new Error('The queue changed in another window. Refresh it before saving.');
      const next={revision:this.state.revision+1,items:normalizeDraftItems(data.items)};
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      const temporary=this.file+'.'+randomUUID()+'.tmp';
      try{await fs.writeFile(temporary,JSON.stringify(next));await fs.rename(temporary,this.file);}catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
      this.state=next;return structuredClone(next);
    });
    this.writes=operation;return operation;
  }
}
