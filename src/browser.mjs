import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
export {stateRoot} from './paths.mjs';
export async function openRegularChrome(url='https://flow.google.com/'){
  const roots=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean);
  for(const folder of roots){
    const executable=path.join(folder,'Google','Chrome','Application','chrome.exe');
    try{await fs.access(executable);}catch{continue;}
    const child=spawn(executable,['--new-tab',url],{detached:true,stdio:'ignore',windowsHide:false});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return;
  }
  throw new Error('Google Chrome was not found.');
}
