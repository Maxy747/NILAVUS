#!/bin/sh
# Add GET /api/top (which apps use the most CPU and memory) to NASig's metrics agent, so M.A.X.
# can answer per-app questions about the NAS. Read-only, same LAN-only listener as /api/node.
#
#   scp agent-v2/nilavus_top.py agent-v2/install-nas-top.sh root@NASig:/tmp/ && ssh root@NASig sh /tmp/install-nas-top.sh
#
# Idempotent. Backs up metrics_server.py first and restores it if the agent doesn't come back.
set -eu
DIR=/opt/nilavu-dashboard
AGENT=$DIR/metrics_server.py
SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
install -m 0644 "$SRC/nilavus_top.py" "$DIR/nilavus_top.py"

if ! grep -q '"/api/top"' "$AGENT"; then
  cp -p "$AGENT" "$AGENT.before-top"
  python3 - "$AGENT" <<'PY'
import sys
path = sys.argv[1]
s = open(path, encoding="utf-8").read()
imports = "from urllib.parse import urlparse\n"
route = '        if path == "/api/status":\n'
assert s.count(imports) == 1 and s.count(route) == 1, "metrics_server.py layout changed; not patching"
s = s.replace(imports, imports + "\ntry:  # which apps use the most CPU/memory (GET /api/top), for M.A.X.\n    import nilavus_top\nexcept ImportError:\n    nilavus_top = None\n")
s = s.replace(route, '        if path == "/api/top" and nilavus_top:\n            self.send_json(nilavus_top.top_apps())\n            return\n' + route)
open(path, "w", encoding="utf-8").write(s)
PY
  python3 -m py_compile "$AGENT"
fi

systemctl restart nilavu-metrics.service
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 5 http://192.168.1.81:8765/api/top >/dev/null 2>&1 && curl -fsS -m 5 http://192.168.1.81:8765/api/node >/dev/null 2>&1; then
    echo "NASig agent serves /api/top and /api/node."
    exit 0
  fi
  sleep 1
done
echo "Agent didn't come back; restoring the previous version." >&2
[ -f "$AGENT.before-top" ] && cp -p "$AGENT.before-top" "$AGENT"
systemctl restart nilavu-metrics.service
exit 1
