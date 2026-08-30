#!/bin/sh
set -eu

base_url="https://raw.githubusercontent.com/Maxy747/NILAVUS/main/agent-v2"

systemctl disable --now nilavu-telemetry.timer 2>/dev/null || true
systemctl stop nilavu-telemetry.service 2>/dev/null || true

if [ -f /etc/nilavu-telemetry.env ]; then
  cp -p /etc/nilavu-telemetry.env /etc/nilavu-telemetry.env.disabled
fi

if [ ! -f /etc/nilavu-telemetry.env ] && [ -f /etc/nilavu-telemetry.env.disabled ]; then
  cp -p /etc/nilavu-telemetry.env.disabled /etc/nilavu-telemetry.env
fi

curl -4 -fsSL "$base_url/dosimeter_metrics.py" -o /tmp/dosimeter_metrics.py
curl -4 -fsSL "$base_url/nilavu-dosimeter-metrics.service" -o /tmp/nilavu-dosimeter-metrics.service
curl -4 -fsSL "$base_url/dosimeter_cloud_push.py" -o /tmp/dosimeter_cloud_push.py
curl -4 -fsSL "$base_url/nilavu-dosimeter-cloud.service" -o /tmp/nilavu-dosimeter-cloud.service
curl -4 -fsSL "$base_url/nilavu-dosimeter-cloud.timer" -o /tmp/nilavu-dosimeter-cloud.timer
install -m 0755 /tmp/dosimeter_metrics.py /opt/nilavu-dashboard/dosimeter_metrics.py
install -m 0644 /tmp/nilavu-dosimeter-metrics.service /etc/systemd/system/nilavu-dosimeter-metrics.service
install -m 0755 /tmp/dosimeter_cloud_push.py /opt/nilavu-dashboard/dosimeter_cloud_push.py
install -m 0644 /tmp/nilavu-dosimeter-cloud.service /etc/systemd/system/nilavu-dosimeter-cloud.service
install -m 0644 /tmp/nilavu-dosimeter-cloud.timer /etc/systemd/system/nilavu-dosimeter-cloud.timer

systemctl daemon-reload
systemctl enable nilavu-dosimeter-metrics.service
systemctl restart nilavu-dosimeter-metrics.service
systemctl enable nilavu-dosimeter-cloud.timer
systemctl restart nilavu-dosimeter-cloud.timer
systemctl start nilavu-dosimeter-cloud.service
echo "Dosimeter now publishes its own cloud heartbeat every 30 seconds."
