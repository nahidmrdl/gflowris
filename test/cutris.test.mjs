import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {CutrisClient} from '../src/cutris-client.mjs';
import {ImageQueue,parsePrompts} from '../src/jobs.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCzkAAAAASUVORK5CYII=','base64');

test('an open Cutris desktop takes priority and receives editor requests',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'flow-cutris-test-'));
  const key='x'.repeat(48);let opened=null;
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer '+key);res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/health')res.end(JSON.stringify({name:'cutris',api_version:1,editor_available:true}));
    else if(req.url==='/v1/editor/open'){let data='';for await(const part of req)data+=part;opened=JSON.parse(data).project_id;res.end('{"ok":true}');}
    else res.end('{"models":{"detail":true,"fast":true}}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('flow-cutris-test-'));await fs.rm(folder,{recursive:true,force:true});});
  const integration=path.join(folder,'data','integration');await fs.mkdir(integration,{recursive:true});
  const keyFile=path.join(integration,'key');await fs.writeFile(keyFile,key);
  await fs.writeFile(path.join(integration,'service.json'),JSON.stringify({name:'cutris',api_version:1,origin:'http://127.0.0.1:'+server.address().port,key_file:keyFile,source:'desktop',data_dir:folder}));
  await fs.writeFile(path.join(folder,'runtime.json'),JSON.stringify({cutrisRoot:folder}));
  const client=new CutrisClient(folder);const status=await client.status();assert.equal(status.source,'desktop');assert.equal(status.editorAvailable,true);
  assert.equal((await client.requestEditor({projectId:'a'.repeat(32)})).embedded,false);assert.equal(opened,'a'.repeat(32));
});

test('four cutouts finish before the next prompt, saved edits return, and originals survive API failures',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'flow-cutris-test-'));
  let failure=false,requests=0;
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer fixture-key');
    if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:{detail:true,fast:false}}));return;}
    if(failure){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({detail:'Fixture model unavailable'}));return;}
    if(req.method==='POST'){
      const parts=[];for await(const part of req)parts.push(part);const body=Buffer.concat(parts).toString();
      assert(body.includes('name="editable"\r\n\r\ntrue'));assert(body.includes('name="auto_crop"\r\n\r\ntrue'));requests++;
    }
    res.writeHead(200,{'Content-Type':'image/png','X-Cutris-Project':'a'.repeat(32),'X-Cutris-Width':'1','X-Cutris-Height':'1','X-Cutris-Revision':'1'});res.end(png);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));if(path.dirname(folder)!==path.resolve(os.tmpdir())||!path.basename(folder).startsWith('flow-cutris-test-'))throw new Error('Unexpected cleanup path.');await fs.rm(folder,{recursive:true,force:true});});
  const client=new CutrisClient(folder);client.connect=async()=>({origin:'http://127.0.0.1:'+server.address().port,headers:{Authorization:'Bearer fixture-key'}});
  assert((await client.preflight('detail')).ready);await assert.rejects(()=>client.preflight('fast'),/Install/);
  const order=[];
  const queue=new ImageQueue({generate:async item=>{order.push('generate '+item.index);return {};},generation:async(_,item)=>({complete:true,assets:Array.from({length:item.count},(_,i)=>i)}),download:async(_,item,index)=>{
    const name=item.index+'-'+index+'.png',filename=path.join(folder,name);await fs.writeFile(filename,png);return {name,path:filename};
  },postprocess:async(file,item)=>{const result=await client.remove(file,{autoCrop:item.autoCrop});order.push('cutout '+item.index);return result;}});
  await queue.start(parsePrompts('[{"prompt":"four","count":4},{"prompt":"two","count":2}]',{removeBackground:true}));
  assert.equal(queue.state.status,'complete');assert.equal(requests,6);assert.equal(order.indexOf('generate 2'),5);
  for(const item of queue.state.items)for(const file of item.files){assert.deepEqual(await fs.readFile(file.path),png);assert(file.cutout.projectId);assert.notEqual(file.path,file.cutout.path);}
  const file=queue.state.items[0].files[0];const edited=await client.refresh(file.cutout);assert.equal(edited.revision,1);assert.notEqual(edited.path,file.cutout.path);assert.deepEqual(await fs.readFile(file.cutout.path),png);
  failure=true;await assert.rejects(()=>client.remove(file),/Fixture model unavailable/);assert.deepEqual(await fs.readFile(file.path),png);
});
