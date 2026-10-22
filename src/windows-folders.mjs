import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const preamble="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); ";

function absoluteFolder(folder){
  if(typeof folder!=='string'||!folder.trim()||folder.length>4096||/[\x00-\x1f]/.test(folder)||!path.isAbsolute(folder))throw new Error('Choose an absolute folder path.');
  return path.resolve(folder);
}

async function shell(script,folder,timeout){
  if(process.platform!=='win32')throw new Error('Folder actions require the Windows desktop app.');
  const executable=path.join(process.env.SystemRoot||process.env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  // The path is data, never interpolated into PowerShell source. Hide the
  // launcher console only; the shell operation explicitly shows its own UI.
  const {stdout}=await run(executable,['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(preamble+script,'utf16le').toString('base64')],{
    windowsHide:true,encoding:'utf8',timeout,maxBuffer:65536,env:{...process.env,GFLOWRIS_FOLDER:folder}
  });
  return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());
}

export async function openWindowsFolder(value){
  const folder=absoluteFolder(value);
  try{
    await fs.mkdir(folder,{recursive:true});
    return await shell("$start=New-Object System.Diagnostics.ProcessStartInfo; $start.FileName=$env:GFLOWRIS_FOLDER; $start.UseShellExecute=$true; $start.Verb='explore'; $start.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Normal; [System.Diagnostics.Process]::Start($start) | Out-Null; @{ok=$true} | ConvertTo-Json -Compress",folder,15000);
  }catch{throw new Error('Windows could not open this folder. Check access or choose another folder.');}
}

export async function chooseWindowsFolder(initialFolder=''){
  try{
    const result=await shell("Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description='Choose where gflowris images are saved'; if([IO.Directory]::Exists($env:GFLOWRIS_FOLDER)){$dialog.SelectedPath=$env:GFLOWRIS_FOLDER}; try { if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){@{ok=$true;folder=$dialog.SelectedPath;cancelled=$false}|ConvertTo-Json -Compress} else {@{ok=$true;folder=$null;cancelled=$true}|ConvertTo-Json -Compress} } finally {$dialog.Dispose()}",initialFolder,0);
    if(result.folder)result.folder=absoluteFolder(result.folder);
    return result;
  }catch{throw new Error('The folder picker could not open. Reopen the desktop app and try again.');}
}
