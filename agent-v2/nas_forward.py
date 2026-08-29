#!/usr/bin/env python3
"""Forward Dosimeter's LAN metrics through NASig's working cloud path."""

import json
import os
import subprocess
import urllib.request


METRICS_URL = os.environ.get("DOSIMETER_METRICS_URL", "http://192.168.1.72:8765/api/node")
HEARTBEAT_URL = os.environ.get("NILAVU_HEARTBEAT_URL", "https://nilavus.mazinworlds.workers.dev/heartbeat")
SECRET = os.environ.get("NILAVU_TELEMETRY_SECRET", "")


def main():
    if not SECRET:
        raise RuntimeError("NILAVU_TELEMETRY_SECRET is missing")
    with urllib.request.urlopen(METRICS_URL, timeout=8) as response:
        payload = json.load(response)
    payload["nodeName"] = "nilavus"
    result = subprocess.run(
        [
            "/usr/bin/curl", "-4", "--fail-with-body", "--silent", "--show-error",
            "--connect-timeout", "15", "--max-time", "30", "-X", "POST", HEARTBEAT_URL,
            "-H", f"Authorization: Bearer {SECRET}",
            "-H", "Content-Type: application/json", "--data-binary", "@-",
        ],
        input=json.dumps(payload).encode(),
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"cloud heartbeat failed with curl exit {result.returncode}")


if __name__ == "__main__":
    main()
