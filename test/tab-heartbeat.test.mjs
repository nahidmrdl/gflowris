import test from 'node:test';
import assert from 'node:assert/strict';
import {pulseFlowTab} from '../extension/tab-heartbeat.js';
test('desktop heartbeat addresses only the selected Flow tab and skips other sites',async()=>{
  const messages=[];
  const chrome={storage:{local:{get:async()=>({tabId:7})}},tabs:{get:async id=>({id,url:'https://flow.google.com/project/fixture'}),sendMessage:async(id,message)=>messages.push({id,message})}};
  await pulseFlowTab(chrome);assert.deepEqual(messages,[{id:7,message:{type:'native-tick'}}]);
  chrome.tabs.get=async()=>({url:'https://accounts.google.com/'});await pulseFlowTab(chrome);assert.equal(messages.length,1);
  chrome.storage.local.get=async()=>({});await pulseFlowTab(chrome);assert.equal(messages.length,1);
});
