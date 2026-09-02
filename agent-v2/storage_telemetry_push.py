#!/usr/bin/env python3
"""Enrich the NASig heartbeat with per-drive capacity before publishing it."""

import json
import os
import shutil
import sys
import time
import urllib.request
import urllib.error


METRICS_URL = os.environ.get("NILAVU_LOCAL_METRICS_URL", "http://127.0.0.1:8765/api/node")
HEARTBEAT_URL = os.environ.get("NILAVU_HEARTBEAT_URL", "")
SECRET = os.environ.get("NILAVU_TELEMETRY_SECRET", "")
INTERVAL_SECONDS = max(10, int(os.environ.get("NILAVU_TELEMETRY_INTERVAL", "30")))
RETRY_SECONDS = max(5, int(os.environ.get("NILAVU_TELEMETRY_RETRY", "10")))

DRIVES = (
    ("NASig", "/"),
    # dc93... is the 1 TB WD volume; D676... is the 4 TB Bookussy volume.
    ("WD 1 TB", "/srv/dev-disk-by-uuid-dc93b7a1-cadf-4fff-b3e1-78b1c94b5a6d"),
    ("Bookussy", "/srv/dev-disk-by-uuid-D67639F77639D947"),
)


def request_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> dict:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def drive_metric(name: str, path: str) -> dict:
    try:
        if not os.path.ismount(path):
            raise OSError(f"{path} is not mounted")
        usage = shutil.disk_usage(path)
        return {
            "name": name,
            "online": True,
            "usedPercent": round(100 * usage.used / usage.total, 1) if usage.total else None,
            "usedBytes": usage.used,
            "totalBytes": usage.total,
        }
    except OSError:
        return {
            "name": name,
            "online": False,
            "usedPercent": None,
            "usedBytes": None,
            "totalBytes": None,
        }


def publish_once() -> None:
    """Collect and publish one fresh NAS heartbeat."""
    metrics = request_json(METRICS_URL)
    # Never let an old/incorrect local identity overwrite the NAS node.
    metrics["nodeName"] = "nilavus-storage"
    services = metrics.setdefault("services", {})
    services["_drives"] = [drive_metric(name, path) for name, path in DRIVES]

    request_json(
        HEARTBEAT_URL,
        data=json.dumps(metrics).encode("utf-8"),
        headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
    )


def main() -> int:
    if not HEARTBEAT_URL or not SECRET:
        print("NILAVU_HEARTBEAT_URL and NILAVU_TELEMETRY_SECRET are required", file=sys.stderr)
        return 2

    # Stay alive through router, DNS, WAN, and local metrics restarts. systemd
    # also supervises this process, so an unexpected crash is restarted.
    while True:
        try:
            publish_once()
            print("nilavus-storage heartbeat published", flush=True)
            time.sleep(INTERVAL_SECONDS)
        except (OSError, ValueError, json.JSONDecodeError, urllib.error.URLError) as error:
            print(f"heartbeat unavailable; retrying in {RETRY_SECONDS}s: {error}", file=sys.stderr, flush=True)
            time.sleep(RETRY_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
