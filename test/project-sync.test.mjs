import test from 'node:test';
import assert from 'node:assert/strict';
import {syncSavedEdits} from '../src/project-sync.mjs';

test('saved edits sync once, keep earlier PNGs, and ignore unchanged revisions',async()=>{
 const original={projectId:'a'.repeat(32),revision:0,path:'first.png'};
 const file={path:'original.jpg',cutout:original},queue={items:[{id:'item',files:[file]}]};let revision=0,exports=0;
 const client={projectState:async()=>({revision}),refresh:async old=>({...old,revision,path:'edited-'+(++exports)+'.png'})};
 assert.deepEqual(await syncSavedEdits(queue,client),[]);
 revision=1;assert.equal((await syncSavedEdits(queue,client)).length,1);assert.equal(file.cutout.path,'edited-1.png');assert.equal(file.path,'original.jpg');assert.deepEqual(file.cutoutHistory,[original]);
 await syncSavedEdits(queue,client);assert.equal(exports,1);
 revision=2;await syncSavedEdits(queue,client);assert.equal(exports,2);assert.equal(file.cutoutHistory.length,2);
 client.projectState=async()=>{throw new Error('temporarily unavailable');};await syncSavedEdits(queue,client);assert.equal(file.cutout.revision,2);assert.match(file.syncError,/not synced/);
});
