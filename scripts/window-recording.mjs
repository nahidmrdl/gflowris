// Explicitly requested developer recordings. Only two named windows, no desktop or audio.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';

export async function startWindowRecordings(folder){
  if(process.platform!=='win32')throw new Error('Window recording requires Windows and FFmpeg gfxcapture.');
  const script="$targets=@(Get-Process chrome,pythonw -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'gflowris' -or ($_.ProcessName -eq 'chrome' -and $_.MainWindowTitle -like 'Google Flow*') } | ForEach-Object { [pscustomobject]@{name=$(if($_.MainWindowTitle -eq 'gflowris'){'desktop'}else{'flow-browser'});handle=$_.MainWindowHandle.ToInt64()} }); ConvertTo-Json -InputObject $targets -Compress";
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true});
  const targets=JSON.parse(stdout);
  for(const name of ['desktop','flow-browser'])if(targets.filter(target=>target.name===name).length!==1)throw new Error('Open exactly one '+name+' window before recording.');
  await fs.mkdir(folder,{recursive:true});
  const captures=[];
  try{
    for(const target of targets){
      const output=path.join(folder,target.name+'-raw.mkv');
      const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-stats_period','0.2','-progress','pipe:1','-f','lavfi','-i','gfxcapture=hwnd='+target.handle+':capture_cursor=0:max_framerate=10','-vf','hwdownload,format=bgra,scale=1440:-2','-c:v','libx264','-preset','veryfast','-tune','zerolatency','-crf','23','-pix_fmt','yuv420p','-r','10','-map_metadata','-1',output],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      const done=new Promise(resolve=>child.once('close',resolve));let errors='';child.stderr.on('data',data=>errors+=data);
      const capture={name:target.name,output,async stop(){if(child.exitCode!==null)return;child.stdin.write('q');await Promise.race([done,new Promise(resolve=>setTimeout(resolve,3500))]);if(child.exitCode===null){child.kill();await done;}}};captures.push(capture);
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No frames from '+target.name+'. Restore its window before recording.')),15000);const finish=error=>{clearTimeout(timer);child.stdout.off('data',progress);error?reject(error):resolve();};const progress=data=>{if(/frame=\s*[1-9]/.test(String(data)))finish();};child.stdout.on('data',progress);child.once('error',error=>finish(error));child.once('close',code=>finish(new Error(target.name+' recording stopped: '+code+' '+errors)));});
      child.stdout.resume();console.log('Recording '+target.name+' window.');
      capture.started=Date.now();
    }
  }catch(error){await Promise.all(captures.map(capture=>capture.stop()));throw error;}
  return {captures,async stop(){await Promise.all(captures.map(capture=>capture.stop()));}};
}

export async function encodeWindowRecordings(recordings,assets,encode){
  for(const capture of recordings.captures){
    // Remove Chrome's tabs, address bar, and Flow's account toolbar from all published frames.
    const crop=capture.name==='flow-browser'?'crop=iw:floor(ih*0.84/2)*2:0:ceil(ih*0.16/2)*2,':'';
    const intro=Math.max(1,(recordings.timeline.generationStarted-capture.started)/1000),end=Math.max(intro+1,(recordings.timeline.generationFinished-capture.started)/1000);
    const filters='[0:v]'+crop+'split=3[a][b][c];[a]trim=end='+intro+',setpts=PTS-STARTPTS[intro];[b]trim=start='+intro+':end='+end+',setpts=(PTS-STARTPTS)/10[wait];[c]trim=start='+end+',setpts=PTS-STARTPTS[outro];[intro][wait][outro]concat=n=3:v=1:a=0,fps=10,scale=1120:-2:flags=lanczos[out]';
    await encode(['-i',capture.output,'-filter_complex',filters,'-map','[out]','-c:v','libx264','-preset','medium','-crf','23','-pix_fmt','yuv420p','-map_metadata','-1','-movflags','+faststart',path.join(assets,capture.name+'.mp4')]);
  }
  await encode(['-i',path.join(assets,'flow-browser.mp4'),'-filter_complex','[0:v]scale=840:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle','-r','10','-loop','0','-map_metadata','-1',path.join(assets,'flow-browser.gif')]);
}
