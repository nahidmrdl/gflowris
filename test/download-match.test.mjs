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

test('Flow filenames shortened to the first five title words still identify the armed image',()=>{
  const herb={...expected,title:'Healing herb bundle tied with twine'};
  const file={...download,filename:'Healing_herb_bundle_tied_with_2K_20261023231251.jpg'};
  assert.equal(matchFlowDownload(file,herb).match,true);
  assert.equal(matchFlowDownload({...file,filename:file.filename.replace('with','without')},herb).match,false);
  assert.equal(matchFlowDownload({...file,filename:file.filename.replace('_2K_','_1K_')},herb).match,false);
  assert.equal(matchFlowDownload({...file,startTime:new Date(9000).toISOString()},herb).match,false);
  assert.equal(matchFlowDownload({...file,referrerOrigin:null,sourceOrigin:'https://unrelated.example'},herb).match,false);
  assert.equal(matchFlowDownload({...download,filename:'Dark_brown_ore_rock_with_2K_20261023230225.jpg'},{...expected,title:'Dark brown ore rock with golden nuggets'}).match,true);
});

test('image-ID filenames and Chrome duplicate suffixes match the selected generated asset',()=>{
  const image={...expected,mediaId:'ab12cd34-1234-4234-8234-123456789abc'};
  for(const filename of ['Lime-green_arcade_token_icon_ab12cd34_2K.jpg','Lime-green_arcade_token_icon_ab12cd34_2K (1).jpg','Lime-green_arcade_token_icon_AB12CD34_2k.JPEG']){
    assert.deepEqual(matchFlowDownload({...download,filename},image),{match:true,extension:'jpg'});
  }
  const shortened={...image,title:'Lime green arcade token icon with a star'};
  assert.equal(matchFlowDownload({...download,filename:'Lime_green_arcade_token_icon_ab12cd34_2K.jpg'},shortened).match,true);
});

test('image-ID filenames retain title, asset, resolution, source, time, and MIME safeguards',()=>{
  const image={...expected,mediaId:'ab12cd34-1234-4234-8234-123456789abc'};
  const file={...download,filename:'Lime-green_arcade_token_icon_ab12cd34_2K.jpg'};
  for(const change of [
    {filename:file.filename.replace('ab12cd34','12345678')},
    {filename:file.filename.replace('Lime-green','Other')},
    {filename:file.filename.replace('_2K','_1K')},
    {startTime:new Date(9000).toISOString()},
    {startTime:new Date(expected.started+15*60*1000+1).toISOString()},
    {referrerOrigin:null,sourceOrigin:'https://unrelated.example'},
    {mime:'text/plain'},
  ])assert.equal(matchFlowDownload({...file,...change},image).match,false);
  for(const mediaId of [undefined,'not-an-asset-id','12345678-1234-4234-8234-123456789abc'])assert.equal(matchFlowDownload(file,{...image,mediaId}).match,false);
});
