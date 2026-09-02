#!/bin/sh
set -eu

base_url="https://raw.githubusercontent.com/Maxy747/NILAVUS/main/agent-v2"

curl -4 -fsSL "$base_url/storage_telemetry_push.py" -o /tmp/storage_telemetry_push.py
install -m 0755 /tmp/storage_telemetry_push.py /opt/nilavu-dashboard/storage_telemetry_push.py

curl -4 -fsSL "$base_url/nilavu-storage-telemetry.service" -o /tmp/nilavu-storage-telemetry.service
install -m 0644 /tmp/nilavu-storage-telemetry.service /etc/systemd/system/nilavu-storage-telemetry.service

# Remove the legacy cross-host publisher. Each server now owns its heartbeat,
# so restarting NASig cannot change the nilavus laptop status.
systemctl disable --now nilavu-dosimeter-forward.timer 2>/dev/null || true
systemctl stop nilavu-dosimeter-forward.service 2>/dev/null || true
systemctl disable --now nilavu-telemetry.timer 2>/dev/null || true
systemctl stop nilavu-telemetry.service 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now nilavu-storage-telemetry.service

echo "Storage telemetry now self-recovers after network and power outages."
systemctl --no-pager --full status nilavu-storage-telemetry.service || true
