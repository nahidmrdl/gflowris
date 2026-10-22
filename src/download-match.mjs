const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function matchFlowDownload(item,expected){
  if(!expected?.title||!expected.page)return {match:false,reason:'No image identity was registered.'};
  const filename=String(item.filename||'').split(/[\\/]/).pop();
  const parts=filename.match(/^(.*)_(1K|2K|4K)_(\d{14})(?: \(\d+\))?\.(png|jpe?g|webp|avif)$/i);
  if(!parts||normalize(parts[1])!==normalize(expected.title))return {match:false,reason:'Filename does not identify the selected Flow image.'};
  if(parts[2].toUpperCase()!==expected.resolution)return {match:false,reason:'Download resolution does not match the selected size.'};
  const started=Date.parse(item.startTime);
  if(!Number.isFinite(started)||started<expected.started||started-expected.started>15*60*1000)return {match:false,reason:'Download is outside this image’s active time window.'};
  const pageOrigin=new URL(expected.page).origin;
  const fromFlow=item.referrerOrigin===pageOrigin||item.sourceOrigin===pageOrigin;
  const fromImageSource=expected.sourceOrigin&&expected.sourceOrigin!=='null'&&item.sourceOrigin===expected.sourceOrigin;
  if(!fromFlow&&!fromImageSource)return {match:false,reason:'Download source could not be associated with Flow.'};
  if(item.mime&&!item.mime.startsWith('image/')&&item.mime!=='application/octet-stream')return {match:false,reason:'Download is not an image.'};
  return {match:true,extension:parts[4].toLowerCase()==='jpeg'?'jpg':parts[4].toLowerCase()};
}
