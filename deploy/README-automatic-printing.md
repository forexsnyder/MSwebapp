# Automatic pick-ticket printing (Ubuntu + CUPS)

Automatic printing is disabled by default. A new request creates one durable print job in the same SQLite transaction as the ticket, only while enabled. Existing tickets are not backfilled. No picker assignment or open browser is required. Reopening a ticket does not create a second print. Manual browser printing and picker notifications remain available.

## 1. Configure the printer on the Ubuntu host

The HP LaserJet P2055dn supports JetDirect port 9100. Use a static address or DHCP reservation. Direct printing does not require joining Ubuntu to Active Directory. Keep printer traffic on the trusted internal network: JetDirect is not encrypted. Do not expose CUPS or port 9100 to the internet.

Substitute your printer's queue name and IP below. Keep internal addresses in local configuration, not the public repository.

```bash
sudo apt update
sudo apt install cups cups-client printer-driver-hpcups fonts-dejavu-core netcat-openbsd
sudo systemctl enable --now cups
nc -vz <PRINTER_IP> 9100
lpinfo -m | grep -i p2055
```

Printer administration should use an authorized Ubuntu administrator account, not the app service account or a newly enabled root password. On the standard Ubuntu CUPS policy, an administrator can grant the named account the `lpadmin` role using `sudo usermod -aG lpadmin <ADMIN_USER>`, then reconnect to SSH to refresh group membership. If CUPS uses a custom `SystemGroup`, inspect that policy first. The command below explicitly selects that account with `-U`; any authentication prompt should request its Ubuntu password. The driver-deprecation warning is informational for current CUPS, but plan a supported replacement before upgrading to a CUPS version without legacy drivers.

Choose the exact P2055dn driver identifier from `lpinfo -m`. Do not use `-m everywhere` with a `socket://` URI and do not configure a raw PDF queue; CUPS must render PDFs for this printer.

```bash
lpadmin -U <ADMIN_USER> -h /run/cups/cups.sock -p <QUEUE_NAME> -E -v socket://<PRINTER_IP>:9100 -m '<DRIVER_IDENTIFIER>' \
  -o printer-is-shared=false -o media=Letter -o sides=one-sided \
  -o printer-error-policy=stop-printer
sudo -u jeff lpstat -h localhost -a <QUEUE_NAME>
sudo -u jeff lpstat -h localhost -p <QUEUE_NAME>
```

The `stop-printer` policy avoids blind transport retries after a printer failure. An operator must inspect the printer/queue and resume it with `sudo cupsenable <QUEUE_NAME>` when safe. Do not grant the app sudo or printer administration rights.

## 2. Deploy and test before enabling

Back up SQLite, deploy the app, run `npm ci` and `npm run build`, and restart `mswebapp` as usual. The new table is created automatically. Run only one app service against the database; recovery assumes exclusive service ownership.

Generate a fictional sample without accessing real data:

```bash
cd /opt/mswebapp
node server/print-sample.js /tmp/msi-print-test.pdf
sudo -u jeff lp -h localhost -d <QUEUE_NAME> -n 1 -o media=Letter -o sides=one-sided \
  -o job-sheets=none -- /tmp/msi-print-test.pdf
```

This last command physically prints a multi-page sample. Confirm letter landscape layout, all columns, lot quantity spaces, and repeated headers. Submit just one sample initially.

## 3. Enable in a systemd drop-in

Use `sudo systemctl edit mswebapp` and add:

```ini
[Service]
Environment=AUTO_PRINT_ENABLED=true
Environment=CUPS_PRINTER=<QUEUE_NAME>
```

Then `sudo systemctl daemon-reload` and `sudo systemctl restart mswebapp`. Open Pick and confirm the configured queue is shown. Create one clearly marked test request. Verify one CUPS receipt and one paper ticket, then close/cancel that test ticket as appropriate.

To disable, set `AUTO_PRINT_ENABLED=false` and restart. This pauses the worker and stops new jobs being created, but does not cancel jobs already accepted by CUPS. Pending app jobs resume if re-enabled and still open; close/cancel unwanted tickets before re-enabling. Use the CUPS tools to cancel already submitted jobs.

## Status and recovery

- **Queued / preparing:** not yet submitted. Pre-submission failures retry up to three attempts with increasing delay. Selected-ticket status explains when a retry is pending.
- **Submitted:** CUPS returned a job ID. This is not confirmation that paper came out. Check `lpstat -h localhost -p <QUEUE_NAME>` and `lpstat -h localhost -W not-completed -o <QUEUE_NAME>` for offline/paused jobs.
- **Failed:** safe preparation retries were exhausted. Repair the setup, then use the existing **Print ticket** button. There is no automatic resend after this state.
- **Uncertain:** the app lost the result during submission or restarted at that point. Do not blindly reprint. Check CUPS job title `MSI-TICKET-<ticket ID>-JOB-<job ID>`, CUPS job history, and the physical printer first.
- **Skipped:** the ticket was closed/cancelled before submission. Closing/deleting a ticket after CUPS acceptance does not cancel its spooler job.

The application prevents duplicate automatic queue entries and does not resend an accepted/ambiguous submission. No distributed printing system can guarantee exactly one physical copy across all printer/network failures. Manual Print ticket intentionally remains capable of printing another copy.

Snapshots include the request-time quantities, descriptions, locations, and available lots. PDF files are temporary (owner-only permissions) and removed after submission; CUPS and SQLite retain their own records. Apply normal client-data retention and backup rules. `PRINT_FONT_PATH` may override the default Unicode font if necessary. The queue name comes only from server configuration; the browser cannot select arbitrary destinations or commands.

## Checks

```bash
node --test server/picker-notifications.test.js server/print-worker.test.js
npm run build
```

Tests use isolated databases and mocked CUPS calls, never a real printer. Real hardware and network verification must be completed on site.

References: [HP P2050 series user guide](https://h10032.www1.hp.com/ctg/Manual/c01461642.pdf), [CUPS network printing](https://openprinting.github.io/cups/doc/network.html), [CUPS printer administration](https://openprinting.github.io/cups/doc/man-lpadmin.html).
