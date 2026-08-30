#!/usr/bin/env python3
"""Publish Dosimeter's own LAN metrics without depending on NASig."""

import json
import os
import subprocess
import urllib.request


METRICS_URL = os.environ.get("DOSIMETER_METRICS_URL", "http://127.0.0.1:8765/api/node")
HEARTBEAT_URL = os.environ.get("DOSIMETER_HEARTBEAT_URL", "https://nilavus.mazinworlds.workers.dev/heartbeat")
SECRET = os.environ.get("NILAVU_TELEMETRY_SECRET", "")


def main() -> None:
    if not SECRET:
        raise RuntimeError("NILAVU_TELEMETRY_SECRET is missing")

    with urllib.request.urlopen(METRICS_URL, timeout=8) as response:
        payload = json.load(response)
    payload["nodeName"] = "nilavus"

    errors = []
    for address in (None, "104.21.28.141", "172.67.170.219"):
        command = [
            "/usr/bin/curl", "-4", "--fail-with-body", "--silent", "--show-error",
            "--connect-timeout", "8", "--max-time", "15", "-X", "POST", HEARTBEAT_URL,
            "-H", f"Authorization: Bearer {SECRET}",
            "-H", "Content-Type: application/json", "--data-binary", "@-",
        ]
        if address:
            command[1:1] = ["--resolve", f"nilavus.mazinworlds.workers.dev:443:{address}"]
        result = subprocess.run(
            command,
            input=json.dumps(payload).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode == 0:
            return
        errors.append(result.stderr.decode("utf-8", errors="replace").strip())

    raise RuntimeError("standalone heartbeat failed: " + " | ".join(errors))


if __name__ == "__main__":
    main()
