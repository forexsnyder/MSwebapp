# Picker notifications

The Pick screen checks for new orders and refreshes its current queue every 15 seconds and when the window regains focus. The banner uses the same appearance as requester order updates. No browser notification permission, sound, printer setup, or picker assignment is involved.

- All open, non-cancelled tickets are eligible, including existing work on first use.
- Dismiss clears the displayed alerts for the signed-in user only. It does not close or assign a ticket, or dismiss another picker's alerts.
- Dismissal is saved in SQLite and survives page reloads and server restarts.
- Requests arriving during dismissal remain unread. Completed/cancelled tickets disappear from alerts on the next check.
- Notifications are independent of the queue search and Open/Closed tab. Queue refresh preserves the selected ticket and quantities being entered.
- A previously dismissed ticket is not announced as new if it is later reopened; it still returns to the Open queue.

## Deployment

Deploy both client and server changes using the normal production update procedure, build the client with `npm run build`, and restart the server. Startup creates the `picker_notification_reads` table automatically; no manual SQL or new environment variables are required. Back up the database before updating as usual.

The Pick screen must be open for on-screen alerts to appear. Optional server-side automatic printing is configured separately; see [automatic printing](README-automatic-printing.md).

## Verification

Run `node --test server/picker-notifications.test.js` and `npm run build` from the app root. Tests use an isolated in-memory database.

With a Picker screen open, submit a request in another session and confirm the alert and queue update after the next check. Enter a lot quantity before submitting another request and verify it remains intact. Dismiss an alert, reload, and confirm it stays dismissed while the ticket remains open.
