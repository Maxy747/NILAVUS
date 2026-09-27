"""Read only SMART lifetime hours; never wake standby disks or run self-tests.

Cache per mounted volume for 15 minutes, including unavailable results. Publish
only hours + sampling time: serial numbers and other SMART details stay local.
"""
import json
import os
import subprocess
import time
from pathlib import Path

CACHE = Path('/run/nilavus-smart-runtime.json')


def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=6, check=False)


def power_on_hours(path):
    try:
        records = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    except (OSError, ValueError):
        records = {}
    now = int(time.time())
    cached = records.get(path, {})
    if 0 <= now - cached.get('checked', 0) < 900:
        return cached.get('result', {})
    result = {}
    try:
        if not os.path.ismount(path):
            return result
        source = run(['findmnt', '-n', '-o', 'SOURCE', '--target', path]).stdout.strip()
        devices = run(['lsblk', '-s', '-r', '-n', '-p', '-o', 'NAME,TYPE', source]).stdout.splitlines()
        disks = [line.split()[0] for line in devices if len(line.split()) == 2 and line.split()[1] == 'disk']
        if len(disks) != 1:
            return result  # Do not guess with multi-device / virtual storage.
        response = run(['/usr/sbin/smartctl', '-A', '-j', '-n', 'standby', disks[0]])
        data = json.loads(response.stdout)
        hours = data.get('power_on_time', {}).get('hours')
        if isinstance(hours, int) and not isinstance(hours, bool) and 0 <= hours <= 1000000:
            result = {'powerOnHours': hours, 'powerOnSampledEpoch': now}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass  # SMART availability must not interrupt normal telemetry.
    finally:
        records[path] = {'checked': now, 'result': result}
        try:
            temporary = CACHE.with_suffix('.tmp')
            temporary.write_text(json.dumps(records))
            temporary.replace(CACHE)
        except OSError:
            pass
    return result


def enrich(drives, mounts):
    for drive in drives:
        if drive.get('online') and drive.get('name') in mounts:
            drive.update(power_on_hours(mounts[drive['name']]))
