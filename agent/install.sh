#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

install -d -m 0755 /opt/nilavu-dashboard
install -m 0755 "$PACKAGE_DIR/telemetry_push.py" /opt/nilavu-dashboard/telemetry_push.py
install -m 0600 "$PACKAGE_DIR/nilavu-telemetry.env" /etc/nilavu-telemetry.env
install -m 0644 "$PACKAGE_DIR/nilavu-telemetry.service" /etc/systemd/system/nilavu-telemetry.service
install -m 0644 "$PACKAGE_DIR/nilavu-telemetry.timer" /etc/systemd/system/nilavu-telemetry.timer

systemctl daemon-reload
systemctl enable --now nilavu-telemetry.timer
systemctl start nilavu-telemetry.service

echo "Telemetry agent installed."
systemctl --no-pager --full status nilavu-telemetry.service || true

