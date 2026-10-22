const RELEASES='https://github.com/nahidmrdl/gflowris/releases/latest';
const RELEASE_API='https://api.github.com/repos/nahidmrdl/gflowris/releases/latest';
let cached=null,cacheUntil=0;

export async function extensionInfo(){
  if(cached&&Date.now()<cacheUntil)return cached;
  try{
    const response=await fetch(RELEASE_API,{headers:{Accept:'application/vnd.github+json','User-Agent':'gflowris'},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('Latest release unavailable.');
    const release=await response.json();
    if(release.draft||release.prerelease||!/^v\d+\.\d+\.\d+$/.test(release.tag_name))throw new Error('Invalid release.');
    const version=release.tag_name.slice(1),name=`gflowris-${version}-chrome-extension.zip`;
    const asset=release.assets?.find(value=>value.name===name&&value.state==='uploaded');
    const expected=`https://github.com/nahidmrdl/gflowris/releases/download/${release.tag_name}/${name}`;
    if(asset?.browser_download_url!==expected)throw new Error('Extension asset unavailable.');
    cached={downloadUrl:expected,version,direct:true};cacheUntil=Date.now()+300000;return cached;
  }catch{
    return {downloadUrl:RELEASES,direct:false};
  }
}
