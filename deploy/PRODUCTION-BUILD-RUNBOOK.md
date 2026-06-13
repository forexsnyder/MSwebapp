# MSwebapp Production Build Runbook

This is the end-to-end production checklist for rebuilding MSI Picker/MSwebapp
from infrastructure through Microsoft sign-in and Android/Intune access.

## Production Targets

| Item | Production value |
| --- | --- |
| App URL | `https://app.msiwebapp.com/` |
| DNS name | `app.msiwebapp.com` |
| Ubuntu app path | `/opt/mswebapp` |
| SQLite database | `/var/lib/mswebapp/app.sqlite` |
| Linux service user | `jeff` |
| systemd service | `mswebapp` |
| Internal Node port | `3001` |
| Reverse proxy | `nginx` |
| Git repository | `https://github.com/forexsnyder/MSwebapp.git` |
| Entra tenant ID | `ee3b8604-f681-47e6-b31b-e915f224dcbd` |
| Entra tenant domain | `missionsupport.us` |
| Entra app client ID | `ba6e29e9-fa87-4624-8cec-f60d4a414584` |

The app is one Node/Express process. In production, Express serves both the API
under `/api/*` and the React build from `client/dist/`. Nginx terminates HTTPS
on the internal hostname and proxies to `127.0.0.1:3001`.

## 1. Network, DNS, And Server Naming

1. Assign the Ubuntu server a static internal IP address.
2. Replace examples below with that IP. Existing lab docs use `10.0.0.25`.
3. Make domain workstations use the domain controller or internal DNS server as
   their DNS resolver.
4. Create an internal DNS zone for `msiwebapp.com` if it does not already exist.
5. Create an A record:

```powershell
Add-DnsServerPrimaryZone -Name "msiwebapp.com" -ReplicationScope "Domain"

Add-DnsServerResourceRecordA `
  -ZoneName "msiwebapp.com" `
  -Name "app" `
  -IPv4Address "10.0.0.25"
```

Verify from a domain workstation:

```powershell
Resolve-DnsName app.msiwebapp.com
```

Expected result: `app.msiwebapp.com` resolves to the Ubuntu server internal IP.

## 2. Internal CA And TLS Certificate

Production browsers must trust the certificate used by Nginx. Use either the
existing internal CA or the Windows Server lab scripts in
`deploy/windows-internal/`.

Certificate requirements:

- Subject or CN: `app.msiwebapp.com`
- Subject Alternative Name: `DNS=app.msiwebapp.com`
- Enhanced Key Usage: Server Authentication
- Export includes private key

If using the bundled Windows Server scripts:

```powershell
cd deploy\windows-internal
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\01-promote-domain-controller.ps1
```

After the reboot:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\02-install-ca-and-dns.ps1
.\03-issue-app-certificate.ps1
```

The certificate script exports:

```text
C:\MSwebapp-Certs\app.msiwebapp.com.pfx
```

Copy the PFX to Ubuntu and convert it:

```bash
sudo apt update
sudo apt install -y openssl
sudo mkdir -p /etc/ssl/mswebapp
sudo openssl pkcs12 -in app.msiwebapp.com.pfx -clcerts -nokeys -out /etc/ssl/mswebapp/app.msiwebapp.com.crt
sudo openssl pkcs12 -in app.msiwebapp.com.pfx -nocerts -nodes -out /etc/ssl/mswebapp/app.msiwebapp.com.key
sudo chown -R root:root /etc/ssl/mswebapp
sudo chmod 755 /etc/ssl/mswebapp
sudo chmod 644 /etc/ssl/mswebapp/app.msiwebapp.com.crt
sudo chmod 600 /etc/ssl/mswebapp/app.msiwebapp.com.key
```

Make sure domain-joined Windows devices trust the internal root CA through Group
Policy or the enterprise CA trust chain. For Android work-profile devices,
deploy the root CA through Intune if those devices will connect directly to the
internal HTTPS URL or through VPN/private access.

## 3. Ubuntu Server Base Build

