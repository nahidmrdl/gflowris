import fs from 'node:fs/promises';
import path from 'node:path';
import {launchBackgroundPython} from './background-process.mjs';
import {sleep} from './companion-control.mjs';
import {imageExtension} from './downloads.mjs';
import {exportFolders,writePngExport} from './export-files.mjs';
import {checkCancellation} from './cancellation.mjs';
const readJson=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
export class CutrisClient{
  constructor(stateRoot){this.stateRoot=stateRoot;this.starting=null;this.busy=false;}
  async connect(){
    if(this.starting)return this.starting;
    this.starting=this.ensure().finally(()=>{this.starting=null;});return this.starting;
  }
  async readConnection(descriptorFile=path.join(this.stateRoot,'cutris-service.json')){
    const descriptor=await readJson(descriptorFile);
    if(descriptor.name!=='cutris'||descriptor.api_version!==1||!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(descriptor.origin))throw new Error('Invalid Cutris service descriptor.');
    const token=(await fs.readFile(descriptor.key_file,'utf8')).trim();
    if(!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw new Error('Invalid Cutris API key.');
    const headers={Authorization:'Bearer '+token};
    const response=await fetch(descriptor.origin+'/v1/health',{headers,signal:AbortSignal.timeout(1500)});
    if(!response.ok)throw new Error('Cutris is unavailable.');
    const health=await response.json();if(health.name!=='cutris'||health.api_version!==1)throw new Error('Unsupported Cutris API.');
    return {origin:descriptor.origin,headers,health,descriptorFile,dataDir:descriptor.data_dir,source:descriptor.source||'background',owner:descriptor.owner};
  }
  async existingConnection(){
    try{const embedded=await this.readConnection();if(embedded.owner==='gflowris')return embedded;}catch{}
    const runtime=await readJson(path.join(this.stateRoot,'runtime.json')).catch(()=>{throw new Error('Open gflowris to configure the local Cutris runtime. If the problem continues, reinstall the latest gflowris release.');});
    const candidates=[runtime.cutrisRoot?path.join(runtime.cutrisRoot,'data','integration','service.json'):null,
      process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'Cutris','api','service.json'):null].filter(Boolean);
    for(const file of candidates){try{const connection=await this.readConnection(file);if(connection.source==='desktop')return connection;}catch{}}
    try{return await this.readConnection();}catch{}
    throw new Error('The Cutris engine is closed. Open gflowris to sync saved edits.');
  }
  async ensure(){
    try{return await this.existingConnection();}catch{}
    const runtime=await readJson(path.join(this.stateRoot,'runtime.json')).catch(()=>{throw new Error('Open gflowris to configure the local Cutris runtime. If the problem continues, reinstall the latest gflowris release.');});
    if(!path.isAbsolute(runtime.pythonExe||''))throw new Error('Configure a Cutris Python runtime first.');
    const log=await fs.open(path.join(this.stateRoot,'cutris.log'),'a');
    try{
      const child=await launchBackgroundPython(runtime.pythonExe,['-m','cutris','serve','--port','0','--descriptor',path.join(this.stateRoot,'cutris-service.json'),'--key-file',path.join(this.stateRoot,'cutris-api-key')],{cwd:runtime.cutrisRoot||runtime.projectRoot,stdio:['ignore',log.fd,log.fd]});
      child.unref();
    }finally{await log.close();}
    for(let i=0;i<150;i++){try{return await this.readConnection();}catch{}await sleep(100);}
    throw new Error('Cutris could not start. Check the local Cutris log and installed dependencies.');
  }
  async status(){
    const connection=await this.connect();
    const response=await fetch(connection.origin+'/v1/models',{headers:connection.headers,signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Cutris model check failed.');
    return {ready:true,...await response.json(),busy:this.busy,source:connection.source||'background',owner:connection.owner,editorAvailable:!!connection.health?.editor_available};
  }
  async connectionFor(cutout,{allowStart=true}={}){
    const current=await (allowStart?this.connect():this.existingConnection());
    if(cutout.dataDir&&current.dataDir&&cutout.dataDir!==current.dataDir&&cutout.serviceDescriptor){try{return await this.readConnection(cutout.serviceDescriptor);}catch{}}
    return current;
  }
  async requestEditor(cutout){
    const connection=await this.connectionFor(cutout);
    if(!connection.health?.editor_available)return {embedded:true};
    const response=await fetch(connection.origin+'/v1/editor/open',{method:'POST',headers:{...connection.headers,'Content-Type':'application/json'},body:JSON.stringify({project_id:cutout.projectId}),signal:AbortSignal.timeout(10000)});
    if(!response.ok){if([404,409].includes(response.status))return {embedded:true};throw new Error('The Cutris editor could not open this image.');}
    const result=await response.json();if(result.ok===false)throw new Error(result.error||'The Cutris editor could not open this image.');
    return {embedded:false,...result};
  }
  async preflight(quality){
    const state=await this.status();if(!state.models?.[quality])throw new Error('Install the selected Cutris model before running this queue: cutris models download --quality '+quality);return state;
  }
  async projectState(cutout){
    if(!/^[a-f0-9]{32}$/.test(cutout.projectId||''))throw new Error('This cutout has no editable project.');
    const connection=await this.connectionFor(cutout,{allowStart:false});
    const response=await fetch(connection.origin+'/v1/projects/'+cutout.projectId,{headers:connection.headers,signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('The saved Cutris project is unavailable.');
    const result=await response.json();if(!Number.isInteger(result.revision)||result.revision<0)throw new Error('Invalid saved revision.');return result;
  }
  async refresh(cutout,{allowStart=true}={}){
    if(this.busy)throw new Error('Wait for Cutris to finish.');
    if(!/^[a-f0-9]{32}$/.test(cutout.projectId||''))throw new Error('This cutout has no editable project.');
    this.busy=true;
    try{
      const connection=await this.connectionFor(cutout,{allowStart});
      const response=await fetch(connection.origin+'/v1/projects/'+cutout.projectId+'/result',{headers:connection.headers,signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Save your changes in Cutris, then try again.');
      const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>150*1024*1024||imageExtension(bytes)!=='.png')throw new Error('Cutris returned an invalid PNG.');
      const stem=cutout.exportStem||path.parse(cutout.name).name.replace(/-edited-[a-f0-9]{8}$/i,'').replace(/-edited(?:-\d+)?$/,'');
      const folders=await exportFolders(cutout.outputRoot||path.dirname(cutout.path));
      const saved=await writePngExport(bytes,folders.cutouts,stem+'-edited');
      return {...cutout,...saved,outputRoot:folders.outputRoot,exportStem:stem,bytes:bytes.length,revision:Number(response.headers.get('x-cutris-revision')),width:Number(response.headers.get('x-cutris-width')),height:Number(response.headers.get('x-cutris-height')),savedAt:new Date().toISOString()};
    }finally{this.busy=false;}
  }
  async remove(file,options={}){
    checkCancellation(options.signal);
    if(this.busy)throw new Error('Cutris is processing another image. Wait for it to finish.');
    this.busy=true;
    try{
      const connection=await this.connect(),stat=await fs.lstat(file.path);
      checkCancellation(options.signal);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>30*1024*1024)throw new Error('Cutris accepts still images up to 30 MB. The original is saved.');
      const form=new FormData();form.append('file',new Blob([await fs.readFile(file.path)]),file.name);
      form.append('quality',options.quality||'detail');form.append('mode',options.mode||'ai');form.append('auto_crop',String(options.autoCrop!==false));form.append('editable','true');
      const timeout=AbortSignal.timeout(15*60*1000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
      checkCancellation(signal);
      const response=await fetch(connection.origin+'/v1/remove',{method:'POST',headers:connection.headers,body:form,signal});
      if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(typeof error.detail==='string'?error.detail:'Cutris could not finish this image. The original is saved.');}
      if(!response.headers.get('content-type')?.startsWith('image/png'))throw new Error('Cutris returned an unexpected response.');
      const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>150*1024*1024||imageExtension(bytes)!=='.png')throw new Error('Cutris returned an invalid PNG.');
      const folders=await exportFolders(file.outputRoot||path.dirname(file.path)),stem=file.exportStem||path.parse(file.name).name;
      checkCancellation(signal);
      const projectId=response.headers.get('x-cutris-project');
      if(!/^[a-f0-9]{32}$/.test(projectId||''))throw new Error('Cutris did not return an editable project. The original is saved.');
      const saved=await writePngExport(bytes,folders.cutouts,stem);
      return {...saved,outputRoot:folders.outputRoot,exportStem:path.parse(saved.name).name,bytes:bytes.length,projectId,revision:0,serviceDescriptor:connection.descriptorFile,dataDir:connection.dataDir,width:Number(response.headers.get('x-cutris-width')),height:Number(response.headers.get('x-cutris-height')),savedAt:new Date().toISOString()};
    }finally{this.busy=false;}
  }
}
