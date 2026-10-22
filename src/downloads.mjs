import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
export function imageExtension(bytes){
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '.png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return '.jpg';
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return '.webp';
  if(bytes.toString('ascii',4,8)==='ftyp'&&/avif|avis/.test(bytes.toString('ascii',8,32)))return '.avif';
  throw new Error('The completed download is not a supported image.');
}
export async function saveDownload(filename,folder,marker){
  if(!/^[0-9a-f-]{36}-[1-4]$/.test(marker)||!path.isAbsolute(filename)||!path.basename(filename).startsWith(marker+'.'))throw new Error('The download does not match the active image.');
  const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<24||stat.size>150*1024*1024)throw new Error('The image file is missing or has an unexpected size.');
  const file=await fs.open(filename,'r');let bytes=Buffer.alloc(32);try{await file.read(bytes,0,32,0);}finally{await file.close();}
  const extension=imageExtension(bytes);await fs.mkdir(folder,{recursive:true});
  const name=marker+extension,target=path.join(folder,name);
  if(path.resolve(filename)!==path.resolve(target))await fs.copyFile(filename,target,constants.COPYFILE_EXCL);
  return {name,path:target,bytes:stat.size,savedAt:new Date().toISOString()};
}
