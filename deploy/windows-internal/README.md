# Internal Windows DC + CA Lab

These scripts build a reproducible Windows Server lab for the internal
MSwebapp deployment:

- Active Directory domain controller
- Domain DNS for `msiwebapp.com`
- Enterprise root CA
- Internal DNS record for `app.msiwebapp.com`
- CA-issued certificate export for the Ubuntu Nginx reverse proxy

Run these scripts from an elevated PowerShell prompt on a fresh Windows Server
VM. Use a static IP before promoting the server to a domain controller.

## Target Lab Values

Change these values if your internal network is different:

```text
AD domain: corp.msiwebapp.com
NetBIOS: MSIWEBAPP
App DNS zone: msiwebapp.com
App hostname: app.msiwebapp.com
Ubuntu app IP: 10.0.0.25
```

## 1) Promote The Server To A DC

Edit the variables at the top of `01-promote-domain-controller.ps1`, then run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\01-promote-domain-controller.ps1
```

The server reboots after domain promotion.

## 2) Install The Enterprise CA And DNS Records

Sign in after the reboot with the domain administrator account, edit the app IP
in `02-install-ca-and-dns.ps1`, then run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\02-install-ca-and-dns.ps1
```

Verify DNS:

```powershell
Resolve-DnsName app.msiwebapp.com
```

On the live Windows Server 2025 build, AD CS succeeded when Windows selected the
default crypto provider. If a command using
`RSA#Microsoft Software Key Storage Provider` fails with
`ERROR_INVALID_PARAMETER`, rerun CA setup without `-CryptoProviderName`.

## 3) Issue The App Certificate

Run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\03-issue-app-certificate.ps1
```

The script writes a PFX file to:

```text
C:\MSwebapp-Certs\app.msiwebapp.com.pfx
```

Copy the PFX to the Ubuntu server, then convert it for Nginx:

```bash
sudo apt install -y openssl
sudo mkdir -p /etc/ssl/mswebapp
sudo openssl pkcs12 -in app.msiwebapp.com.pfx -clcerts -nokeys -out /etc/ssl/mswebapp/app.msiwebapp.com.crt
sudo openssl pkcs12 -in app.msiwebapp.com.pfx -nocerts -nodes -out /etc/ssl/mswebapp/app.msiwebapp.com.key
sudo chown -R root:root /etc/ssl/mswebapp
sudo chmod 755 /etc/ssl/mswebapp
sudo chmod 644 /etc/ssl/mswebapp/app.msiwebapp.com.crt
sudo chmod 600 /etc/ssl/mswebapp/app.msiwebapp.com.key
```

After installing the certificate, install the app's Nginx config from
`deploy/nginx-mswebapp.conf`.

## Azure SSO

This internal deployment still uses Microsoft Entra SSO. Keep this SPA redirect
URI in the Entra app registration:

```text
https://app.msiwebapp.com/
```

Azure does not need to resolve the internal hostname. The user's browser must
resolve and reach it through internal DNS, LAN, or VPN after authentication.
