import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {exportFolders} from './export-files.mjs';

const run=promisify(execFile);
export function displayOutputFolder(folder,home=os.homedir()){
  const relative=path.relative(home,folder);
  return !relative?'Home':!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)?relative:folder;
}
async function windowsPictures(){
  const command="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); [Environment]::GetFolderPath([Environment+SpecialFolder]::MyPictures)";
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,encoding:'utf8'});
  return stdout.trim();
}

export async function defaultOutputFolder({platform=process.platform,home=os.homedir(),pictures=windowsPictures}={}){
  const paths=platform==='win32'?path.win32:path.posix;
  if(platform==='win32'){
    try{const folder=await pictures();if(typeof folder==='string'&&paths.isAbsolute(folder))return paths.join(folder,'gflowris-images');}catch{}
    return paths.join(home,'gflowris-images');
  }
  return paths.join(home,'Pictures','gflowris-images');
}

// Check permissions before spending time on generation. Existing files are untouched.
export async function prepareOutputFolder(folder){
  try{
    const folders=await exportFolders(folder);
    for(const target of [folders.originals,folders.cutouts,folders.downloads]){
      const probe=path.join(target,'.gflowris-write-'+randomUUID()+'.tmp');
      let handle;
      try{handle=await fs.open(probe,'wx');}
      finally{if(handle){await handle.close();await fs.unlink(probe);}}
    }
  }catch{throw new Error('The output folder could not be created or written to. Choose another folder before generating.');}
}
