import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageReader,encodeMessage,MAX_MESSAGE} from '../src/native-protocol.mjs';

test('native framing handles fragmented headers, UTF-8, and adjacent messages',()=>{
  const reader=new MessageReader(),received=[];reader.on('message',value=>received.push(value));reader.on('error',error=>assert.fail(error));
  const bytes=Buffer.concat([encodeMessage({id:'1',text:'Café ☁'}),encodeMessage({id:'2',ok:true})]);
  for(let index=0;index<bytes.length;index+=3)reader.push(bytes.subarray(index,index+3));reader.end();
  assert.deepEqual(received,[{id:'1',text:'Café ☁'},{id:'2',ok:true}]);
});
test('native framing rejects oversized, invalid, and truncated messages',()=>{
  for(const bytes of [Buffer.from([255,255,255,255]),Buffer.from([1,0,0,0,123]),Buffer.from([5,0,0,0,123])]){
    const reader=new MessageReader();let error;reader.on('error',value=>error=value);reader.push(bytes);reader.end();assert(error);
  }
  assert.throws(()=>encodeMessage({text:'x'.repeat(MAX_MESSAGE)}),/size limit/);
});
