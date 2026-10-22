#ifndef AppVersion
  #error AppVersion is required
#endif
[Setup]
AppId={{E27BD5E3-C1F1-4D8B-BA10-2EB36C42B535}
AppName=gflowris
AppVersion={#AppVersion}
AppPublisher=gflowris contributors
AppPublisherURL=https://github.com/nahidmrdl/gflowris
DefaultDirName={localappdata}\Programs\gflowris
DefaultGroupName=gflowris
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableProgramGroupPage=yes
LicenseFile={#SourcePath}\..\LICENSE
SetupIconFile={#SourcePath}\..\assets\app.ico
UninstallDisplayIcon={app}\gflowris.exe
OutputDir={#SourcePath}\..\release
OutputBaseFilename=gflowris-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Files]
Source: "{#SourcePath}\..\dist\gflowris\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".local\*"
Source: "{#SourcePath}\verify-microsoft.ps1"; Flags: dontcopy

[Icons]
Name: "{group}\gflowris"; Filename: "{app}\gflowris.exe"; AppUserModelID: "gflowris.Desktop"
Name: "{autodesktop}\gflowris"; Filename: "{app}\gflowris.exe"; Tasks: desktopicon; AppUserModelID: "gflowris.Desktop"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
Name: "models"; Description: "Set up AI models now (download separately; about 1.2 GB for both)"; Flags: unchecked

[Run]
Filename: "{app}\runtime\python\pythonw.exe"; Parameters: "-B ""{app}\scripts\launch.py"" --register-only"; Flags: runhidden waituntilterminated
Filename: "{app}\runtime\python\pythonw.exe"; Parameters: "-B ""{app}\scripts\launch.py"" --setup-models"; Tasks: models; Flags: waituntilterminated skipifsilent
Filename: "{app}\gflowris.exe"; Description: "Open gflowris"; Flags: postinstall nowait skipifsilent

[Code]
var RuntimeDownloadPage: TDownloadWizardPage;

procedure InitializeWizard;
begin
  RuntimeDownloadPage := CreateDownloadPage('Desktop runtime', 'Downloading the Microsoft WebView2 prerequisite.', nil);
  RuntimeDownloadPage.ShowBaseNameInsteadOfUrl := True;
end;

function WebViewInstalled: Boolean;
var Version, Key: String;
begin
  Key := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := (RegQueryStringValue(HKCU, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM32, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function EnsureWebView: String;
var ResultCode: Integer; Bootstrapper: String;
begin
  Result := '';
  if WebViewInstalled then Exit;
  RuntimeDownloadPage.Clear;
  RuntimeDownloadPage.Add('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'MicrosoftEdgeWebview2Setup.exe', '');
  RuntimeDownloadPage.Show;
  try
    try RuntimeDownloadPage.Download;
    except Result := 'WebView2 could not be downloaded. Check your internet connection and retry.'; Exit; end;
  finally RuntimeDownloadPage.Hide; end;
  ExtractTemporaryFile('verify-microsoft.ps1');
  Bootstrapper := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\verify-microsoft.ps1') +
    '" -InstallerPath "' + Bootstrapper + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin Result := 'Microsoft installer verification could not run.'; Exit; end;
  if ResultCode <> 0 then begin Result := 'Microsoft installer signature verification failed.'; Exit; end;
  if not Exec(Bootstrapper, '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin Result := 'WebView2 could not be installed. Retry setup.'; Exit; end;
  if not WebViewInstalled then Result := 'WebView2 installation did not complete. Restart Windows and retry.';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Installed, Minor: Cardinal; ResultCode: Integer; Bootstrapper, RuntimeKey: String;
begin
  Result := '';
  RuntimeKey := 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64';
  if not (RegQueryDWordValue(HKLM64, RuntimeKey, 'Installed', Installed) and (Installed = 1) and
    RegQueryDWordValue(HKLM64, RuntimeKey, 'Minor', Minor) and (Minor >= 40)) then
  begin
    RuntimeDownloadPage.Clear;
    RuntimeDownloadPage.Add('https://aka.ms/vc14/vc_redist.x64.exe', 'vc_redist.x64.exe', '');
    RuntimeDownloadPage.Show;
    try
      try RuntimeDownloadPage.Download;
      except Result := 'Visual C++ Runtime could not be downloaded. Check your connection and retry.'; Exit; end;
    finally RuntimeDownloadPage.Hide; end;
    ExtractTemporaryFile('verify-microsoft.ps1');
    Bootstrapper := ExpandConstant('{tmp}\vc_redist.x64.exe');
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\verify-microsoft.ps1') +
      '" -InstallerPath "' + Bootstrapper + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin Result := 'Visual C++ Runtime signature verification could not run.'; Exit; end;
    if ResultCode <> 0 then begin Result := 'Visual C++ Runtime signature verification failed.'; Exit; end;
    if not ShellExec('runas', Bootstrapper, '/install /quiet /norestart', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin Result := 'Visual C++ Runtime installation needs Windows administrator approval. Retry setup.'; Exit; end;
    if (ResultCode <> 0) and (ResultCode <> 3010) then
    begin Result := 'Visual C++ Runtime installation did not complete. Retry setup.'; Exit; end;
    if ResultCode = 3010 then NeedsRestart := True;
  end;
  Result := EnsureWebView;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Manifest: String;
begin
  if CurUninstallStep = usUninstall then
    if RegQueryStringValue(HKCU, 'Software\Google\Chrome\NativeMessagingHosts\com.automationflowgen.bridge', '', Manifest) then
      if CompareText(Manifest, ExpandConstant('{app}\.local\native-host\com.automationflowgen.bridge.json')) = 0 then
        RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Google\Chrome\NativeMessagingHosts\com.automationflowgen.bridge');
end;
