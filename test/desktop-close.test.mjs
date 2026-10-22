import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CutrisClient} from '../src/cutris-client.mjs';
import {backgroundPython,launchBackgroundPython} from '../src/background-process.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('saved-revision checks and automatic exports never launch a closed engine',async()=>{
 const client=new CutrisClient('unused');let starts=0;
 client.connect=async()=>{starts++;throw new Error('Unexpected engine launch');};
 client.existingConnection=async()=>{throw new Error('Engine closed');};
 const cutout={projectId:'a'.repeat(32)};
 await assert.rejects(()=>client.projectState(cutout),/Engine closed/);
 await assert.rejects(()=>client.refresh(cutout,{allowStart:false}),/Engine closed/);
 assert.equal(starts,0);assert.equal(client.busy,false);
});

test('closing the desktop leaves the sync timer idle and never starts a helper',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gflowris-close-'));
 const queue={status:'complete',items:[{id:'11111111-1111-4111-8111-111111111111',index:1,prompt:'Fixture',count:1,status:'complete',files:[{name:'original.png',path:path.join(folder,'original.png'),cutout:{projectId:'a'.repeat(32),revision:0,name:'cutout.png',path:path.join(folder,'cutout.png')}}]}]};
 await fs.writeFile(path.join(folder,'last-queue.json'),JSON.stringify(queue));
 await fs.writeFile(path.join(folder,'runtime.json'),JSON.stringify({pythonExe:process.execPath,cutrisRoot:folder,projectRoot:folder}));
 const child=spawn(process.execPath,[path.join(root,'src','server.mjs'),'--no-open'],{env:{...process.env,LOCALAPPDATA:folder,FLOW_PROTO_STATE_DIR:folder,FLOW_PROTO_PORT:'4322'},windowsHide:true,stdio:'pipe'});
 let logs='';child.stderr.on('data',data=>logs+=data);
 t.after(async()=>{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('close',resolve);});assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('gflowris-close-'));await fs.rm(folder,{recursive:true,force:true});});
 let control;for(let i=0;i<600;i++){try{control=JSON.parse(await fs.readFile(path.join(folder,'control.json'),'utf8'));break;}catch{if(child.exitCode!==null)throw new Error(logs||'Companion exited during startup.');await pause(50);}}
 assert(control,logs||'Companion startup exceeded 30 seconds.');const headers={Authorization:'Bearer '+control.token,'Content-Type':'application/json'};
 const state=async()=>{const response=await fetch(control.origin+'/api/state',{headers});assert(response.ok);return response.json();};
 const heartbeat=async data=>{const response=await fetch(control.origin+'/api/desktop/heartbeat',{method:'POST',headers,body:JSON.stringify(data)});assert(response.ok);};
 await pause(2800);assert.equal((await state()).queue.items[0].files[0].syncError,undefined);
 await heartbeat({});await pause(2800);assert.match((await state()).queue.items[0].files[0].syncError,/engine is closed/);
 await heartbeat({closed:true});assert.equal((await state()).desktopOpen,false);await pause(2800);
 await assert.rejects(()=>fs.access(path.join(folder,'cutris.log')),{code:'ENOENT'});
});

test('Windows background Python starts without a console',{skip:process.platform!=='win32'},async t=>{
 let runtime;try{runtime=JSON.parse((await fs.readFile(path.join(root,'.local','runtime.json'),'utf8')).replace(/^\uFEFF/,''));}catch{t.skip('Local Python runtime is not configured.');return;}
 const executable=await backgroundPython(runtime.pythonExe);assert.equal(path.basename(executable).toLowerCase(),'pythonw.exe');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gflowris-quiet-')),report=path.join(folder,'probe.json');let child;
 t.after(async()=>{if(child&&child.exitCode===null)child.kill();assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('gflowris-quiet-'));await fs.rm(folder,{recursive:true,force:true});});
 child=await launchBackgroundPython(runtime.pythonExe,['-c',"import ctypes,json,sys; from pathlib import Path; Path(sys.argv[1]).write_text(json.dumps({'console':ctypes.windll.kernel32.GetConsoleWindow()}))",report],{cwd:folder,stdio:'ignore'});
 const exit=await new Promise(resolve=>{if(child.exitCode!==null)resolve(child.exitCode);else child.once('close',resolve);});
 assert.equal(exit,0);assert.equal(JSON.parse(await fs.readFile(report,'utf8')).console,0);
});
