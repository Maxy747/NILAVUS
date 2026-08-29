#!/bin/sh
set -eu

base_url="https://raw.githubusercontent.com/Maxy747/NILAVUS/main/agent-v2"

systemctl disable --now nilavu-telemetry.timer 2>/dev/null || true
systemctl stop nilavu-telemetry.service 2>/dev/null || true

if [ -f /etc/nilavu-telemetry.env ]; then
  cp -p /etc/nilavu-telemetry.env /etc/nilavu-telemetry.env.disabled
fi

curl -4 -fsSL "$base_url/dosimeter_metrics.py" -o /tmp/dosimeter_metrics.py
curl -4 -fsSL "$base_url/nilavu-dosimeter-metrics.service" -o /tmp/nilavu-dosimeter-metrics.service
install -m 0755 /tmp/dosimeter_metrics.py /opt/nilavu-dashboard/dosimeter_metrics.py
install -m 0644 /tmp/nilavu-dosimeter-metrics.service /etc/systemd/system/nilavu-dosimeter-metrics.service

systemctl daemon-reload
systemctl enable --now nilavu-dosimeter-metrics.service
echo "Dosimeter cloud sender disabled; LAN metrics available on port 8765."
