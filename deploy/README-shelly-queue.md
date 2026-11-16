# Shelly pick queue indicator

Set SHELLY_QUEUE_HOST=192.168.20.104 in the app server environment and restart the app. For a systemd installation, add Environment=SHELLY_QUEUE_HOST=192.168.20.104 under [Service] in a service override, then restart mswebapp.

The plug turns on when at least one non-cancelled pick ticket is open and off when none remain. The server checks at startup and every five seconds, independently of automatic printing. Leave the setting unset to disable control.

The app server must be able to reach the plug over local HTTP. This integration uses the Shelly relay compatibility endpoint and requires local API access without authentication. If your device requires authentication, keep it enabled and configure an authenticated integration before use.
