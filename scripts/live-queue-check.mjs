import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stateRoot} from '../src/browser.mjs';

const kind=process.argv[2];
if(!['four','multiple'].includes(kind))throw new Error('Choose four or multiple. This command creates a real Flow queue.');
const {origin,token}=JSON.parse(await fs.readFile(path.join(stateRoot,'control.json'),'utf8'));
if(origin!=='http://127.0.0.1:4317')throw new Error('Unexpected companion address.');
async function api(endpoint,data){
  const response=await fetch(origin+'/api/'+endpoint,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
const initial=await api('state');
if(!initial.connected)throw new Error('Reconnect the Flow project in the extension popup first.');
if(initial.queue.status==='running')throw new Error('A queue is already running; this script will not submit another.');
await api('discover',{});
const defaults={model:'Nano Banana 2.1',ratio:'1:1',count:kind==='four'?4:1,resolution:'2K'};
const prompts=kind==='four'?
  'A single polished turquoise game potion bottle icon, cork stopper, luminous liquid with tiny stars, centered on a clean white background, rounded 3D rendering, no text, no border.':
  JSON.stringify([
    {prompt:'A cheerful coral gift box game icon with a cream ribbon, centered on a clean white background, rounded polished 3D rendering, no text, no border.',ratio:'1:1',count:1},
    {prompt:'A small golden-yellow adventure backpack game icon with a front pocket and tiny turquoise charm, centered on a clean white background, rounded polished 3D rendering, no text, no border.',ratio:'4:3',count:1}
  ]);
const startedAt=new Date().toISOString(),transitions=[];
console.log(`Starting ${kind} test: ${kind==='four'?'one prompt × four images':'two prompts × one image'}, 2K.`);
// Exactly one submission; failures are never retried by this test runner.
await api('run',{prompts,defaults});
let state,signature='',deadline=Date.now()+25*60*1000;
while(Date.now()<deadline){
  state=await api('state');
  const next=JSON.stringify({status:state.queue.status,items:state.queue.items.map(item=>({index:item.index,status:item.status,stage:item.stage,files:item.files.length}))});
  if(next!==signature){signature=next;const event={time:new Date().toISOString(),...JSON.parse(next)};transitions.push(event);console.log(event.status+': '+event.items.map(item=>`${item.index} ${item.stage} (${item.files} saved)`).join(' | '));}
  if(state.queue.status!=='running')break;
  await new Promise(resolve=>setTimeout(resolve,2000));
}
const directory=path.join(stateRoot,'TestRuns');await fs.mkdir(directory,{recursive:true});
const reportFile=path.join(directory,startedAt.replace(/[:.]/g,'-')+'-'+kind+'.json');
const verification=[];
for(const item of state.queue.items)for(const file of item.files){
  const bytes=await fs.readFile(file.path);
  verification.push({item:item.index,name:file.name,path:file.path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const expected=kind==='four'?4:2;
const sequential=state.queue.items.every((item,index)=>index===0||Date.parse(item.startedAt)>=Date.parse(state.queue.items[index-1].finishedAt));
const checks={expectedImages:expected,savedImages:verification.length,distinctFiles:new Set(verification.map(file=>file.path)).size,distinctImageHashes:new Set(verification.map(file=>file.sha256)).size,sequential};
await fs.writeFile(reportFile,JSON.stringify({kind,startedAt,finishedAt:new Date().toISOString(),queue:state.queue,checks,verification,transitions},null,2));
if(state.queue.status!=='complete')throw new Error('Live queue stopped: '+state.queue.message+' Report saved in the private TestRuns folder.');
if(verification.length!==expected||checks.distinctFiles!==expected||!sequential)throw new Error('The live queue did not meet its file-count or sequencing checks.');
console.log('PASS '+JSON.stringify(checks));
console.log('Private test report: '+path.basename(reportFile));
