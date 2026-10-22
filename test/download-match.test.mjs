import test from 'node:test';
import assert from 'node:assert/strict';
import {matchFlowDownload} from '../src/download-match.mjs';
const expected={title:'Lime-green arcade token icon',resolution:'2K',started:10000,page:'https://flow.google.com/project/example/edit/image',sourceOrigin:'https://images.example'};
const download={filename:'Lime-green_arcade_token_icon_2K_20261021222555.jpg',startTime:new Date(11000).toISOString(),mime:'image/jpeg',referrerOrigin:'https://flow.google.com',sourceOrigin:'https://images.example'};
test('associates the exact Flow image and size even when referrer only contains an origin',()=>{
  assert.deepEqual(matchFlowDownload(download,expected),{match:true,extension:'jpg'});
  assert.equal(matchFlowDownload({...download,referrerOrigin:null,sourceOrigin:'https://flow.google.com'},expected).match,true);
});
test('rejects unrelated filenames, wrong sizes, old files and unassociated sources',()=>{
  for(const changes of [{filename:'Other_image_2K_20261021222555.jpg'},{filename:download.filename.replace('_2K_','_1K_')},{startTime:new Date(9000).toISOString()},{referrerOrigin:null,sourceOrigin:'https://unrelated.example'}])assert.equal(matchFlowDownload({...download,...changes},expected).match,false);
});
