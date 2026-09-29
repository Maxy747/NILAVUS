"""Start/restart NILAVUS apps on Dosimeter for M.A.X. Fixed operations only.

M.A.X. runs as the unprivileged `dosimeter` user. It asks systemd over D-Bus, and the polkit
rule 49-nilavus-max.rules lets that user *start* or *restart* exactly the units below: nothing
else, and never stop. Immich runs in Docker, so it gets two fixed root units
(nilavus-immich-start/-restart.service) instead of Docker access, which would be root.

Who may ask is decided in max_core (the Tailscale owner only, same rule as the PC workers).
"""
import json
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

# key (as in the dashboard/telemetry) -> (name, systemd unit, how to check it)
APPS = {
    "jellyfin": ("Jellyfin", "jellyfin.service", None),
    "kavita": ("Kavita", "kavita.service", None),
    "navidrome": ("Navidrome", "navidrome.service", None),
    "qbit": ("qBittorrent", "qbittorrent-nox@qbtuser.service", None),
    # Docker stack: health from its HTTP ping, actions through the fixed root units.
    "immich": ("Immich", None, "http://127.0.0.1:2283/api/server/ping"),
}
IMMICH_UNITS = {"start": "nilavus-immich-start.service", "restart": "nilavus-immich-restart.service"}
VERBS = ("start", "restart")
COOLDOWN_SECONDS = 60
# Written by the root watchdog (nilavus-services-watchdog.py), world-readable, no secrets.
EVENTS = Path("/var/lib/nilavus-services/events.jsonl")

_lock = threading.Lock()
_last_action = {}


def _systemctl(*args, timeout=30):
    return subprocess.run(["systemctl", "--no-ask-password", *args], capture_output=True, text=True, timeout=timeout)


def _unit_state(unit):
    try:
        out = _systemctl("show", unit, "-p", "ActiveState", "-p", "SubState", "-p", "StateChangeTimestamp",
                         "--timestamp=unix", timeout=8).stdout
    except (OSError, subprocess.TimeoutExpired):
        return {"state": "unknown"}
    fields = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    since = fields.get("StateChangeTimestamp", "").lstrip("@")
    return {"state": fields.get("ActiveState", "unknown"), "sub": fields.get("SubState"),
            "since": int(since) if since.isdigit() else None}


def _http_up(url):
    try:
        with urllib.request.urlopen(url, timeout=4) as response:
            return response.status == 200
    except OSError:
        return False


def status():
    apps = []
    for key, (name, unit, ping) in APPS.items():
        if unit:
            info = _unit_state(unit)
            up = info["state"] == "active"
        else:
            up = _http_up(ping)
            info = {"state": "active" if up else "down"}
        apps.append({"key": key, "name": name, "up": up, **info})
    return {"apps": apps, "events": recent_events()}


def recent_events(limit=10):
    try:
        lines = EVENTS.read_text(encoding="utf-8").splitlines()[-limit:]
    except OSError:
        return []
    events = []
    for line in lines:
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    return events


def act(key, verb):
    """Start or restart one app. Raises ValueError with a message for the user."""
    if key not in APPS or verb not in VERBS:
        raise ValueError("Unknown app or action.")
    name, unit, _ = APPS[key]
    with _lock:
        waited = time.monotonic() - _last_action.get(key, -COOLDOWN_SECONDS)
        if waited < COOLDOWN_SECONDS:
            raise ValueError(f"{name} was just {verb}ed. Try again in {int(COOLDOWN_SECONDS - waited)} s.")
        _last_action[key] = time.monotonic()
    target = unit or IMMICH_UNITS[verb]
    # Immich's units are oneshots that run `docker compose ... start|restart`, so "start" them either way.
    command = verb if unit else "start"
    try:
        result = _systemctl(command, target, timeout=120)
    except subprocess.TimeoutExpired:
        raise ValueError(f"{name} is taking a while to {verb}; check again in a minute.")
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise ValueError(f"Couldn't {verb} {name}: {detail[-1] if detail else 'systemctl failed'}")
    print(f"M.A.X. {verb} {name} ({target}) requested by the owner", flush=True)
    return {"ok": True, "app": key, "verb": verb, "message": f"{name}: {verb} requested."}
