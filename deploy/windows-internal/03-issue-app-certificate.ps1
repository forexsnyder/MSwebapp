# Run from an elevated PowerShell prompt on the CA/domain controller.

$DnsName = "app.msiwebapp.com"
$OutputDir = "C:\MSwebapp-Certs"
$PfxPath = Join-Path $OutputDir "$DnsName.pfx"
$InfPath = Join-Path $OutputDir "$DnsName.inf"
$ReqPath = Join-Path $OutputDir "$DnsName.req"
$CerPath = Join-Path $OutputDir "$DnsName.cer"

$PfxPassword = Read-Host `
  -Prompt "Temporary PFX export password" `
  -AsSecureString

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

@"
[Version]
Signature=`"`$Windows NT`$`"

[NewRequest]
Subject = "CN=$DnsName"
KeySpec = 1
KeyLength = 2048
Exportable = TRUE
MachineKeySet = TRUE
SMIME = FALSE
PrivateKeyArchive = FALSE
UserProtected = FALSE
UseExistingKeySet = FALSE
ProviderName = "Microsoft RSA SChannel Cryptographic Provider"
ProviderType = 12
RequestType = PKCS10
KeyUsage = 0xa0

[Extensions]
2.5.29.17 = "{text}"
_continue_ = "dns=$DnsName&"

[RequestAttributes]
CertificateTemplate = WebServer
"@ | Set-Content -Path $InfPath -Encoding ascii

certreq.exe -new $InfPath $ReqPath
certreq.exe -submit -attrib "CertificateTemplate:WebServer" $ReqPath $CerPath
certreq.exe -accept $CerPath

$Certificate = Get-ChildItem Cert:\LocalMachine\My |
  Where-Object { $_.Subject -eq "CN=$DnsName" } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $Certificate) {
  throw "Certificate was issued, but CN=$DnsName was not found in LocalMachine\My."
}

Export-PfxCertificate `
  -Cert $Certificate `
  -FilePath $PfxPath `
  -Password $PfxPassword `
  -Force

Write-Host "PFX exported to $PfxPath"
