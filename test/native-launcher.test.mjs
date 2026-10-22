import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MessageReader,encodeMessage} from '../src/native-protocol.mjs';

test('Windows native launcher replies immediately while the input pipe remains open',{skip:process.platform!=='win32'},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flow-native-launcher-'));
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  let child;
  t.after(async()=>{
    if(child){child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{const timer=setTimeout(()=>child.kill(),3000);child.once('close',()=>{clearTimeout(timer);resolve();});}});}
    if(path.dirname(temp)!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('flow-native-launcher-'))throw new Error('Unexpected cleanup path.');
    await fs.rm(temp,{recursive:true,force:true});
  });
  const executable=path.join(temp,'host.exe');
  const build=spawn(compiler,['/nologo','/target:exe','/reference:System.Web.Extensions.dll','/out:'+executable,path.join(root,'native','Launcher.cs')],{windowsHide:true,stdio:'pipe'});
  assert.equal(await new Promise(resolve=>build.once('close',resolve)),0);
  await fs.mkdir(path.join(temp,'src'));
  await fs.writeFile(path.join(temp,'runtime.json'),JSON.stringify({nodeExe:process.execPath,projectRoot:temp,stateRoot:temp}));
  await fs.writeFile(path.join(temp,'src','native-host.mjs'),"process.stdin.on('data',chunk=>process.stdout.write(chunk));");
  child=spawn(executable,['chrome-extension://'+'a'.repeat(32)+'/'],{windowsHide:true,stdio:'pipe'});
  const reader=new MessageReader();child.stdout.on('data',bytes=>reader.push(bytes));
  // Cold Windows runners scan newly compiled hosts before launching them.
  // The pipe must still reply while stdin remains open; allow startup 30 seconds.
  const reply=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Native host startup/response exceeded 30 seconds.')),30000);reader.once('message',message=>{clearTimeout(timer);resolve(message);});reader.once('error',reject);child.once('error',reject);});
  child.stdin.write(encodeMessage({id:'live-pipe',text:'Café ☁'}));
  assert.deepEqual(await reply,{id:'live-pipe',text:'Café ☁'});
  assert.equal(child.stdin.writableEnded,false);
});
