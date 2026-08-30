#!/bin/sh
set -eu

base_url="https://raw.githubusercontent.com/Maxy747/NILAVUS/main/agent-v2"

curl -4 -fsSL "$base_url/storage_telemetry_push.py" -o /tmp/storage_telemetry_push.py
install -m 0755 /tmp/storage_telemetry_push.py /opt/nilavu-dashboard/telemetry_push.py

curl -4 -fsSL "$base_url/install-nas-forward.sh" -o /tmp/install-nas-forward.sh
sh /tmp/install-nas-forward.sh

curl -4 -fsS --max-time 8 http://192.168.1.72:8765/api/node >/dev/null

systemctl restart nilavu-telemetry.timer
systemctl start nilavu-telemetry.service
systemctl start nilavu-dosimeter-forward.service

echo "Storage mapping corrected and both cloud heartbeats were sent."
