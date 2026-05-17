# Deploy to headless Ubuntu (systemd)

This app is a single Node process that serves:

- the API under `/api/*`
- the built React UI from `client/dist/` (same origin)

## 0) Server prerequisites

- Ubuntu server on your LAN
- A DNS name or static IP (recommended)
- Node.js 20+ installed

If you don't already have Node 20+ on Ubuntu, install it via your preferred method (NodeSource, nvm, etc.).

## 1) Create a service user + folders

```bash
sudo useradd --system --create-home --home /srv/react-sqlite-app --shell /usr/sbin/nologin reactapp || true

sudo mkdir -p /opt/react-sqlite-app
sudo mkdir -p /var/lib/react-sqlite-app
sudo chown -R reactapp:reactapp /var/lib/react-sqlite-app
```

## 2) Copy the project onto the server

Copy this repo folder to `/opt/react-sqlite-app` on the server.

Example (from your workstation):

```bash
rsync -a --delete ./react-sqlite-app/ youruser@server:/opt/react-sqlite-app/
```

Important: **do not copy `node_modules/`**; install fresh on the server.

## 3) Install dependencies + build UI (on the server)

```bash
cd /opt/react-sqlite-app

# clean install based on package-lock.json
npm ci

# build the React app into client/dist (required for NODE_ENV=production)
npm run build
```

## 4) Configure environment variables

Create an env file (owned by root; readable by the service):

```bash
sudo mkdir -p /etc/react-sqlite-app
sudo nano /etc/react-sqlite-app/env
```

Suggested contents:

```bash
NODE_ENV=production
PORT=3001
TRUST_PROXY=1

# Persist SQLite outside the code folder
DB_PATH=/var/lib/react-sqlite-app/app.db

# Optional: if you serve the UI from a different origin, set this.
# If you leave it blank (recommended), the app is same-origin only in production.
# CORS_ORIGIN=http://your-ui-host:3001

# Optional: protect /api/admin/* endpoints.
# When set, callers must send header: x-admin-token: <value>
# ADMIN_TOKEN=change-me

# Optional: request body limit for JSON posts
JSON_LIMIT=1mb
```

## 5) Install the systemd unit

Copy the unit file into place:

```bash
sudo cp /opt/react-sqlite-app/deploy/react-sqlite-app.service /etc/systemd/system/react-sqlite-app.service
sudo systemctl daemon-reload
```

Enable + start:

```bash
sudo systemctl enable --now react-sqlite-app
sudo systemctl status react-sqlite-app --no-pager
```

Logs:

```bash
journalctl -u react-sqlite-app -f
```

Health check:

```bash
curl -s http://localhost:3001/api/health | jq .
```

## 6) LAN firewall (optional but recommended)

If using UFW:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 3001 proto tcp
sudo ufw enable
```

## 7) Backups (strongly recommended)

At minimum, back up:

- `/var/lib/react-sqlite-app/app.db`

SQLite is a single file; simplest backups are periodic copies with retention.

