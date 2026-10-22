$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$stateRoot=Join-Path $projectRoot '.local\state'
try {
  $runtime=Get-Content -LiteralPath (Join-Path $stateRoot 'runtime.json') -Raw | ConvertFrom-Json
  $pythonExe=$runtime.pythonExe
  $pythonWindow=Join-Path (Split-Path -Parent $pythonExe) 'pythonw.exe'
  if(Test-Path -LiteralPath $pythonWindow){$pythonExe=$pythonWindow}
  Start-Process -FilePath $pythonExe -ArgumentList @(('"'+(Join-Path $projectRoot 'desktop.py')+'"')) -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show('Run Setup-native.cmd first to configure the desktop runtime.','gflowris') | Out-Null
}
