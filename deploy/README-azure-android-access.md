# Azure dry run for Android access

This runbook dry-runs Azure access for the dev web app before changing the
production Ubuntu server. It publishes a dev instance through Microsoft Entra
Application Proxy and restricts access to Android devices enrolled and marked
compliant in Microsoft Intune.

Current app shape:

- The production Node process serves the React UI and API from one origin.
- The default production port is `3001`.
- The app uses Microsoft Entra sign-in through MSAL React.

## Recommended dry-run architecture

```text
Existing Android phone or tablet
  -> install Intune Company Portal from Google Play
  -> enroll with Android Enterprise work profile
  -> Microsoft Entra sign-in
  -> Conditional Access checks Intune compliance
  -> Entra Application Proxy external URL
  -> Private Network Connector
  -> http://<dev-machine-or-dev-vm>:3001
```

Use this for the dry run only. The connector must be able to reach the dev app
over your private network, but the production Ubuntu server is not involved.

For this app, the cleanest dry run is to build the React UI and run the same
single-origin Node process that production will use. That avoids Vite dev-server
ports and CORS differences while still keeping the test pointed at a dev host.

## Microsoft Entra SSO for the React app

The app now uses Microsoft Authentication Library (MSAL) for React instead of
the old local username form. Company Portal/Intune gets the Android device and
Chrome into the managed company context, but the web app still needs its own
Microsoft Entra app registration so it can trust Microsoft sign-ins.

### Production app registration

In Microsoft Entra admin center:

1. Go to **Identity > Applications > App registrations**.
2. Open the MSwebapp registration with client ID
   `ddacbbb5-d415-458d-8132-761d07714425`, or create it if it does not exist.
3. Supported account types: **Accounts in this organizational directory only**.
4. Redirect URI platform: **Single-page application (SPA)**.
5. Production redirect URI:

   ```text
   https://app.msiwebapp.com
   ```

6. Select **Save**.
7. Copy these two values from the app registration overview:
   - **Application (client) ID**
   - **Directory (tenant) ID**
8. Go to **Authentication** and confirm the SPA redirect URI above exists.
9. Leave implicit grant unchecked for this React/MSAL setup. MSAL uses the
   authorization-code flow with PKCE for single-page apps.

The committed production build env is `client/.env.production`:

```bash
VITE_AZURE_CLIENT_ID=ddacbbb5-d415-458d-8132-761d07714425
VITE_AZURE_TENANT_ID=80ed6e92-fab4-44fb-93a5-f7da73b67333
VITE_AZURE_REDIRECT_URI=https://app.msiwebapp.com
```

For local development, create `client/.env.local` and use the same values unless
you are deliberately testing a separate Azure app registration.

Start the Vite dev server for LAN-only development:

```bash
cd /Users/jeffsnyder/Documents/MSwebapp/client
npm run dev -- --host 0.0.0.0
```

Production uses the internal DNS, internal CA, and Nginx path in
`deploy/README-ubuntu-systemd.md`. If you temporarily use a different hostname
for development, update both the Entra SPA redirect URI and
`VITE_AZURE_REDIRECT_URI`, then restart Vite.

When the app opens, it redirects to Microsoft sign-in automatically. If Chrome
has a usable Microsoft work-session, the redirect can complete silently or with
minimal prompting. If not, the user will sign in once, then later launches
should reuse the browser session.

Do not use `http://192.168.12.192:5173/` for the Android SSO test. A LAN IP over
plain HTTP is not a secure browser context, so MSAL cannot complete the browser
crypto flow required for sign-in.

### Intune Chrome SSO policy

For the Android work-profile test path, Chrome must be installed in the work
profile and assigned to the same test group as the web link app.

To improve Microsoft SSO in Chrome:

1. Go to **Microsoft Intune admin center > Devices > Configuration**.
2. Create a policy for **Android Enterprise**.
3. Use a managed Chrome app configuration/settings-catalog profile if available
   in your tenant.
4. Enable the Chrome policy named `AndroidEntraSsoEnabled`.
5. Assign it to `MSI Picker Dev Test Users`.
6. Sync the Android device from Company Portal.

Company Portal sign-in alone does not password-log-in arbitrary web apps. The
SSO chain is:

```text
Company Portal enrolls/signs in the work profile
  -> Chrome work profile receives Microsoft SSO support
  -> MSI Picker redirects to Microsoft Entra
  -> Entra returns the signed-in account to the React app
```

### App roles

The `MSI Picker Dev` Entra app registration has three user app roles:

- `Requester`: can see Request and History.
- `Picker`: can see Pick and History.
- `Auditor`: admin-style role; can see all screens.

