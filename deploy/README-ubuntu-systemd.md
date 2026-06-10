# MSwebapp Ubuntu Production Setup

Production target:

- Public URL: `https://app.mswebapp.com/`
- GitHub repository: `https://github.com/forexsnyder/MSwebapp.git`
- App code: `/opt/mswebapp`
- SQLite database: `/var/lib/mswebapp/app.sqlite`
- Linux user: `jeff`
- Node service: `mswebapp`
- Cloudflare tunnel: `mswebapp`
- Internal app port: `3001`

The app is one Node process. It serves the API under `/api/*` and the built
React UI from `client/dist/`.

## 1) Azure Redirect URI

In Microsoft Entra app registration `ddacbbb5-d415-458d-8132-761d07714425`,
add this SPA redirect URI:

```text
https://app.mswebapp.com/
```

The committed production Vite env file at `client/.env.production` uses that
same URI. If Azure and the React build do not match exactly, login fails with
`AADSTS50011`.

## 2) Install Server Packages

Ubuntu 24.04's default `nodejs` package is Node 18, but this app requires
Node 20+. Install Node 22 from NodeSource before installing app dependencies.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl ca-certificates gnupg build-essential sqlite3 ufw

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

## 3) Install Cloudflared

Use a named Cloudflare Tunnel for production. Do not use a random
`trycloudflare.com` quick tunnel for Microsoft auth.

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared
```

Authenticate Cloudflare and create the tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create mswebapp
cloudflared tunnel route dns mswebapp app.mswebapp.com
```

Install the tunnel config:

```bash
sudo mkdir -p /etc/cloudflared
sudo cp /opt/mswebapp/deploy/cloudflared-mswebapp.yml /etc/cloudflared/config.yml
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

If `cloudflared tunnel create mswebapp` writes the credentials file somewhere
other than `/root/.cloudflared/mswebapp.json`, update
`/etc/cloudflared/config.yml` to the actual credentials path.

## 4) Create User And Storage

```bash
sudo id jeff || sudo useradd --create-home --shell /bin/bash jeff

sudo mkdir -p /var/lib/mswebapp
sudo chown -R jeff:jeff /var/lib/mswebapp
sudo -u jeff touch /var/lib/mswebapp/app.sqlite
sudo chown jeff:jeff /var/lib/mswebapp/app.sqlite
```

## 5) Clone The App

```bash
sudo rm -rf /opt/mswebapp
sudo git clone https://github.com/forexsnyder/MSwebapp.git /opt/mswebapp
sudo chown -R jeff:jeff /opt/mswebapp
```

If the GitHub repository is private, authenticate Git first or use an SSH deploy
key before cloning.

## 6) Install Dependencies And Build

```bash
cd /opt/mswebapp
sudo -u jeff rm -rf node_modules client/node_modules server/node_modules
sudo -u jeff rm -f client/.env.local
sudo -u jeff /usr/bin/npm ci
sudo -u jeff /usr/bin/npm run build
```

## 7) Install The Systemd Service

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

Health check:

```bash
curl -fsS http://localhost:3001/api/health
```

## 8) Firewall

Cloudflare Tunnel does not require exposing port `3001` to the internet. Keep
SSH open and deny direct public access to the app port unless you deliberately
need LAN testing.

```bash
sudo ufw allow OpenSSH
sudo ufw --force enable
sudo ufw status
```

For temporary LAN-only testing:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 3001 proto tcp
```

## 9) Verify Production

```bash
curl -I https://app.mswebapp.com/
curl -fsS https://app.mswebapp.com/api/health
```

Open:

```text
https://app.mswebapp.com/
```

## 10) Update Production Later

```bash
cd /opt/mswebapp
sudo -u jeff git status
sudo -u jeff git pull --ff-only origin master
sudo -u jeff rm -rf node_modules client/node_modules server/node_modules
sudo -u jeff rm -f client/.env.local
sudo -u jeff /usr/bin/npm ci
sudo -u jeff /usr/bin/npm run build
sudo systemctl restart mswebapp
sudo systemctl status mswebapp --no-pager
```

## Troubleshooting

If Microsoft login fails with `AADSTS50011`, confirm both places use the exact
same URI:

- Azure SPA redirect URI: `https://app.mswebapp.com`
- `client/.env.production`: `VITE_AZURE_REDIRECT_URI=https://app.mswebapp.com`

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
