# create-self-signed-cert.ps1
#
# Creates a self-signed HTTPS certificate (.pfx) for the sample app.
# Use this when the ASP.NET Core dev cert is not an option -- for example
# when running on a non-developer machine.
#
# Output: certs/ai-mentor-integration-sandbox.pfx (alongside this script)
#
# After running, uncomment the "Kestrel" block in src/appsettings.json and
# set the password below (or pass a different one via -Password). Then run
# the app as usual -- Kestrel will pick up the .pfx instead of the dev cert.

param(
  [string]$Subject  = "CN=ai-mentor-integration-sandbox.localhost",
  [string[]]$DnsNames = @("localhost", "ai-mentor-integration-sandbox.localhost"),
  [string]$OutDir   = $PSScriptRoot,
  [string]$Password = "changeit",
  [int]$ValidDays   = 365
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$pfxPath = Join-Path $OutDir "ai-mentor-integration-sandbox.pfx"

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
Write-Host "  1. Uncomment the Kestrel block in src/appsettings.json"
Write-Host "  2. Verify Certificate.Path and Certificate.Password match this output"
Write-Host "  3. (Optional) Trust the cert so browsers stop warning:"
Write-Host "     Import-Certificate -FilePath `"$pfxPath`" -CertStoreLocation Cert:\CurrentUser\Root"