Role assignments are issued in the Microsoft token at sign-in. After creating
or changing a user's role assignment, have that user sign out of MSI Picker and
sign back in once so the browser receives a fresh token with the `roles` claim.

## Dry-run values configured on 2026-05-31

These are the values created for this development dry run.

- Tenant: `Default Directory`
- Tenant ID: `80ed6e92-fab4-44fb-93a5-f7da73b67333`
- Verified custom domain: `msiwebapp.com`
- Original tenant domain: `forexsnyder15hotmail.onmicrosoft.com`
- Admin/test user: `msi.admin@msiwebapp.com`
- Dev access group: `MSI Picker Dev Test Users`
- Trial license: Microsoft 365 Business Premium trial
- Managed Google Play organization: `msiwebapp.com`
- Managed Google Play linked account: `forexsnyder@gmail.com`
- Android work-profile enrollment: enabled by default
- Android work-profile compliance policy:
  `MSI Android Work Profile Dev Compliance`
- Android work-profile compliance policy ID:
  `917a4eda-aa59-46be-be6c-17438b0e271d`
- Intune web link app: `MSI Picker Dev`
- Intune web link app ID: `fb721928-e045-4051-bb59-ddb1c71c29cc`
- Intune web link URL: `https://app.msiwebapp.com/`
- Intune web link assignment: available for enrolled devices, assigned to
  `MSI Picker Dev Test Users`
- Android Enterprise profile: `MSI Android Fully Managed Dev`
- Fully managed enrollment mode: corporate-owned, fully managed user devices
- Enrollment token: `RAJHUCBD`

The current no-factory-reset test path is Android Enterprise personally owned
work profile enrollment through the **Intune Company Portal** app. The
fully-managed QR/token path still exists, but it is only for reset/new devices.
Android does not allow converting an already-provisioned phone into fully
managed mode without a factory reset.

Important production note: this dev setup uses the Android Enterprise
management-only signup path linked to `forexsnyder@gmail.com`. Before production,
decide whether that Google account should remain the enterprise owner or whether
you want a shared/admin-controlled Google identity for long-term ownership.

## Prerequisites

- Microsoft Entra ID P1 or P2.
- Microsoft Intune licenses for the users/devices.
- Application Administrator role to publish the app.
- Conditional Access Administrator role to create the access policy.
- Intune Administrator role to configure Android enrollment and compliance.
- A Windows Server, Windows VM, or Windows workstation on the same private
  network as the dev app to run the Microsoft Entra private network connector.
- The dev app reachable from the connector machine at an internal URL, for
  example `http://<your-dev-machine-ip>:3001` or
  `http://msi-picker-dev.contoso.local:3001`.
- A test Entra security group, for example `MSI Picker Dev Test Users`.
- A break-glass admin account excluded from Conditional Access policies.

You can dry-run with the tenant's default `*.onmicrosoft.com` domain and the
generated `*.msappproxy.net` app URL, but this tenant now has
`msiwebapp.com` verified. Use `msiwebapp.com` for test users and keep
the generated `*.msappproxy.net` URL for the first Application Proxy test unless
you intentionally configure a custom app URL later.

Do not change the current Wix DNS mail records unless you are intentionally
moving email to Microsoft 365.

## 0. Create the bare-minimum Microsoft cloud setup

From the Azure portal home, use these portals:

- Azure portal: https://portal.azure.com
- Microsoft Entra admin center: https://entra.microsoft.com
- Microsoft Intune admin center: https://intune.microsoft.com
- Microsoft 365 admin center for licenses/users: https://admin.microsoft.com

### 0.1 Confirm or create the tenant

Your screenshot shows you already have a default directory. For a dry run, that
is enough.

If you want a cleaner tenant instead:

1. In Azure portal, go to **Microsoft Entra ID**.
2. Go to **Manage tenants**.
3. Select **Create**.
4. Choose **Microsoft Entra ID**.
5. Give it an organization name and initial domain. The initial domain will be
   something like `msipickerdev.onmicrosoft.com`.
6. Switch into that new directory from the account menu in the top right.

No public DNS domain is required.

### 0.2 Add the required trial or paid licenses

This dry run needs two capabilities:

- Microsoft Entra ID P1 or P2 for Application Proxy and Conditional Access.
- Microsoft Intune for Android enrollment and compliance.

Common paths:

- Microsoft 365 Business Premium trial or paid license.
- Enterprise Mobility + Security E3/E5.
- Separate Microsoft Entra ID P1/P2 plus Microsoft Intune Plan 1 licenses.

