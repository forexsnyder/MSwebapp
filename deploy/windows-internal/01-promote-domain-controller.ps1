# Run from an elevated PowerShell prompt on a fresh Windows Server VM.
# The server must already have a static IP address.

$DomainName = "corp.msiwebapp.com"
$NetbiosName = "MSIWEBAPP"

$SafeModeAdministratorPassword = Read-Host `
  -Prompt "Directory Services Restore Mode password" `
  -AsSecureString

Install-WindowsFeature `
  -Name AD-Domain-Services,DNS `
  -IncludeManagementTools

Import-Module ADDSDeployment

Install-ADDSForest `
  -DomainName $DomainName `
  -DomainNetbiosName $NetbiosName `
  -InstallDns `
  -CreateDnsDelegation:$false `
  -SafeModeAdministratorPassword $SafeModeAdministratorPassword `
  -Force