Use Ubuntu 24.04 LTS or newer. Ubuntu's default Node package can be too old, so
install Node 22 from NodeSource.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl ca-certificates gnupg build-essential sqlite3 ufw nginx

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

/usr/bin/node -v
/usr/bin/npm -v
```

Expected versions:

```text
node v22.x
npm 10.x or newer
```

Create the service user and database directory:

```bash
sudo id jeff || sudo useradd --create-home --shell /bin/bash jeff

sudo mkdir -p /var/lib/mswebapp
sudo chown -R jeff:jeff /var/lib/mswebapp
sudo -u jeff touch /var/lib/mswebapp/app.sqlite
sudo chown jeff:jeff /var/lib/mswebapp/app.sqlite
```

## 4. Clone, Configure, And Build The App

```bash
sudo rm -rf /opt/mswebapp
sudo git clone https://github.com/forexsnyder/MSwebapp.git /opt/mswebapp
sudo chown -R jeff:jeff /opt/mswebapp
cd /opt/mswebapp
```

If the repository is private, configure GitHub authentication first. For HTTPS,
use the GitHub username `forexsnyder` and a personal access token when prompted.

Confirm the production Vite environment file:

```bash
sudo -u jeff sed -n '1,20p' /opt/mswebapp/client/.env.production
```

It must contain:

```bash
VITE_AZURE_CLIENT_ID=ba6e29e9-fa87-4624-8cec-f60d4a414584
VITE_AZURE_AUTHORITY_HOST=https://login.microsoftonline.us
VITE_AZURE_TENANT_ID=missionsupport.us
VITE_AZURE_REDIRECT_URI=https://app.msiwebapp.com
```

Remove local dev env overrides before production builds:

```bash
sudo -u jeff rm -f /opt/mswebapp/client/.env.local
```

Install dependencies and build React:

```bash
cd /opt/mswebapp
sudo -u jeff rm -rf node_modules client/node_modules server/node_modules
sudo -u jeff /usr/bin/npm ci
sudo -u jeff /usr/bin/npm run build
```

## 5. systemd Service

Install the bundled service:

```bash
sudo cp /opt/mswebapp/deploy/mswebapp.service /etc/systemd/system/mswebapp.service
sudo systemctl daemon-reload
sudo systemctl enable --now mswebapp
sudo systemctl status mswebapp --no-pager
```

The service should run with:

```ini
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=TRUST_PROXY=1
Environment=DB_PATH=/var/lib/mswebapp/app.sqlite
ExecStart=/usr/bin/node server/index.js
```

Health check:

```bash
curl -fsS http://localhost:3001/api/health
```

Logs:

```bash
journalctl -u mswebapp -f
```

## 6. Nginx Reverse Proxy

Install the bundled Nginx config:

```bash
sudo cp /opt/mswebapp/deploy/nginx-mswebapp.conf /etc/nginx/sites-available/mswebapp
sudo ln -sfn /etc/nginx/sites-available/mswebapp /etc/nginx/sites-enabled/mswebapp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

Production Nginx listens on ports `80` and `443`, redirects HTTP to HTTPS, uses
the internal CA certificate, and proxies all requests to `http://127.0.0.1:3001`.

## 7. Ubuntu Firewall

Do not expose port `3001` to users. Nginx is the public internal entry point.

Basic internal firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

Tighter LAN-only example:

```bash
sudo ufw delete allow 'Nginx Full'
sudo ufw allow from 10.0.0.0/8 to any port 80 proto tcp
sudo ufw allow from 10.0.0.0/8 to any port 443 proto tcp
sudo ufw status
```

## 8. Microsoft Entra App Registration

The React app uses MSAL for browser sign-in. Keep one production app
registration for this web app.

In Microsoft Entra admin center:

1. Go to **Identity > Applications > App registrations**.
2. Open the MSwebapp registration with client ID
   `ba6e29e9-fa87-4624-8cec-f60d4a414584`, or create one if missing.
