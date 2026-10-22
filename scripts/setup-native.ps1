param([string]$ExtensionId, [string]$Python, [string]$CutrisRoot)
$ErrorActionPreference='Stop'
function Write-JsonFile($Path,$Value){[IO.File]::WriteAllText($Path,($Value | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))}
$projectRoot=Split-Path -Parent $PSScriptRoot
$legacyState=Join-Path $env:LOCALAPPDATA 'AutomationFlowGen'
$privateRoot=Join-Path $projectRoot '.local'
$stateRoot=Join-Path $privateRoot 'state'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
foreach($name in @('session.json','settings.json','capabilities.json','last-queue.json','control.json','runtime.json')){
  $old=Join-Path $legacyState $name; $target=Join-Path $stateRoot $name
  if((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $target)){Copy-Item -LiteralPath $old -Destination $target}
}
if(-not $ExtensionId){
  $sessionPath=Join-Path $stateRoot 'session.json'
  if(Test-Path -LiteralPath $sessionPath){
    $saved=Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
    if($saved.extensionOrigin -match '^chrome-extension://([a-p]{32})$'){$ExtensionId=$Matches[1]}
  }
}
if($ExtensionId -notmatch '^[a-p]{32}$'){throw 'Pass -ExtensionId with the ID shown on chrome://extensions for gflowris bridge.'}
$runtimePath=Join-Path $stateRoot 'runtime.json'
$existing=$null
if(Test-Path -LiteralPath $runtimePath){$existing=Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json}
if(-not $Python){$Python=$existing.pythonExe}
if(-not $CutrisRoot){$CutrisRoot=$existing.cutrisRoot}
if(-not $Python){throw 'Pass -Python with a Python runtime containing cutris and pywebview.'}
if(-not (Test-Path -LiteralPath $Python -PathType Leaf)){throw 'Python runtime not found.'}
if($CutrisRoot -and -not (Test-Path -LiteralPath (Join-Path $CutrisRoot 'cutris'))){throw 'Cutris source package not found.'}
$nodeExe=(Get-Command node -ErrorAction Stop).Source
$config=@{nodeExe=$nodeExe;pythonExe=[IO.Path]::GetFullPath($Python);projectRoot=$projectRoot;cutrisRoot=$CutrisRoot;stateRoot=$stateRoot}
Write-JsonFile $runtimePath $config
Write-JsonFile (Join-Path $privateRoot 'runtime.json') $config
$nativeFolder=Join-Path $privateRoot 'native-host'
New-Item -ItemType Directory -Force -Path $nativeFolder | Out-Null
Write-JsonFile (Join-Path $nativeFolder 'runtime.json') $config
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source=Join-Path $projectRoot 'native\Launcher.cs'
$sourceHash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.Substring(0,12).ToLowerInvariant()
$launcher=Join-Path $nativeFolder ('FlowNativeHost-'+$sourceHash+'.exe')
if(-not (Test-Path -LiteralPath $launcher)){
  & $compiler /nologo /target:exe /optimize+ /reference:System.Web.Extensions.dll "/out:$launcher" $source
  if($LASTEXITCODE -ne 0){throw 'Native host launcher compilation failed.'}
}
$origin='chrome-extension://'+$ExtensionId+'/'
Write-JsonFile (Join-Path $stateRoot 'native-registration.json') @{origin=$origin}
$hostManifest=Join-Path $nativeFolder 'com.automationflowgen.bridge.json'
Write-JsonFile $hostManifest @{name='com.automationflowgen.bridge';description='gflowris desktop connection';path=$launcher;type='stdio';allowed_origins=@($origin)}
$registry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.automationflowgen.bridge'
New-Item -Path $registry -Force | Out-Null
Set-Item -LiteralPath $registry -Value $hostManifest
$startCommand='"'+(Join-Path $projectRoot 'Start.cmd')+'"'
$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'gflowris.lnk'))
$shortcut.TargetPath=Join-Path $projectRoot 'Start.cmd';$shortcut.WorkingDirectory=$projectRoot;$shortcut.IconLocation=(Join-Path $projectRoot 'assets\app.ico');$shortcut.WindowStyle=7;$shortcut.Save()
Write-Host 'Native connection installed for this Chrome extension. Open Start.cmd to use the desktop app.'
