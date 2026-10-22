import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';

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
  let probe,handle;
  try{
    await fs.mkdir(folder,{recursive:true});
    probe=path.join(folder,'.gflowris-write-'+randomUUID()+'.tmp');
    handle=await fs.open(probe,'wx');
    await handle.close();handle=null;
  }catch{throw new Error('The output folder could not be created or written to. Choose another folder before generating.');}
  finally{if(handle)await handle.close().catch(()=>{});if(probe)await fs.unlink(probe).catch(()=>{});}
}
