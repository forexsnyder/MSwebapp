# Production SSH Copy/Paste

## 1. SSH Into Production

Replace the host with the production server IP or DNS name:

```bash
ssh jeff@YOUR_PRODUCTION_SERVER_IP_OR_DNS
```

## 2. Paste The Deployment Script

From your Mac, open this file and copy all of it:

```text
/Users/jeffsnyder/Documents/MSwebapp/deploy/PRODUCTION-COMMANDS-EMAIL.txt
```

Paste it into the SSH window and press Enter.

## 3. What The Script Does

- Uses the existing `/opt/mswebapp` production checkout.
- Pulls the latest `master` from `https://github.com/forexsnyder/MSwebapp.git`.
- Writes `/opt/mswebapp/client/.env.production`.
- Removes `/opt/mswebapp/client/.env.local`.
- Runs `npm ci`.
- Builds the production React app.
- Restarts the `mswebapp` service.
- Reloads Nginx.
- Checks `http://localhost:3001/api/health`.

## 4. Production Env Values

```bash
VITE_AZURE_CLIENT_ID=ba6e29e9-fa87-4624-8cec-f60d4a414584
VITE_AZURE_AUTHORITY_HOST=https://login.microsoftonline.us
VITE_AZURE_TENANT_ID=missionsupport.us
VITE_AZURE_REDIRECT_URI=https://app.msiwebapp.com
```
