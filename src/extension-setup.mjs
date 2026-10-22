import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {openRegularChrome} from './browser.mjs';

export async function extensionInfo(root,stateRoot){
  let bundled=false,extensionId=null;
  try{const manifest=JSON.parse(await fs.readFile(path.join(root,'extension','manifest.json'),'utf8'));bundled=manifest.manifest_version===3;}catch{}
  try{const registration=JSON.parse((await fs.readFile(path.join(stateRoot,'native-registration.json'),'utf8')).replace(/^\uFEFF/,''));extensionId=registration.origin.match(/^chrome-extension:\/\/([a-p]{32})\/$/)?.[1]||null;}catch{}
  return {bundled,extensionId,managerUrl:'chrome://extensions/'+(extensionId?'?id='+extensionId:'')};
}

export async function openExtensionFolder(root,stateRoot){
  const info=await extensionInfo(root,stateRoot);
  if(!info.bundled)throw new Error('The bundled extension is missing. Repair or reinstall gflowris.');
  const folder=path.join(root,'extension');
  const executable=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';
  const child=spawn(executable,[folder],{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}

export async function openExtensionManager(root,stateRoot){
  const info=await extensionInfo(root,stateRoot);
  await openRegularChrome(info.managerUrl);
}
