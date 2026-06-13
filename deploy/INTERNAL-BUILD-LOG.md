# MSwebapp Internal Build Log

Date: 2026-06-09

This records the internal-only build work performed for MSwebapp. The goal was
to remove the public Cloudflare path and prepare the app for private AD DNS,
internal CA TLS, Nginx, and Microsoft Entra SSO.

## Production Direction

The internal production URL remains:

```text
https://app.msiwebapp.com/
```

That hostname is intentionally unchanged because the Entra app registration and
React production build already use it as the redirect URI. Internalization is
handled by DNS and certificate trust:

- Domain controller DNS resolves `app.msiwebapp.com` to the Ubuntu server's
  private IP.
- Nginx on Ubuntu terminates HTTPS for `app.msiwebapp.com`.
- The certificate is issued by the internal CA.
- Client devices trust the internal CA root.

Azure does not need to resolve the private app hostname. The user's browser
must resolve and reach it after Microsoft redirects back from sign-in.

## Repository Changes

The repo was updated and pushed to GitHub on `master`.

Commit:

```text
839cf7c Add internal DC and CA deployment path
```

Changes made:

- Removed the Cloudflare Tunnel production config:
  - `deploy/cloudflared-mswebapp.yml`
- Added Nginx reverse proxy config:
  - `deploy/nginx-mswebapp.conf`
- Reworked the Ubuntu production runbook for internal DNS, internal CA, and
  Nginx:
  - `deploy/README-ubuntu-systemd.md`
- Updated Android/Azure access notes so they no longer describe Cloudflare as
  the production route:
  - `deploy/README-azure-android-access.md`
- Removed `.trycloudflare.com` from Vite dev `allowedHosts`:
  - `client/vite.config.ts`
- Added a Windows Server lab kit for a reproducible domain controller,
  enterprise CA, DNS record, and app certificate:
  - `deploy/windows-internal/README.md`
  - `deploy/windows-internal/01-promote-domain-controller.ps1`
  - `deploy/windows-internal/02-install-ca-and-dns.ps1`
  - `deploy/windows-internal/03-issue-app-certificate.ps1`

The standalone setup note was also updated locally outside the repo:

```text
/Users/jeffsnyder/Downloads/MSwebapp_Ubuntu_Production_Setup.txt
```

## Azure State

The Entra app registration already has this SPA redirect URI:

```text
https://app.msiwebapp.com
```

The React production env file uses:

```text
VITE_AZURE_CLIENT_ID=ddacbbb5-d415-458d-8132-761d07714425
VITE_AZURE_TENANT_ID=80ed6e92-fab4-44fb-93a5-f7da73b67333
VITE_AZURE_REDIRECT_URI=https://app.msiwebapp.com
```

No Azure change was required because the internal build kept the same app
hostname and redirect URI. If the hostname changes later, both Azure and
`client/.env.production` must be updated together.

## PowerShell Installation And Script Check

PowerShell was installed on the Mac with Homebrew:

```bash
brew install powershell
```

Installed version:

```text
pwsh 7.6.2
```

The Windows Server scripts were parser-checked with PowerShell:

```text
OK 01-promote-domain-controller.ps1
OK 02-install-ca-and-dns.ps1
OK 03-issue-app-certificate.ps1
```

The scripts were not executed on macOS because they use Windows Server cmdlets.

## Ubuntu VM Server Build

Existing Lima VM:

```text
mswebapp-ubuntu
```

Observed VM address:

```text
192.168.5.15
```

The Lima lab forwards port `3001` to the Mac host. Direct access to
`192.168.5.15` from macOS timed out, which is a Lima networking limitation in
this lab. A real Ubuntu server should use a static LAN IP and the DC DNS record
should point to that address.

Installed in the Ubuntu VM:

```bash
sudo apt-get update
sudo apt-get install -y nginx openssl
```

The app service was already present and active:

```text
mswebapp.service
```