3. Supported account types: **Accounts in this organizational directory only**.
4. Go to **Authentication**.
5. Add platform: **Single-page application**.
6. Add the SPA redirect URI:

```text
https://app.msiwebapp.com
```

7. Add the same URL as the logout/post-logout URL if shown in the portal.
8. Leave implicit grant unchecked. MSAL SPA sign-in uses authorization code with
   PKCE.
9. Confirm the app overview shows:
   - Application/client ID:
     `ba6e29e9-fa87-4624-8cec-f60d4a414584`
   - Directory/tenant ID:
     `ee3b8604-f681-47e6-b31b-e915f224dcbd`

If sign-in fails with `AADSTS50011`, compare the Entra SPA redirect URI with
`client/.env.production`. The hostname, scheme, and trailing slash behavior must
match what MSAL sends from the browser.

## 9. Entra App Roles

The app expects role names in the token `roles` claim:

- `Requester`: request parts and view request history.
- `Picker`: pick/close tickets and view history.
- `Auditor`: full access to all app screens.

In the app registration:

1. Go to **App roles**.
2. Create these user/group roles exactly:
   - Display name: `Requester`, Value: `Requester`
   - Display name: `Picker`, Value: `Picker`
   - Display name: `Auditor`, Value: `Auditor`
3. Allowed member types: **Users/Groups**.
4. Enable each role.
5. Save.

Assign roles from the Enterprise Application:

1. Go to **Identity > Applications > Enterprise applications**.
2. Open the service principal for the MSwebapp registration.
3. Go to **Users and groups**.
4. Assign users or security groups to the correct app role.
5. Have users sign out and sign back in after role changes so a fresh token is
   issued.

## 10. Intune Android Production Configuration

Use Intune when production access should be limited to enrolled, compliant
Android devices.

Licensing and admin roles needed:

- Microsoft Intune Plan 1 or a suite that includes Intune.
- Microsoft Entra ID P1/P2 if using Conditional Access and Application Proxy.
- Intune Administrator for enrollment/compliance.
- Conditional Access Administrator for access policies.
- Application Administrator for app proxy/app assignments.

Production group layout:

- `MSI Picker Prod Users`
- `MSI Picker Requesters`
- `MSI Picker Pickers`
- `MSI Picker Auditors`
- A break-glass admin account excluded from Conditional Access policies.

Android enrollment:

1. Go to **Intune admin center > Devices > Enrollment > Android**.
2. Connect Managed Google Play if not already connected.
3. Enable **Android Enterprise personally owned devices with work profile** for
   BYOD/no-factory-reset devices.
4. For new company-owned devices, use fully managed or corporate-owned with work
   profile enrollment depending on your ownership model.
5. Assign enrollment to the production user group.

Compliance policy:

1. Go to **Devices > Compliance policies > Create policy**.
2. Platform: **Android Enterprise**.
3. Profile type: choose the enrollment model, commonly
   **Personally-owned work profile**.
4. Recommended baseline:
   - Rooted devices: Block
   - Google Play Services: Require
   - Up-to-date security provider: Require
   - Encryption of data storage: Require
   - Password to unlock mobile devices: Require
   - Minimum OS version: set to the lowest Android version you will support
   - Minimum security patch level: set once you know the device fleet
5. Assignment: `MSI Picker Prod Users`.
6. Keep the default action to mark devices noncompliant immediately unless you
   intentionally want a grace period.

Managed browser/work-profile app:

1. Go to **Apps > All apps > Create**.
2. App type: **Managed Google Play app**.
3. Approve and assign Google Chrome or Microsoft Edge to
   `MSI Picker Prod Users`.
4. Assign as **Required** for production if the browser must always be present.

Web link shortcut:

1. Go to **Apps > All apps > Create**.
2. Platform: **Android**.
3. App type: **Web link**.
4. Name: `MSI Picker`.
5. Publisher: `MSI Web App`.
6. App URL: `https://app.msiwebapp.com/`.
7. Require managed browser: choose based on your browser policy.
8. Assign to `MSI Picker Prod Users`.

Chrome SSO improvement:

