#!/usr/bin/env python3
"""Push one NILAVUS node heartbeat to Supabase without third-party packages."""

import json
import os
import socket
import sys
import urllib.request


METRICS_URL = os.environ.get("NILAVU_LOCAL_METRICS_URL", "http://127.0.0.1:3000/api/node")
HEARTBEAT_URL = os.environ.get("NILAVU_HEARTBEAT_URL", "")
SECRET = os.environ.get("NILAVU_TELEMETRY_SECRET", "")


def force_ipv4() -> None:
    """Avoid broken IPv6 routes on hosts whose IPv4 internet access works."""
    original_getaddrinfo = socket.getaddrinfo

    def ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

    socket.getaddrinfo = ipv4_getaddrinfo


def request_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> dict:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def main() -> int:
    if not HEARTBEAT_URL or not SECRET:
        print("NILAVU_HEARTBEAT_URL and NILAVU_TELEMETRY_SECRET are required", file=sys.stderr)
        return 2
    force_ipv4()
    metrics = request_json(METRICS_URL)
    request_json(
        HEARTBEAT_URL,
        data=json.dumps(metrics).encode("utf-8"),
        headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