Cloudflare was disabled and inactive:

```text
cloudflared: inactive
```

Because the VM could not authenticate to GitHub over HTTPS, the current built
client files and Nginx config were copied from the Mac into the VM:

```bash
limactl copy --recursive client/dist mswebapp-ubuntu:/tmp/mswebapp-client-dist
limactl copy deploy/nginx-mswebapp.conf mswebapp-ubuntu:/tmp/nginx-mswebapp.conf
```

Then inside the VM:

```bash
sudo rm -rf /opt/mswebapp/client/dist
sudo mkdir -p /opt/mswebapp/client
sudo cp -a /tmp/mswebapp-client-dist /opt/mswebapp/client/dist
sudo chown -R jeff:jeff /opt/mswebapp/client/dist

sudo mkdir -p /opt/mswebapp/deploy
sudo cp /tmp/nginx-mswebapp.conf /opt/mswebapp/deploy/nginx-mswebapp.conf
sudo chown jeff:jeff /opt/mswebapp/deploy/nginx-mswebapp.conf
sudo systemctl restart mswebapp
```

For the lab only, a temporary 30-day self-signed certificate was created:

```bash
sudo mkdir -p /etc/ssl/mswebapp
sudo openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
  -keyout /etc/ssl/mswebapp/app.msiwebapp.com.key \
  -out /etc/ssl/mswebapp/app.msiwebapp.com.crt \
  -subj "/CN=app.msiwebapp.com" \
  -addext "subjectAltName=DNS:app.msiwebapp.com"
sudo chown -R root:root /etc/ssl/mswebapp
sudo chmod 755 /etc/ssl/mswebapp
sudo chmod 644 /etc/ssl/mswebapp/app.msiwebapp.com.crt
sudo chmod 600 /etc/ssl/mswebapp/app.msiwebapp.com.key
```

The Nginx config was installed and enabled:

```bash
sudo cp /opt/mswebapp/deploy/nginx-mswebapp.conf /etc/nginx/sites-available/mswebapp
sudo ln -sfn /etc/nginx/sites-available/mswebapp /etc/nginx/sites-enabled/mswebapp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

For VM-local testing only, the Ubuntu VM hosts file maps the internal hostname
to loopback:

```text
127.0.0.1 app.msiwebapp.com
```

In real production this should come from the domain controller DNS record, not
from `/etc/hosts`.

## Current Verified Server State

Live checks from the VM:

```text
mswebapp: active
nginx: active
cloudflared: inactive
```

Nginx version:

```text
nginx/1.24.0 (Ubuntu)
```

Current lab certificate:

```text
subject=CN = app.msiwebapp.com
issuer=CN = app.msiwebapp.com
notBefore=Jun 10 03:58:48 2026 GMT
notAfter=Jul 10 03:58:48 2026 GMT
Subject Alternative Name: DNS:app.msiwebapp.com
```

HTTPS health check:

```bash
curl -kfsS https://app.msiwebapp.com/api/health
```

Result:

```json
{"ok":true,"env":"production","hasClientBuild":true}
```

Mac-side localhost-forwarding test also worked:

```bash
curl -kfsS --resolve app.msiwebapp.com:443:127.0.0.1 \
  https://app.msiwebapp.com/api/health
```

## Real Browser Test Result

Normal Chrome was opened to:

```text
https://app.msiwebapp.com/
```

Result:

```text
DNS_PROBE_FINISHED_NXDOMAIN
```

This proves the remaining blocker is DNS. The Mac's current DNS resolvers do
not know `app.msiwebapp.com`.

A temporary Chrome profile launched with a host resolver override reached
Microsoft login, which proves the app can start the MSAL/Entra redirect flow:

```bash
open -na "Google Chrome" --args \
  --user-data-dir=/tmp/mswebapp-chrome-test \
  --host-resolver-rules="MAP app.msiwebapp.com 127.0.0.1" \
  "https://app.msiwebapp.com/"
