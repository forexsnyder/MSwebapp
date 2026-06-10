# MSwebapp Internal Ubuntu Production Setup

Production target:

- Internal URL: `https://app.msiwebapp.com/`
- GitHub repository: `https://github.com/forexsnyder/MSwebapp.git`
- App code: `/opt/mswebapp`
- SQLite database: `/var/lib/mswebapp/app.sqlite`
- Linux user: `jeff`
- Node service: `mswebapp`
- Reverse proxy: `nginx`
- Internal app port: `3001`

This deployment is private. The domain controller answers
`app.msiwebapp.com` with the Ubuntu server's internal IP, Nginx terminates an
internal-CA certificate, and the Node app only needs to listen on port `3001`.

The app is one Node process. It serves the API under `/api/*` and the built
React UI from `client/dist/`.

If you need a repeatable Windows Server lab for the domain controller, DNS, and
CA pieces, use the scripts in `deploy/windows-internal/`.

## 1) Internal DNS

On the domain controller DNS server, create a split-horizon record for the app
hostname. Replace `10.0.0.25` with the Ubuntu server's internal static IP.

```powershell
Add-DnsServerResourceRecordA `
  -ZoneName "msiwebapp.com" `
  -Name "app" `
  -IPv4Address "10.0.0.25"
```

If the DC does not host a `msiwebapp.com` zone yet, create the primary zone
first:

```powershell
Add-DnsServerPrimaryZone -Name "msiwebapp.com" -ReplicationScope "Domain"
```

Verify from a domain-joined workstation:

```powershell
Resolve-DnsName app.msiwebapp.com
```

The answer must be the Ubuntu server's internal IP.

## 2) Internal CA Certificate

Issue a server authentication certificate from the internal CA with this name:

```text
DNS Name: app.msiwebapp.com
```

Install the certificate and private key on the Ubuntu server:

```bash
sudo mkdir -p /etc/ssl/mswebapp
sudo cp app.msiwebapp.com.crt /etc/ssl/mswebapp/app.msiwebapp.com.crt
sudo cp app.msiwebapp.com.key /etc/ssl/mswebapp/app.msiwebapp.com.key
sudo chown -R root:root /etc/ssl/mswebapp
sudo chmod 755 /etc/ssl/mswebapp
sudo chmod 644 /etc/ssl/mswebapp/app.msiwebapp.com.crt
sudo chmod 600 /etc/ssl/mswebapp/app.msiwebapp.com.key
```

All client devices must trust the internal CA root. For domain-joined Windows
devices, publish the CA root with Group Policy if it is not already trusted.

## 3) Azure Redirect URI

In Microsoft Entra app registration `ddacbbb5-d415-458d-8132-761d07714425`,
keep this SPA redirect URI:

```text
https://app.msiwebapp.com/
```

The committed production Vite env file at `client/.env.production` uses the
same URI. If Azure and the React build do not match exactly, login fails with
`AADSTS50011`.

## 4) Install Server Packages

Ubuntu 24.04's default `nodejs` package is Node 18, but this app requires
Node 20+. Install Node 22 from NodeSource before installing app dependencies.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl ca-certificates gnupg build-essential sqlite3 ufw nginx

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
/usr/bin/node -v
/usr/bin/npm -v
```

Expected major versions:

```text
node v22.x
npm 10.x
```

## 5) Create User And Storage

```bash
sudo id jeff || sudo useradd --create-home --shell /bin/bash jeff

sudo mkdir -p /var/lib/mswebapp
sudo chown -R jeff:jeff /var/lib/mswebapp
sudo -u jeff touch /var/lib/mswebapp/app.sqlite
sudo chown jeff:jeff /var/lib/mswebapp/app.sqlite
```

## 6) Clone The App

```bash
sudo rm -rf /opt/mswebapp
sudo git clone https://github.com/forexsnyder/MSwebapp.git /opt/mswebapp
sudo chown -R jeff:jeff /opt/mswebapp
```

If the GitHub repository is private, authenticate Git first or use an SSH deploy
key before cloning.

## 7) Install Dependencies And Build

```bash
cd /opt/mswebapp
sudo -u jeff rm -rf node_modules client/node_modules server/node_modules
sudo -u jeff rm -f client/.env.local
sudo -u jeff /usr/bin/npm ci
sudo -u jeff /usr/bin/npm run build
```

## 8) Install The Systemd Service

```bash
sudo cp /opt/mswebapp/deploy/mswebapp.service /etc/systemd/system/mswebapp.service
sudo systemctl daemon-reload
sudo systemctl enable --now mswebapp
sudo systemctl status mswebapp --no-pager
```

Logs:

```bash
journalctl -u mswebapp -f
```

Local health check:

```bash
curl -fsS http://localhost:3001/api/health
```

## 9) Install Nginx

```bash
sudo cp /opt/mswebapp/deploy/nginx-mswebapp.conf /etc/nginx/sites-available/mswebapp
sudo ln -sfn /etc/nginx/sites-available/mswebapp /etc/nginx/sites-enabled/mswebapp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

## 10) Firewall

Expose only SSH, HTTP, and HTTPS on the internal network. Do not expose port
`3001`; Nginx proxies to it locally.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

For tighter LAN rules, replace `Nginx Full` with source-limited rules:

```bash
sudo ufw delete allow 'Nginx Full'
sudo ufw allow from 10.0.0.0/8 to any port 80 proto tcp
sudo ufw allow from 10.0.0.0/8 to any port 443 proto tcp
```

## 11) Verify Internal Production

From the Ubuntu server:

```bash
curl -fsS http://localhost:3001/api/health
curl -kI https://app.msiwebapp.com/
curl -kfsS https://app.msiwebapp.com/api/health
```

From a domain-joined workstation that trusts the CA:

```powershell
Resolve-DnsName app.msiwebapp.com
Invoke-WebRequest https://app.msiwebapp.com/api/health
```

Open:

```text
https://app.msiwebapp.com/
```

## 12) Update Production Later

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

## Troubleshooting

If Microsoft login fails with `AADSTS50011`, confirm both places use the exact
same URI:

- Azure SPA redirect URI: `https://app.msiwebapp.com/`
- `client/.env.production`: `VITE_AZURE_REDIRECT_URI=https://app.msiwebapp.com`

If browsers show a certificate warning, the workstation does not trust the
internal CA root, the certificate is expired, or the certificate is missing the
`app.msiwebapp.com` DNS subject alternative name.

If DNS resolves publicly or fails internally, fix the domain controller DNS
zone and workstation DNS settings. Internal clients must use the domain
controller as their DNS resolver.

If `better-sqlite3` fails after changing Node versions:

```bash
cd /opt/mswebapp
sudo -u jeff rm -rf node_modules client/node_modules server/node_modules
sudo -u jeff rm -f client/.env.local
sudo -u jeff /usr/bin/npm ci
sudo systemctl restart mswebapp
```

The active database should be:

```bash
pid=$(systemctl show -p MainPID --value mswebapp)
sudo ls -l /proc/$pid/fd | grep -E 'app\.(db|sqlite)'
```

Expected:

```text
/var/lib/mswebapp/app.sqlite
```