In Microsoft 365 admin center:

1. Go to **Billing > Purchase services**.
2. Start a trial or buy a plan that includes both Intune and Entra ID P1/P2.
3. Go to **Users > Active users**.
4. Assign the license to your admin/test user.

If Application Proxy or Conditional Access is grayed out later, the usual causes
are missing Entra ID P1/P2 licensing or the license not being assigned to the
test user.

### 0.3 Create or confirm a test user

In Microsoft Entra admin center:

1. Go to **Identity > Users > All users > New user > Create new user**.
2. Username: `picker.test`, or use the already-created admin/test account
   `msi.admin`.
3. Domain: choose `msiwebapp.com`.
4. Save the temporary password.
5. Assign the Intune/Entra-capable license to this user.
6. Sign in once as the user and set the permanent password.

The sign-in will look like:

```text
picker.test@msiwebapp.com
```

### 0.4 Create a dev access group

In Microsoft Entra admin center:

1. Go to **Identity > Groups > All groups > New group**.
2. Group type: **Security**.
3. Group name: `MSI Picker Dev Test Users`.
4. Membership type: **Assigned**.
5. Add `picker.test@msiwebapp.com` or `msi.admin@msiwebapp.com` as a
   member.
6. Create the group.

Use this group everywhere in the dry run so you do not accidentally target every
user in the tenant.

### 0.5 Decide where the connector will run

Microsoft Entra private network connector must run on Windows. It cannot run
directly on macOS or Ubuntu.

For this dry run, pick one:

- A Windows PC on the same LAN as this dev machine.
- A Windows VM on the same LAN as this dev machine.
- A Windows VM on your Mac, if it can reach the Mac host's dev app by IP.

An Azure-hosted Windows VM usually cannot reach your local Mac dev server unless
you also set up VPN/private networking, so it is not the simplest first dry run.

Before continuing, the Windows connector machine must be able to open:

```text
http://<your-dev-machine-ip>:3001/api/health
```

## 1. Start the dev app in production-like mode

From this repository on the dev machine:

```bash
npm ci
npm run build
npm run start
```

In another terminal, verify the app:

```bash
curl -s http://localhost:3001/api/health
```

Find the dev machine IP address that the connector machine can reach. On macOS,
for example:

```bash
ipconfig getifaddr en0
```

Confirm the connector machine can reach the app:

```powershell
Invoke-WebRequest http://<your-dev-machine-ip>:3001/api/health
```

If this does not return JSON with `"ok": true`, fix DNS, routing, host firewall,
or the local dev process before continuing.

For the dry run, keep this terminal running while testing Azure access.

## 2. Enroll already-provisioned Android devices

In Microsoft Intune admin center:

1. Go to **Devices > Enrollment > Android**.
2. Connect Intune to Managed Google Play if it is not already connected. For
   this dry run, Managed Google Play is already connected to organization
   `msiwebapp.com` using linked account `forexsnyder@gmail.com`.
3. Go to **Android > Personally owned devices with work profile**.
4. Confirm enrollment is enabled. The portal currently states this enrollment
   mode is enabled by default.
5. On the Android phone/tablet, install **Intune Company Portal** from the
   public Google Play Store.
6. Open Company Portal and sign in with the licensed work account, for example
   `msi.admin@msiwebapp.com` for this dev test.
7. Follow the prompts to create the Android Enterprise work profile.
8. Wait for Company Portal to finish registration and compliance checks.
9. Open the work profile app drawer. Work apps normally have the briefcase/work
   badge.

This path does not factory reset the device. It creates a separate work profile
next to the user's existing personal profile.

Optional factory-reset-only path:

- Profile: `MSI Android Fully Managed Dev`
- Token: `RAJHUCBD`
- Portal location: **Devices > Enrollment > Android > Corporate-owned, fully
  managed user devices > MSI Android Fully Managed Dev > Token**

Use the QR/token only for new or reset devices. Do not use it for existing
phones/tablets if the goal is no factory reset.

## 3. Create an Android compliance policy

In Microsoft Intune admin center:

1. Go to **Devices > Compliance policies > Create policy**.
2. Platform: **Android Enterprise**.
3. Profile type: **Personally-owned work profile**.
4. For this dev run, use the already-created policy
   `MSI Android Work Profile Dev Compliance`.
5. Confirm these settings:
   - Rooted devices: **Block**
   - Google Play Services is configured: **Require**
   - Up-to-date security provider: **Require**
   - Require encryption of data storage on device: **Require**
   - Require a password to unlock mobile devices: **Require**
   - Minimum security patch level: **Not configured**
   - Device threat level: **Not configured**
   - Play Integrity verdict: **Not configured**
