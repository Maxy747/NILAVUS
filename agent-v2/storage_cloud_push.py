#!/usr/bin/env python3
"""NASig's timer-driven telemetry publisher with capacity and SMART hours."""
import json
import os
import shutil
import urllib.request
from smart_runtime import enrich

DRIVES = {
    'NASig': '/',
    'WD 1 TB': '/srv/dev-disk-by-uuid-dc93b7a1-cadf-4fff-b3e1-78b1c94b5a6d',
    'Bookussy': '/srv/dev-disk-by-uuid-D67639F77639D947',
}


def request_json(url, data=None, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers or {}), timeout=10) as response:
        return json.load(response)


def drive_metric(name, path):
    try:
        if not os.path.ismount(path):
            raise OSError('not mounted')
        usage = shutil.disk_usage(path)
        return dict(name=name, online=True, usedPercent=round(100 * usage.used / usage.total, 1) if usage.total else None,
                    usedBytes=usage.used, totalBytes=usage.total)
    except OSError:
        return dict(name=name, online=False, usedPercent=None, usedBytes=None, totalBytes=None)


def main():
    url = os.environ.get('NILAVU_HEARTBEAT_URL', '')
    secret = os.environ.get('NILAVU_TELEMETRY_SECRET', '')
    if not url or not secret:
        raise RuntimeError('Telemetry URL and secret are required')
    metrics = request_json(os.environ.get('NILAVU_LOCAL_METRICS_URL', 'http://127.0.0.1:8765/api/node'))
    metrics['nodeName'] = 'nilavus-storage'
    drives = [drive_metric(name, path) for name, path in DRIVES.items()]
    enrich(drives, DRIVES)
    metrics.setdefault('services', {})['_drives'] = drives
    request_json(url, json.dumps(metrics).encode(), {'Authorization': f'Bearer {secret}', 'Content-Type': 'application/json'})


if __name__ == '__main__':
    main()
