import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {imageExtension,saveDownload} from '../src/downloads.mjs';
test('recognizes supported image signatures, rejects renamed text',()=>{
  assert.equal(imageExtension(Buffer.from([137,80,78,71,13,10,26,10])),'.png');
  assert.throws(()=>imageExtension(Buffer.from('not an image but named png')),/not a supported image/);
});
test('only copies the exact job-associated image and never overwrites it',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flow-image-test-'));t.after(()=>{if(path.dirname(temp)!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('flow-image-test-'))throw new Error('Unexpected test cleanup path.');return fs.rm(temp,{recursive:true,force:true});});
  const marker=randomUUID()+'-1',source=path.join(temp,marker+'.png'),folder=path.join(temp,'out');
  await fs.writeFile(source,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]));
  await assert.rejects(saveDownload(source,folder,randomUUID()+'-1'),/does not match/);
  const saved=await saveDownload(source,folder,marker,{title:'Crystal icon'});assert.equal(saved.bytes,40);assert(await fs.stat(source));
  assert.equal(saved.name,'crystal-icon.png');assert.equal(path.dirname(saved.path),path.join(folder,'originals'));
  const duplicate=await saveDownload(source,folder,marker,{title:'Crystal icon'});assert.equal(duplicate.name,'crystal-icon-2.png');assert.deepEqual(await fs.readFile(saved.path),await fs.readFile(duplicate.path));
});
