param([Parameter(Mandatory = $true)][string]$InstallRoot)

# Run only for the selected installation. Never stop Node or Python by name.
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\', '/')
if (-not [IO.Directory]::Exists($appRoot) -or $appRoot -eq [IO.Path]::GetPathRoot($appRoot).TrimEnd('\')) { exit 22 }
$nodePath = Join-Path $appRoot 'runtime\node\node.exe'
$pythonPaths = @((Join-Path $appRoot 'runtime\python\python.exe'), (Join-Path $appRoot 'runtime\python\pythonw.exe'), (Join-Path $appRoot 'gflowris.exe'))
$hostPath = Join-Path $appRoot '.local\native-host\gflowris-host.exe'
$serverScript = Join-Path $appRoot 'src\server.mjs'
$nativeScript = Join-Path $appRoot 'src\native-host.mjs'
$registrationKey = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.automationflowgen.bridge'
$manifestPath = Join-Path $appRoot '.local\native-host\com.automationflowgen.bridge.json'

function Get-AppProcesses {
    foreach ($candidate in Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'python.exe' OR Name = 'pythonw.exe' OR Name = 'gflowris.exe' OR Name = 'gflowris-host.exe'") {
        if ($candidate.ExecutablePath -ieq $nodePath -or $candidate.ExecutablePath -ieq $hostPath -or $pythonPaths -icontains $candidate.ExecutablePath) { $candidate }
    }
}
function Get-Role($candidate) {
    if ($candidate.ExecutablePath -ieq $hostPath) { return 'host' }
    if ($candidate.ExecutablePath -ieq $nodePath) {
        if ($candidate.CommandLine -match ('(?i)(?:^|\s)"?' + [regex]::Escape($serverScript) + '(?:"|\s|$)')) { return 'server' }
        if ($candidate.CommandLine -match ('(?i)(?:^|\s)"?' + [regex]::Escape($nativeScript) + '(?:"|\s|$)')) { return 'host' }
    }
    return 'app'
}
function Read-Control($servers) {
    $descriptor = Get-Content -LiteralPath (Join-Path $appRoot '.local\state\control.json') -Raw | ConvertFrom-Json
    if ($descriptor.origin -cne 'http://127.0.0.1:4317' -or $descriptor.token -cnotmatch '^[0-9a-f]{64}$' -or @($servers.ProcessId) -notcontains $descriptor.pid) { throw 'Invalid runtime descriptor.' }
    return $descriptor
}
function Stop-AppProcess($candidate) {
    # Recheck the executable, command line, and creation time before using its PID.
    $current = @(Get-AppProcesses | Where-Object { $_.ProcessId -eq $candidate.ProcessId -and $_.CreationDate -eq $candidate.CreationDate -and $_.CommandLine -eq $candidate.CommandLine })
    if ($current.Count -eq 1) { Stop-Process -Id $current[0].ProcessId -Force -ErrorAction Stop }
}

try {
    $processes = @(Get-AppProcesses)
    if (@($processes | Where-Object { (Get-Role $_) -eq 'app' }).Count) { exit 20 }
    $servers = @($processes | Where-Object { (Get-Role $_) -eq 'server' })
    $control = $null
    if ($servers.Count) {
        try {
            $control = Read-Control $servers
            $headers = @{ Authorization = 'Bearer ' + $control.token }
            $state = Invoke-RestMethod -Uri ($control.origin + '/api/state') -Headers $headers -TimeoutSec 3
            if ($state.desktopOpen -or $state.preparing -or $state.postProcessing -or $state.queue.status -eq 'running' -or @($state.downloadStatus).Count) { exit 21 }
        } catch { exit 23 }
    }

    # Also pauses old releases whose native launcher predates the maintenance mutex.
    # Setup restores this registration if it is cancelled; uninstall removes only this app's registration.
    if (Test-Path -LiteralPath $registrationKey) {
        $registered = (Get-Item -LiteralPath $registrationKey).GetValue('')
        if ($registered -ieq $manifestPath) { Remove-Item -LiteralPath $registrationKey -Force }
    }
    foreach ($candidate in $processes | Where-Object { (Get-Role $_) -eq 'host' }) { Stop-AppProcess $candidate }
    if ($control) {
        try {
            Invoke-RestMethod -Method Post -Uri ($control.origin + '/api/shutdown') -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null
            # Allow queued state writes and the normal server exit to finish.
            for ($attempt = 0; $attempt -lt 25; $attempt++) {
                if (-not @(Get-AppProcesses | Where-Object { (Get-Role $_) -eq 'server' }).Count) { break }
                Start-Sleep -Milliseconds 100
            }
        } catch {
            # Older releases have no shutdown endpoint. Only use the scoped fallback
            # after their authenticated state above confirmed there is no active work.
            if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 404) { exit 23 }
            foreach ($candidate in $servers) { Stop-AppProcess $candidate }
        }
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not @(Get-AppProcesses).Count) { exit 0 }
        Start-Sleep -Milliseconds 100
    }
    if (@(Get-AppProcesses).Count) { exit 22 }
    exit 0
} catch { exit 22 }
