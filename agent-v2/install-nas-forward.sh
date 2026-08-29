#!/bin/sh
set -eu

base_url="https://raw.githubusercontent.com/Maxy747/NILAVUS/main/agent-v2"

curl -4 -fsSL "$base_url/nas_forward.py" -o /tmp/nas_forward.py
curl -4 -fsSL "$base_url/nilavu-dosimeter-forward.service" -o /tmp/nilavu-dosimeter-forward.service
curl -4 -fsSL "$base_url/nilavu-dosimeter-forward.timer" -o /tmp/nilavu-dosimeter-forward.timer
install -m 0755 /tmp/nas_forward.py /opt/nilavu-dashboard/nas_forward.py
install -m 0644 /tmp/nilavu-dosimeter-forward.service /etc/systemd/system/nilavu-dosimeter-forward.service
install -m 0644 /tmp/nilavu-dosimeter-forward.timer /etc/systemd/system/nilavu-dosimeter-forward.timer

systemctl daemon-reload
systemctl enable --now nilavu-dosimeter-forward.timer
systemctl start nilavu-dosimeter-forward.service
echo "NASig is now forwarding Dosimeter telemetry."
