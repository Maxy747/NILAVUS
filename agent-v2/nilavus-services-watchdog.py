#!/usr/bin/env python3
"""Restart NILAVUS apps that have been down for over an hour. Runs as root from a timer.

For each app M.A.X. knows (max_services.APPS): if it has been down for DOWN_MINUTES, restart it
once, then leave it alone for BACKOFF_HOURS so a broken app can't restart-loop. Every action is
appended to /var/lib/nilavus-services/events.jsonl, which M.A.X. reads to tell Max about it.
Separate from nilavus-recovery (SSH/Tailscale), which it never touches.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from max_services import APPS, _http_up, _unit_state  # noqa: E402  (installed side by side)

DOWN_MINUTES = 60
BACKOFF_HOURS = 6
STATE_DIR = Path("/var/lib/nilavus-services")
STATE = STATE_DIR / "state.json"
EVENTS = STATE_DIR / "events.jsonl"
EVENTS_KEEP = 200


def load_state():
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def log_event(event):
    STATE_DIR.mkdir(mode=0o755, exist_ok=True)
    lines = EVENTS.read_text(encoding="utf-8").splitlines()[-(EVENTS_KEEP - 1):] if EVENTS.exists() else []
    lines.append(json.dumps(event))
    EVENTS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    EVENTS.chmod(0o644)  # M.A.X. (user dosimeter) reads it; it holds no secrets


def restart(key, unit):
    command = (["systemctl", "restart", unit] if unit
               else ["docker", "compose", "-p", "immich", "restart"])  # existing containers only
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=300).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def main():
    now = time.time()
    state = load_state()
    for key, (name, unit, ping) in APPS.items():
        app = state.setdefault(key, {})
        if unit:
            info = _unit_state(unit)
            down = info["state"] not in ("active", "activating", "reloading")
            since = info.get("since") if down else None
        else:
            down = not _http_up(ping)
            since = app.get("down_since") or now if down else None
        app["down_since"] = since
        if not down or since is None:
            continue
        minutes = (now - since) / 60
        if minutes < DOWN_MINUTES or now - app.get("last_restart", 0) < BACKOFF_HOURS * 3600:
            continue
        ok = restart(key, unit)
        app["last_restart"] = now
        log_event({"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "app": key, "name": name,
                   "action": "auto-restart", "downMinutes": round(minutes), "ok": ok})
        print(f"{name} down {minutes:.0f} min: restart {'ok' if ok else 'FAILED'}", flush=True)
    STATE_DIR.mkdir(mode=0o755, exist_ok=True)
    STATE.write_text(json.dumps(state))


if __name__ == "__main__":
    main()