1. Go to **Devices > Configuration**.
2. Create an Android Enterprise browser configuration profile for managed
   Chrome if available in the tenant.
3. Enable Chrome policy `AndroidEntraSsoEnabled`.
4. Assign it to `MSI Picker Prod Users`.

## 11. Conditional Access

Create a production Conditional Access policy after Intune compliance is working
and test it in report-only mode first.

Policy:

- Name: `CA - MSI Picker Prod - compliant Android only`
- Users: include `MSI Picker Prod Users`
- Exclude: break-glass admin accounts
- Target resources: the MSI Picker Enterprise Application or Application Proxy
  Enterprise Application, depending on whether users access it directly or
  through Entra Application Proxy
- Conditions:
  - Device platforms: Android
  - Client apps: Browser
- Grant:
  - Grant access
  - Require device to be marked as compliant
  - Optional: require MFA
- Initial state: Report-only
- Final state after testing: On

Use the Conditional Access What If tool and Entra sign-in logs before enforcing.
Negative tests should confirm that non-enrolled, noncompliant, and unassigned
users are blocked.

## 12. Optional Remote Access With Entra Application Proxy

If Android devices will reach the app outside the LAN/VPN, publish the internal
app through Microsoft Entra Application Proxy. The connector must run on a
Windows machine that can reach the Ubuntu app over the private network.

Connector:

1. In Entra admin center, go to **Enterprise apps > Application proxy**.
2. Download the private network connector.
3. Install it on a Windows Server/Windows VM on the internal network.
4. Register it to the tenant.
5. Confirm the connector status is active.

Production proxy app:

1. Go to **Enterprise applications > New application**.
2. Select **Add an on-premises application**.
3. Configure:
   - Name: `MSI Picker Prod`
   - Internal URL: `https://app.msiwebapp.com/`
   - External URL: generated `msappproxy.net` URL or a custom external domain
   - Pre Authentication: **Microsoft Entra ID**
   - Connector Group: production connector group
4. Assign only `MSI Picker Prod Users`.
5. Apply the production Conditional Access policy to this Enterprise
   Application.

Do not use passthrough preauthentication when Conditional Access is the access
gate.

## 13. Production Verification

From Ubuntu:

```bash
curl -fsS http://localhost:3001/api/health
curl -kI https://app.msiwebapp.com/
curl -kfsS https://app.msiwebapp.com/api/health
systemctl status mswebapp --no-pager
systemctl status nginx --no-pager
```

From a domain workstation:

```powershell
Resolve-DnsName app.msiwebapp.com
Invoke-WebRequest https://app.msiwebapp.com/api/health
```

Browser test:

1. Open `https://app.msiwebapp.com/`.
2. Sign in with Microsoft Authenticator/MFA.
3. Confirm the app returns from Microsoft to `app.msiwebapp.com`.
4. Confirm the user sees pages matching their app role.
5. Create a test request, pick it, close it, and view history.

Android/Intune test:

1. Enroll the device through Company Portal or the chosen production enrollment
   flow.
2. Confirm Intune marks the device compliant.
3. Open the work-profile browser or MSI Picker web link.
4. Sign in.
5. Confirm Conditional Access success in Entra sign-in logs.

## 14. Backup And Restore

SQLite database backup:

```bash
sudo mkdir -p /var/backups/mswebapp
sudo sqlite3 /var/lib/mswebapp/app.sqlite ".backup '/var/backups/mswebapp/app-$(date +%F-%H%M%S).sqlite'"
sudo ls -lh /var/backups/mswebapp
```

Restore during a maintenance window:

```bash
sudo systemctl stop mswebapp
sudo cp /var/lib/mswebapp/app.sqlite /var/lib/mswebapp/app.sqlite.before-restore
sudo cp /var/backups/mswebapp/app-YYYY-MM-DD-HHMMSS.sqlite /var/lib/mswebapp/app.sqlite
sudo chown jeff:jeff /var/lib/mswebapp/app.sqlite
sudo systemctl start mswebapp
```

