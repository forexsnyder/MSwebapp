# Run from an elevated PowerShell prompt after the domain controller reboot.

$AppZone = "msiwebapp.com"
$AppRecordName = "app"
$AppServerIp = "10.0.0.25"
$CaCommonName = "MSIWEBAPP Internal Root CA"

Install-WindowsFeature `
  -Name ADCS-Cert-Authority,RSAT-ADCS,DNS `
  -IncludeManagementTools

Install-AdcsCertificationAuthority `
  -CAType EnterpriseRootCA `
  -CACommonName $CaCommonName `
  -KeyLength 4096 `
  -HashAlgorithmName SHA256 `
  -CryptoProviderName "RSA#Microsoft Software Key Storage Provider" `
  -ValidityPeriod Years `
  -ValidityPeriodUnits 10 `
  -Force

if (-not (Get-DnsServerZone -Name $AppZone -ErrorAction SilentlyContinue)) {
  Add-DnsServerPrimaryZone `
    -Name $AppZone `
    -ReplicationScope Domain
}

$ExistingRecord = Get-DnsServerResourceRecord `
  -ZoneName $AppZone `
  -Name $AppRecordName `
  -RRType A `
  -ErrorAction SilentlyContinue

if ($ExistingRecord) {
  $NewRecord = $ExistingRecord.Clone()
  $NewRecord.RecordData.IPv4Address = [System.Net.IPAddress]::Parse($AppServerIp)
  Set-DnsServerResourceRecord `
    -ZoneName $AppZone `
    -OldInputObject $ExistingRecord `
    -NewInputObject $NewRecord
} else {
  Add-DnsServerResourceRecordA `
    -ZoneName $AppZone `
    -Name $AppRecordName `
    -IPv4Address $AppServerIp
}

Resolve-DnsName "$AppRecordName.$AppZone"
