const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function matchFlowDownload(item,expected){
  if(!expected?.title||!expected.page)return {match:false,reason:'No image identity was registered.'};
  const filename=String(item.filename||'').split(/[\\/]/).pop();
  const timestamped=filename.match(/^(.*)_(1K|2K|4K)_(\d{14})(?: \(\d+\))?\.(png|jpe?g|webp|avif)$/i);
  const identified=filename.match(/^(.*)_([0-9a-f]{8})_(1K|2K|4K)(?: \(\d+\))?\.(png|jpe?g|webp|avif)$/i);
  const parts=timestamped||identified;
  const titleWords=String(expected.title).trim().split(/\s+/),titleNames=[normalize(expected.title)];
  if(titleWords.length>5)titleNames.push(normalize(titleWords.slice(0,5).join(' ')));
  if(!parts||!titleNames.includes(normalize(parts[1])))return {match:false,reason:'Filename does not identify the selected Flow image.'};
  if(!timestamped){
    const mediaId=String(expected.mediaId||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mediaId)||parts[2].toLowerCase()!==mediaId.slice(0,8).toLowerCase())return {match:false,reason:'Download image ID does not match the selected Flow image.'};
  }
  if((timestamped?parts[2]:parts[3]).toUpperCase()!==expected.resolution)return {match:false,reason:'Download resolution does not match the selected size.'};
  const started=Date.parse(item.startTime);
  if(!Number.isFinite(started)||started<expected.started||started-expected.started>15*60*1000)return {match:false,reason:'Download is outside this image’s active time window.'};
  const pageOrigin=new URL(expected.page).origin;
  const fromFlow=item.referrerOrigin===pageOrigin||item.sourceOrigin===pageOrigin;
  const fromImageSource=expected.sourceOrigin&&expected.sourceOrigin!=='null'&&item.sourceOrigin===expected.sourceOrigin;
  if(!fromFlow&&!fromImageSource)return {match:false,reason:'Download source could not be associated with Flow.'};
  if(item.mime&&!item.mime.startsWith('image/')&&item.mime!=='application/octet-stream')return {match:false,reason:'Download is not an image.'};
  return {match:true,extension:parts[4].toLowerCase()==='jpeg'?'jpg':parts[4].toLowerCase()};
}