```

That test profile is a lab workaround only. It is not the production fix.

## Remaining Work For The Real Internal Build

1. Give the Ubuntu production server a static LAN IP.
2. Run the Windows Server scripts on a real Windows Server VM/host:
   - promote the DC if needed
   - install Enterprise Root CA if needed
   - create the `msiwebapp.com` internal DNS zone
   - create `app.msiwebapp.com` A record pointing to the Ubuntu static IP
   - issue/export a certificate for `app.msiwebapp.com`
3. Install the CA-issued certificate on Ubuntu:
   - `/etc/ssl/mswebapp/app.msiwebapp.com.crt`
   - `/etc/ssl/mswebapp/app.msiwebapp.com.key`
4. Ensure client machines use the domain controller for DNS.
5. Ensure client machines trust the internal CA root.
6. Open normal Chrome to `https://app.msiwebapp.com/` and complete Microsoft
   sign-in.

When those pieces are in place, the app should load privately, redirect to
Microsoft Entra, and return to the internal app URL without Cloudflare.

## Windows Server 2025 Internal DC/CA Build

Built and verified on the Windows Server 2025 VM at:

```text
Host: MSI-DC01
IP: 192.168.1.162
AD domain: corp.msiwebapp.com
NetBIOS: MSIWEBAPP
Logged-in admin context: msiwebapp\administrator
```

Completed:

1. Set the server to static IPv4 `192.168.1.162/24` with gateway
   `192.168.1.1`.
2. Renamed the server to `MSI-DC01`.
3. Installed `AD-Domain-Services` and `DNS`.
4. Promoted the server to the first domain controller for
   `corp.msiwebapp.com`.
5. Reconnected after the AD DS reboot.
6. Verified the domain with `Get-ADDomain`.
7. Installed `ADCS-Cert-Authority` and `RSAT-ADCS`.
8. Configured the Enterprise Root CA.
9. Verified `CertSvc` is running.

Successful CA setup command:

```powershell
Install-AdcsCertificationAuthority `
  -CAType EnterpriseRootCA `
  -CACommonName "MSIWEBAPP Internal Root CA" `
  -KeyLength 4096 `
  -HashAlgorithmName SHA256 `
  -ValidityPeriod Years `
  -ValidityPeriodUnits 10 `
  -Force
```

The Server 2025 build rejected this provider string:

```powershell
-CryptoProviderName "RSA#Microsoft Software Key Storage Provider"
```

The corrected command above lets Windows choose the provider and completed with
`ErrorId 0`.

Observed warnings:

- AD DS promotion warned that IPv6 was not statically assigned. IPv4 was static
  and the promotion completed successfully.
- AD DS promotion warned that DNS delegation could not be created for
  `corp.msiwebapp.com`. That is expected for this internal-only root domain.

RDP/input notes:

- macOS Windows App was used for RDP.
- After AD DS promotion, reconnect to `192.168.1.162` and accept the RDP
  certificate warning.
- Saved credentials may need to be domain-qualified after promotion:
  `MSIWEBAPP\Administrator`.
- The RDP keyboard path mapped some PowerShell special characters incorrectly
  during typed commands. Avoid `$false` and inline `Read-Host` expressions when
  driving commands over this RDP path. Let `Install-ADDSForest` prompt for
  `SafeModeAdministratorPassword` directly instead.

Next live build step:

1. Build the Ubuntu app server.
2. Install the GitHub webapp repo.
3. Give Ubuntu a static LAN IP.
4. Add the internal DNS zone `msiwebapp.com` and A record
   `app.msiwebapp.com -> <Ubuntu LAN IP>` on `MSI-DC01`.
5. Issue the `app.msiwebapp.com` certificate from the Enterprise Root CA.
6. Install the CA-issued certificate on Ubuntu/Nginx.
7. Test `https://app.msiwebapp.com/` from a normal browser using internal DNS.
