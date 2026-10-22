import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';

export function readableStem(value,fallback='image'){
  const text=String(value||'').normalize('NFKC').replace(/\.(png|jpe?g|webp|avif)$/i,'');
  let stem=text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu,'-').replace(/^-+|-+$/g,'');
  stem=Array.from(stem).slice(0,80).join('').replace(/-+$/,'')||fallback;
  if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem))stem='image-'+stem;
  return stem;
}

export function imageStem({title,flowTitle,prompt,index=0,count=1}={}){
  const description=typeof prompt==='string'?prompt.split(/\r?\n/).find(line=>line.trim()):'';
  const stem=Array.from(readableStem(title?.trim()||flowTitle?.trim()||description)).slice(0,64).join('').replace(/-+$/,'');
  return Number(count)>1?stem+'-'+String(index+1).padStart(2,'0'):stem;
}

export async function exportFolders(root){
  if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('Choose an absolute output folder.');
  const outputRoot=path.resolve(root),originals=path.join(outputRoot,'originals'),cutouts=path.join(outputRoot,'cutouts');
  await Promise.all([fs.mkdir(originals,{recursive:true}),fs.mkdir(cutouts,{recursive:true})]);
  return {outputRoot,originals,cutouts};
}

async function uniqueFile(folder,stem,extension,save){
  const base=readableStem(stem);
  for(let index=0;index<10000;index++){
    const name=base+(index?'-'+(index+1):'')+extension,target=path.join(folder,name);
    try{await save(target);return {name,path:target};}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  throw new Error('Too many images have this name. Choose another title or output folder.');
}

export async function copyExport(source,folder,stem,extension){
  if(!['.png','.jpg','.webp','.avif'].includes(extension))throw new Error('Unsupported image extension.');
  return uniqueFile(folder,stem,extension,target=>fs.copyFile(source,target,constants.COPYFILE_EXCL));
}

export async function writePngExport(bytes,folder,stem){
  return uniqueFile(folder,stem,'.png',async target=>{
    const file=await fs.open(target,'wx');
    try{await file.writeFile(bytes);}
    catch(error){await file.close();await fs.unlink(target).catch(()=>{});throw error;}
    await file.close();
  });
}
