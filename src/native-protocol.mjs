import {EventEmitter} from 'node:events';
export const MAX_MESSAGE=1024*1024;
export function encodeMessage(value){
  const body=Buffer.from(JSON.stringify(value),'utf8');
  if(!body.length||body.length>MAX_MESSAGE)throw new Error('Native message exceeds the size limit.');
  const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);
}
export class MessageReader extends EventEmitter{
  buffer=Buffer.alloc(0);failed=false;
  push(chunk){
    if(this.failed)return;
    try{
      this.buffer=Buffer.concat([this.buffer,chunk]);
      while(this.buffer.length>=4){
        const size=this.buffer.readUInt32LE();
        if(!size||size>MAX_MESSAGE)throw new Error('Invalid native message length.');
        if(this.buffer.length<4+size)break;
        const value=JSON.parse(this.buffer.toString('utf8',4,4+size));this.buffer=this.buffer.subarray(4+size);
        this.emit('message',value);
      }
    }catch(error){this.failed=true;this.emit('error',error);}
  }
  end(){if(this.buffer.length&&!this.failed)this.emit('error',new Error('Incomplete native message.'));}
}
