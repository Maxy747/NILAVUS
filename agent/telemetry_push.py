#!/usr/bin/env python3
"""Push one NILAVUS node heartbeat to Supabase without third-party packages."""

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time


HEARTBEAT_URL = os.environ.get("NILAVU_HEARTBEAT_URL", "")
SECRET = os.environ.get("NILAVU_TELEMETRY_SECRET", "")


def cpu_snapshot() -> tuple[int, int]:
    fields = [int(value) for value in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
    idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
    return sum(fields), idle


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.35):
            return True
    except OSError:
        return False


def temperature_c() -> float | None:
    readings = []
    for path in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
        try:
            value = float(path.read_text().strip())
            value = value / 1000 if value > 200 else value
            if 0 < value < 130:
                readings.append(value)
        except (OSError, ValueError):
            continue
    return round(max(readings), 1) if readings else None


def collect_metrics() -> dict:
    total_before, idle_before = cpu_snapshot()
    time.sleep(0.25)
    total_after, idle_after = cpu_snapshot()
    elapsed = max(1, total_after - total_before)
    cpu_percent = round(100 * (1 - (idle_after - idle_before) / elapsed), 1)

    memory = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        memory[key] = int(value.strip().split()[0])
    memory_percent = round(100 * (1 - memory["MemAvailable"] / memory["MemTotal"]), 1)

    disk = shutil.disk_usage("/")
    return {
        "nodeName": "nilavus",
        "temperatureC": temperature_c(),
        "cpuPercent": cpu_percent,
        "memoryPercent": memory_percent,
        "diskPercent": round(100 * disk.used / disk.total, 1),
        "uptimeSeconds": int(float(Path("/proc/uptime").read_text().split()[0])),
        "load": [round(value, 2) for value in os.getloadavg()],
        "services": {
            "jellyfin": port_open(8096),
            "qbit": port_open(8080),
            "immich": port_open(2283),
            "kavita": port_open(5000),
            "navidrome": port_open(4533),
            "ubuntu": port_open(9090),
        },
    }


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


def main() -> int:
    if not HEARTBEAT_URL or not SECRET:
        print("NILAVU_HEARTBEAT_URL and NILAVU_TELEMETRY_SECRET are required", file=sys.stderr)
        return 2
    metrics = collect_metrics()
    post_heartbeat(metrics)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
