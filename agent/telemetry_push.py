#!/usr/bin/env python3
"""Push one NILAVUS node heartbeat to Supabase without third-party packages."""

import json
import os
import subprocess
import sys
import urllib.request


METRICS_URL = os.environ.get("NILAVU_LOCAL_METRICS_URL", "http://127.0.0.1:3000/api/node")
HEARTBEAT_URL = os.environ.get("NILAVU_HEARTBEAT_URL", "")
SECRET = os.environ.get("NILAVU_TELEMETRY_SECRET", "")


def post_heartbeat(metrics: dict) -> None:
    """Use curl's proven IPv4/TLS path for the outbound heartbeat."""
    result = subprocess.run(
        [
            "/usr/bin/curl",
            "-4",
            "--fail-with-body",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "15",
            "--max-time",
            "25",
            "-X",
            "POST",
            HEARTBEAT_URL,
            "-H",
            f"Authorization: Bearer {SECRET}",
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
        ],
        input=json.dumps(metrics).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"heartbeat failed: {message}")


def request_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> dict:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def main() -> int:
    if not HEARTBEAT_URL or not SECRET:
        print("NILAVU_HEARTBEAT_URL and NILAVU_TELEMETRY_SECRET are required", file=sys.stderr)
        return 2
    metrics = request_json(METRICS_URL)
    post_heartbeat(metrics)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