6. Assign the policy to `MSI Picker Dev Test Users`.
7. Keep the default noncompliance action: mark device noncompliant immediately.
8. Wait until the test phone shows **Compliant** in Intune.

## 3.1 Make a work-profile browser available

For the web app, users need a browser inside the work profile. Use Managed
Google Play apps:

1. In Intune, go to **Apps > All apps > Create**.
2. Platform: **Android**.
3. Category: **Store app**.
4. App type: **Managed Google Play app**.
5. Search for **Google Chrome** or **Microsoft Edge**.
6. Select the app, approve it if prompted, and sync Managed Google Play.
7. Open the app record in Intune and assign it to
   `MSI Picker Dev Test Users`.
8. For dev, choose **Available for enrolled devices** if you want the user to
   install it from the work Play Store, or **Required** if you want Intune to
   install it automatically after enrollment.

During this dry run, the embedded Managed Google Play selector displayed both
Microsoft Edge and Google Chrome, but the Select button did not complete from
the remote-controlled browser session. This was retried after Chrome
third-party-cookie/pop-up settings were adjusted, and the behavior was the same:
the Managed Google Play page loads, search works, the app detail page opens, but
the Select button does not return the app to Intune.

If that repeats, do not block the whole dry run on this step. Continue with
Company Portal enrollment first, verify the device becomes compliant, and use
the browser already available inside the work profile for the first access test.
Then retry the managed browser app assignment from a fresh Chrome or Edge
profile, or from a different admin workstation. This failure appears isolated to
the embedded Google Play selector callback, not to the Intune tenant, the custom
domain, or Android work-profile enrollment.

## 3.2 Add the dev app as an Android web link

Because the embedded Managed Google Play app selector was blocked during the dry
run, an Intune **Web link** app was created as a shortcut to the dev app.

Configured app:

- Name: `MSI Picker Dev`
- Publisher: `MSI Web App`
- App type: `WebApp`
- App ID: `fb721928-e045-4051-bb59-ddb1c71c29cc`
- App URL: `https://app.msiwebapp.com/`
- Require a managed browser: `No`
- Featured app: `No`
- Assignment: **Available for enrolled devices**
- Assigned group: `MSI Picker Dev Test Users`

To recreate it:

1. In Intune, go to **Apps > All apps > Create**.
2. Platform: **Android**.
3. Category: **Web link**.
4. App type: **Web apps**.
5. Name: `MSI Picker Dev`.
6. Description: `Development shortcut to the MSI Picker web app.`
7. Publisher: `MSI Web App`.
8. App URL: `https://app.msiwebapp.com/`.
9. Require a managed browser to open this link: **No**.
10. Assign it as **Available for enrolled devices** to
    `MSI Picker Dev Test Users`.
11. Create the app.

This is now a production shortcut. It opens `app.msiwebapp.com`, which must be
reachable through internal DNS on the LAN/VPN or through Microsoft Entra Private
Access. It does not depend on a LAN IP or a Vite dev server.

## 4. Install the Microsoft Entra private network connector

On the Windows connector machine:

1. Sign in to the Microsoft Entra admin center as an Application Administrator.
2. Go to **Entra ID > Enterprise apps > Application proxy**.
3. Download and install the Microsoft Entra private network connector.
4. Register the connector during setup with the target tenant.
5. Verify the connector appears as active.

Keep the connector machine online. The connector initiates outbound TLS
connections to Microsoft, so no inbound internet firewall rule is required for
the app.

## 5. Publish the app with Entra Application Proxy

In Microsoft Entra admin center:

1. Go to **Entra ID > Enterprise applications > New application**.
2. Select **Add an on-premises application**.
3. Configure:
   - Name: `MSI Picker Dev`
   - Internal URL: `http://<your-dev-machine-ip>:3001`
   - External URL: use the generated `msappproxy.net` URL for dev, or a custom
     domain if you already have one ready.
   - Pre Authentication: **Microsoft Entra ID**
   - Connector Group: the connector group containing your active connector.
4. Save.
5. Open the created Enterprise Application.
6. Go to **Users and groups** and assign only the dev test group.

Do not use passthrough preauthentication for this goal. Passthrough skips Entra
sign-in and Conditional Access cannot enforce the compliant-device requirement.

## 6. Create the Conditional Access policy

In Microsoft Entra admin center:

1. Go to **Entra ID > Conditional Access > Policies > New policy**.
2. Name: `CA - MSI Picker Dev - Android compliant devices only`.
3. Users:
   - Include: the dev test group.
   - Exclude: break-glass admin accounts.
