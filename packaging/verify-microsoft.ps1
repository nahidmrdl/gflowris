param([Parameter(Mandatory=$true)][string]$InstallerPath)
$ErrorActionPreference='Stop'
try {
    $signature=Get-AuthenticodeSignature -LiteralPath $InstallerPath
    if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)'){exit 1}
    exit 0
} catch {exit 1}
