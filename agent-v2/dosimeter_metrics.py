#!/usr/bin/env python3
"""Small LAN-only metrics endpoint for the Dosimeter host."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import socket
import time


def cpu_snapshot():
    fields = [int(value) for value in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
    return sum(fields), fields[3] + (fields[4] if len(fields) > 4 else 0)


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.25):
            return True
    except OSError:
        return False


def temperature_c():
    readings = []
    for path in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
        try:
            value = float(path.read_text().strip())
            value = value / 1000 if value > 200 else value
            if 0 < value < 130:
                readings.append(value)
        except (OSError, ValueError):
            pass
    return round(max(readings), 1) if readings else None


def metrics():
    total_before, idle_before = cpu_snapshot()
    time.sleep(0.2)
    total_after, idle_after = cpu_snapshot()
    elapsed = max(1, total_after - total_before)
    memory = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        memory[key] = int(value.strip().split()[0])
    disk = shutil.disk_usage("/")
    return {
        "nodeName": "nilavus",
        "temperatureC": temperature_c(),
        "cpuPercent": round(100 * (1 - (idle_after - idle_before) / elapsed), 1),
        "memoryPercent": round(100 * (1 - memory["MemAvailable"] / memory["MemTotal"]), 1),
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


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/node":
            self.send_error(404)
            return
        body = json.dumps(metrics()).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, message, *args):
        return


ThreadingHTTPServer(("0.0.0.0", 8765), Handler).serve_forever()