4. Target resources:
   - Include: **Select apps**.
   - Select the `MSI Picker Dev` Enterprise Application.
5. Conditions:
   - Device platforms: include **Android**.
   - Client apps: include **Browser**. Include **Mobile apps and desktop
     clients** too if you later wrap this as a managed app or WebView.
6. Grant:
   - Select **Grant access**.
   - Require **Device to be marked as compliant**.
   - Optionally also require MFA for dev admins.
7. Start with **Report-only**.
8. Test with the Conditional Access **What If** tool and a real enrolled Android
   phone.
9. Switch policy state to **On** after the test result is correct.

Important: if you have broader Conditional Access policies that apply to all
cloud apps on Android browsers, exclude the **Microsoft Intune** cloud app where
needed so Android enrollment can complete.

## 7. Test from an Android phone

1. On the Android test phone, install **Intune Company Portal** from Google
   Play.
2. Sign in with the licensed work account, for example
   `msi.admin@msiwebapp.com`.
3. Let Company Portal create the Android work profile.
4. Wait until the device is compliant in Company Portal and Intune.
5. In the work profile, install or open the managed browser app.
6. Browse to the Application Proxy external URL.
7. Sign in with the assigned work account.
8. Confirm the app loads.
9. Open the app's internal login screen and enter the picker username.
10. Create a test pick ticket and verify the API calls succeed.
11. In Entra sign-in logs, confirm the Conditional Access policy result is
    success and the device is compliant.

Negative tests:

- A non-enrolled Android phone should be blocked.
- An enrolled but noncompliant Android phone should be blocked.
- A user outside the assigned dev group should be blocked.
- Direct access to `http://<server>:3001` should not be reachable from networks
  where users are expected to use the proxy.

## 8. Dev rollback

To temporarily disable remote access:

1. Open the `MSI Picker Dev` Enterprise Application.
2. Set Application Proxy maintenance mode, or remove user/group assignments.
3. Leave the app server running for LAN-only dev testing.

To fully remove the dev setup:

1. Disable or delete the Conditional Access policy.
2. Delete the Enterprise Application.
3. Uninstall the private network connector if no other apps use it.

## 9. Move the tested setup to production later

After the dry run works, repeat the publish step with a separate production
Enterprise Application that points to the Ubuntu server's internal production
URL, for example `http://msi-picker-prod.contoso.local:3001`.

Keep these separate:

- Enterprise Application: `MSI Picker Dev` vs. `MSI Picker Prod`.
- Conditional Access policy: dev policy in report-only first, production policy
  staged separately.
- User/group assignment: a small dev group first, production groups only after
  sign-in logs prove the policy behaves correctly.
- Internal URL: dev machine IP/DNS for dry run, Ubuntu server DNS/IP for
  production.

Do not repoint the dev Enterprise Application at production. Creating a separate
production app keeps sign-in logs, rollback, and Conditional Access testing much
cleaner.

## Production hardening backlog

For production, Application Proxy is a useful outer gate, but the app should also
validate identity at the application/API layer. Recommended follow-up work:

- Keep Microsoft Entra sign-in wired through MSAL.
- Validate access tokens on the Express API.
- Store the Entra user display name or UPN as the picker identity.
- Add role/group checks for admin endpoints instead of relying only on
  `ADMIN_TOKEN`.
- Serve the internal app over HTTPS if the connector-to-app network is not fully
  trusted.
- Restrict direct LAN access to the Node port so users cannot bypass Entra.

## Microsoft references

- Microsoft Entra Application Proxy overview:
  https://learn.microsoft.com/en-us/entra/identity/app-proxy/overview-what-is-app-proxy
- Add an on-premises app with Application Proxy:
  https://learn.microsoft.com/en-us/entra/identity/app-proxy/application-proxy-add-on-premises-application
- Intune Android Enterprise corporate-owned enrollment:
  https://learn.microsoft.com/en-us/intune/device-enrollment/android/ref-corporate-methods
- Android fully managed enrollment:
  https://learn.microsoft.com/en-us/intune/intune-service/enrollment/android-fully-managed-enroll
- Android Enterprise compliance settings:
  https://learn.microsoft.com/en-us/intune/device-security/compliance/ref-android-enterprise-settings
- Use Conditional Access with Intune compliance:
  https://learn.microsoft.com/en-us/intune/intune-service/protect/conditional-access
- Conditional Access planning:
  https://learn.microsoft.com/en-us/entra/identity/conditional-access/plan-conditional-access