Recommended cron backup:

```bash
sudo tee /etc/cron.d/mswebapp-backup >/dev/null <<'EOF'
15 2 * * * jeff sqlite3 /var/lib/mswebapp/app.sqlite ".backup '/var/backups/mswebapp/app-$(date +\%F-\%H\%M\%S).sqlite'"
EOF
```

Make sure `/var/backups/mswebapp` exists and is writable by `jeff` if using that
cron entry.

## 15. Production Updates

```bash
cd /opt/mswebapp
sudo -u jeff git status
sudo -u jeff git pull --ff-only origin master
sudo -u jeff rm -rf node_modules client/node_modules server/node_modules
sudo -u jeff rm -f client/.env.local
sudo -u jeff /usr/bin/npm ci
sudo -u jeff /usr/bin/npm run build
sudo systemctl restart mswebapp
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status mswebapp --no-pager
```

Run the production verification checks after every update.

## 16. Troubleshooting

`AADSTS50011`:

- The Entra SPA redirect URI and `VITE_AZURE_REDIRECT_URI` do not match.
- Confirm both use `https://app.msiwebapp.com`.
- Rebuild the React client after changing `.env.production`.

Certificate warning:

- The workstation or Android work profile does not trust the internal CA root.
- The certificate is expired.
- The certificate is missing `DNS=app.msiwebapp.com` in SAN.
- Nginx is pointing to the wrong certificate/key files.

DNS failure:

- Internal clients are not using the domain DNS server.
- The `msiwebapp.com` internal zone is missing.
- The `app` A record points to the wrong Ubuntu IP.

Nginx returns 502:

- `mswebapp` service is stopped or crashing.
- Node is not listening on `127.0.0.1:3001`/`0.0.0.0:3001`.
- Check `journalctl -u mswebapp -n 100 --no-pager`.

Missing UI in production:

- `client/dist/index.html` is missing.
- Run `sudo -u jeff /usr/bin/npm run build` from `/opt/mswebapp`.

Roles missing after assignment:

- User has not signed out and back in.
- Role value does not exactly match `Requester`, `Picker`, or `Auditor`.
- Assignment was made on the wrong Enterprise Application/app registration.

`better-sqlite3` install failure:

- Confirm Node is v20+ and preferably v22 LTS.
- Remove all `node_modules` folders and rerun `npm ci`.

## 17. Reference Files In This Repository

- `deploy/README-ubuntu-systemd.md`
- `deploy/nginx-mswebapp.conf`
- `deploy/mswebapp.service`
- `deploy/windows-internal/README.md`
- `deploy/windows-internal/01-promote-domain-controller.ps1`
- `deploy/windows-internal/02-install-ca-and-dns.ps1`
- `deploy/windows-internal/03-issue-app-certificate.ps1`
- `deploy/README-azure-android-access.md`
- `client/.env.production`
- `client/src/auth/msalConfig.ts`
- `client/src/auth/roles.ts`

## 18. Microsoft References

- Microsoft Entra SPA auth code flow and PKCE:
  https://learn.microsoft.com/en-us/entra/identity-platform/msal-authentication-flows
- Migrating SPAs away from implicit grant:
  https://learn.microsoft.com/en-us/entra/identity-platform/migrate-spa-implicit-to-auth-code
- Add app roles and receive them in tokens:
  https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps
- Microsoft Entra Application Proxy overview:
  https://learn.microsoft.com/en-us/entra/identity/app-proxy/overview-what-is-app-proxy
- Application Proxy security:
  https://learn.microsoft.com/en-us/entra/identity/app-proxy/application-proxy-security
- Android Enterprise compliance settings in Intune:
  https://learn.microsoft.com/en-us/intune/device-security/compliance/ref-android-enterprise-settings
- Conditional Access with Intune compliance:
  https://learn.microsoft.com/en-us/intune/intune-service/protect/conditional-access
- Noncompliance actions:
  https://learn.microsoft.com/en-us/intune/device-security/compliance/configure-noncompliance-actions
