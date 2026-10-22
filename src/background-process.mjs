import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

export async function backgroundPython(executable){
  if(process.platform==='win32'&&path.basename(executable).toLowerCase()==='python.exe'){
    const candidate=path.join(path.dirname(executable),'pythonw.exe');
    try{await fs.access(candidate);return candidate;}catch{}
  }
  return executable;
}

export async function launchBackgroundPython(executable,args,{cwd,stdio}){
  const command=await backgroundPython(executable);
  // A detached Windows console process can allocate a new console despite
  // windowsHide. Pythonw and a non-detached launch avoid that allocation.
  const child=spawn(command,args,{cwd,stdio,windowsHide:true,detached:false});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  return child;
}
