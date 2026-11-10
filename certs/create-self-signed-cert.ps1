# create-self-signed-cert.ps1
#
# Creates a self-signed HTTPS certificate (.pfx) for the dev server,
# src/serve.mjs, when you want the simulator and the sample agent on HTTPS.
#
# Output: certs/lab-agent-sdk.pfx (alongside this script)
#
# Then run: node src/serve.mjs --pfx certs/lab-agent-sdk.pfx --passphrase <password>

param(
  [string]$Subject  = "CN=lab-agent-sdk.localhost",
  [string[]]$DnsNames = @("localhost", "lab-agent-sdk.localhost"),
  [string]$OutDir   = $PSScriptRoot,
  [string]$Password = "changeit",
  [int]$ValidDays   = 365
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$pfxPath = Join-Path $OutDir "lab-agent-sdk.pfx"

Write-Host "Creating self-signed cert..." -ForegroundColor Cyan
$cert = New-SelfSignedCertificate `
  -Subject $Subject `
  -DnsName $DnsNames `
  -KeyAlgorithm RSA -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddDays($ValidDays) `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyExportPolicy Exportable `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1")  # Server Authentication EKU

$pwd = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pwd | Out-Null

Write-Host "Wrote $pfxPath" -ForegroundColor Green
Write-Host "Password: $Password" -ForegroundColor Yellow
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. node src/serve.mjs --pfx `"$pfxPath`" --passphrase $Password"
Write-Host "  2. (Optional) Trust the cert so browsers stop warning:"
Write-Host "     Import-Certificate -FilePath `"$pfxPath`" -CertStoreLocation Cert:\CurrentUser\Root"
