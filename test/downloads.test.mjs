import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {imageExtension,saveDownload} from '../src/downloads.mjs';
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]);

async function downloadFixture(context){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flow-image-test-'));
  context.after(()=>{if(path.dirname(temp)!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('flow-image-test-'))throw new Error('Unexpected test cleanup path.');return fs.rm(temp,{recursive:true,force:true});});
  const marker=randomUUID()+'-1',browserFolder=path.join(temp,'browser','gflowris'),source=path.join(browserFolder,marker+'.png'),folder=path.join(temp,'gflowris-images'),downloads=path.join(temp,'gflowris-downloads');
  await fs.mkdir(browserFolder,{recursive:true});await fs.writeFile(source,png);
  return {temp,marker,browserFolder,source,folder,downloads};
}
test('recognizes supported image signatures, rejects renamed text',()=>{
  assert.equal(imageExtension(Buffer.from([137,80,78,71,13,10,26,10])),'.png');
  assert.throws(()=>imageExtension(Buffer.from('not an image but named png')),/not a supported image/);
});
test('only archives the exact job-associated image beside readable exports and never overwrites it',async context=>{
  const {marker,source,folder,downloads,browserFolder}=await downloadFixture(context);
  await assert.rejects(saveDownload(source,folder,randomUUID()+'-1'),/does not match/);
  assert.deepEqual(await fs.readFile(source),png);
  const saved=await saveDownload(source,folder,marker,{title:'Crystal icon'});assert.equal(saved.bytes,40);await assert.rejects(fs.stat(source),{code:'ENOENT'});await assert.rejects(fs.stat(browserFolder),{code:'ENOENT'});
  assert.equal(saved.name,'crystal-icon.png');assert.equal(path.dirname(saved.path),path.join(folder,'originals'));
  assert.deepEqual(saved.download,{name:marker+'.png',path:path.join(downloads,marker+'.png')});assert.deepEqual(await fs.readFile(saved.path),png);assert.deepEqual(await fs.readFile(saved.download.path),png);
  const duplicate=await saveDownload(saved.download.path,folder,marker,{title:'Crystal icon'});assert.equal(duplicate.name,'crystal-icon-2.png');assert.deepEqual(duplicate.download,saved.download);assert.deepEqual(await fs.readFile(saved.path),await fs.readFile(duplicate.path));assert.deepEqual(await fs.readFile(saved.download.path),png);assert.deepEqual(await fs.readdir(downloads),[marker+'.png']);
});

test('archiving a conflicting raw filename preserves the existing file and uses a unique name',async context=>{
  const {marker,source,folder,downloads}=await downloadFixture(context),existing=Buffer.from('Keep this earlier browser download');
  await fs.mkdir(downloads);const occupied=path.join(downloads,marker+'.png');await fs.writeFile(occupied,existing);
  const saved=await saveDownload(source,folder,marker,{title:'Crystal icon'});
  assert.equal(saved.download.name,marker+'-2.png');assert.equal(saved.download.path,path.join(downloads,marker+'-2.png'));assert.deepEqual(await fs.readFile(occupied),existing);assert.deepEqual(await fs.readFile(saved.download.path),png);assert.deepEqual(await fs.readFile(saved.path),png);await assert.rejects(fs.stat(source),{code:'ENOENT'});
});

test('invalid image content leaves the browser download intact',async context=>{
  const {marker,source,folder}=await downloadFixture(context),invalid=Buffer.from('This is text pretending to be a supported image.');await fs.writeFile(source,invalid);
  await assert.rejects(saveDownload(source,folder,marker),/not a supported image/);assert.deepEqual(await fs.readFile(source),invalid);
});

for(const blocked of ['originals','downloads'])test('a blocked '+blocked+' destination leaves the browser download intact',async context=>{
  const {marker,source,folder,downloads}=await downloadFixture(context);
  const destination=blocked==='downloads'?downloads:path.join(folder,'originals');await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,'Keep this existing file');
  await assert.rejects(saveDownload(source,folder,marker));assert.deepEqual(await fs.readFile(source),png);assert.equal(await fs.readFile(destination,'utf8'),'Keep this existing file');
});

test('an archive copy failure keeps the browser download and the readable original',async context=>{
  const {marker,source,folder,downloads}=await downloadFixture(context),copyFile=fs.copyFile;
  fs.copyFile=async(input,output,...options)=>{if(path.dirname(output)===downloads)throw Object.assign(new Error('Fixture archive unavailable'),{code:'EACCES'});return copyFile(input,output,...options);};
  try{await assert.rejects(saveDownload(source,folder,marker,{title:'Crystal icon'}),/The original is saved, but the browser download could not be moved:.*Fixture archive unavailable/);}
  finally{fs.copyFile=copyFile;}
  assert.deepEqual(await fs.readFile(source),png);assert.deepEqual(await fs.readFile(path.join(folder,'originals','crystal-icon.png')),png);
});

test('archiving retains unrelated files in the browser landing folder',async context=>{
  const {marker,source,folder,browserFolder}=await downloadFixture(context),unrelated=path.join(browserFolder,'keep-this.txt');await fs.writeFile(unrelated,'Keep me');
  const saved=await saveDownload(source,folder,marker);
  assert.equal(await fs.readFile(unrelated,'utf8'),'Keep me');assert.deepEqual(await fs.readdir(browserFolder),['keep-this.txt']);assert.deepEqual(await fs.readFile(saved.download.path),png);
});
