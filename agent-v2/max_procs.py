"""Which apps use the most CPU and memory on each machine: now, and over the last 24 hours.

Dosimeter is read directly (nilavus_top, M.A.X. runs there); NASig through its metrics agent's
GET /api/top. A background thread saves both every 5 minutes to procs.jsonl in M.A.X.'s state
directory and keeps 24 hours, so M.A.X. can say what's been busy, not just what's busy now.
"""
import json
import os
import threading
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import nilavus_top

NAS_TOP_URL = os.environ.get("MAX_NAS_TOP_URL", "http://192.168.1.81:8765/api/top")
TIMEZONE = ZoneInfo(os.environ.get("MAX_TIMEZONE", "Asia/Kolkata"))
EVERY_SECONDS = 300
KEEP_SECONDS = 86400
FRESH_SECONDS = 60  # a reading this recent is reused instead of sampling again

_lock = threading.Lock()
_latest = {}  # node -> (monotonic time, reading)


def _path():
    base = os.environ.get("STATE_DIRECTORY") or os.path.expanduser("~/.local/state/nilavu-max")
    return os.path.join(base, "procs.jsonl")


def _read_nas():
    with urllib.request.urlopen(NAS_TOP_URL, timeout=5) as response:
        return json.load(response)


def current(node):
    """Latest reading for 'nilavus' or 'nilavus-storage', or None if it can't be read."""
    with _lock:
        cached = _latest.get(node)
    if cached and time.monotonic() - cached[0] < FRESH_SECONDS:
        return cached[1]
    try:
        reading = nilavus_top.top_apps() if node == "nilavus" else _read_nas()
    except (OSError, ValueError):
        return None
    with _lock:
        _latest[node] = (time.monotonic(), reading)
    return reading


def _append(records):
    path = _path()
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    cutoff = time.time() - KEEP_SECONDS
    with _lock:
        try:
            with open(path, encoding="utf-8") as f:
                lines = [line for line in f.read().splitlines() if line and json.loads(line).get("t", 0) >= cutoff]
        except (FileNotFoundError, ValueError):
            lines = []
        lines += [json.dumps(r, ensure_ascii=False) for r in records]
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


def history(node):
    try:
        with open(_path(), encoding="utf-8") as f:
            rows = [json.loads(line) for line in f if line.strip()]
    except (FileNotFoundError, ValueError):
        return []
    cutoff = time.time() - KEEP_SECONDS
    return [r for r in rows if r.get("node") == node and r.get("t", 0) >= cutoff]


def run_forever():
    """Background thread: save both machines' top apps every 5 minutes."""
    while True:
        records = []
        for node in ("nilavus", "nilavus-storage"):
            reading = current(node)
            if reading:
                records.append({"t": int(time.time()), "node": node,
                                "cpu": [[a["name"], a["cpuPercent"]] for a in reading.get("cpu", [])],
                                "memory": [[a["name"], a["memoryMb"]] for a in reading.get("memory", [])]})
        if records:
            try:
                _append(records)
            except OSError as error:
                print(f"process history: {error}", flush=True)
        time.sleep(EVERY_SECONDS)


def _size(mb):
    return f"{mb / 1024:.1f} GB" if mb >= 1024 else f"{mb} MB"


def describe(node, label, brief=False):
    """(facts, rows, busiest app name or None): which apps are busiest here, now and over the past day."""
    facts, rows = [], []
    now = current(node)
    if now is None:
        facts.append(f"Per-app usage on {label} can't be read right now.")
        return facts, rows, None
    cpu = [a for a in now.get("cpu", []) if a["cpuPercent"] >= 0.5][:3]
    mem = now.get("memory", [])[:3]
    if cpu:
        facts.append(f"Top CPU on {label} right now (share of the whole machine): "
                     + ", ".join(f"{a['name']} {a['cpuPercent']:.0f}%" for a in cpu) + ".")
    else:
        facts.append(f"Nothing on {label} is using noticeable CPU right now.")
    if mem:
        facts.append(f"Top memory on {label}: " + ", ".join(f"{a['name']} {_size(a['memoryMb'])}" for a in mem) + ".")
    tag = "DOSIMETER" if node == "nilavus" else "NASIG"
    rows += [(f"{tag} TOP CPU", ", ".join(f"{a['name']} {a['cpuPercent']:.0f}%" for a in cpu) or "idle"),
             (f"{tag} TOP MEM", ", ".join(f"{a['name']} {_size(a['memoryMb'])}" for a in mem) or "—")]
    top = cpu[0]["name"] if cpu and cpu[0]["cpuPercent"] >= 5 else None
    if brief:
        return facts[:1], rows[:1], top

    past = history(node)
    if len(past) >= 3:
        totals, peak = {}, None
        for sample in past:
            for name, value in sample["cpu"]:
                totals[name] = totals.get(name, 0.0) + value
                if peak is None or value > peak[1]:
                    peak = (name, value, sample["t"])
        busiest = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:3]
        hours = (past[-1]["t"] - past[0]["t"]) / 3600
        span = "the last 24 hours" if hours >= 23 else f"the last {max(1, round(hours))} hours"
        text = f"Over {span} on {label}, CPU went mostly to " + ", ".join(
            f"{name} (avg {total / len(past):.0f}%)" for name, total in busiest)
        if peak and peak[1] >= 20:
            at = datetime.fromtimestamp(peak[2], TIMEZONE).strftime("%H:%M")
            text += f"; the biggest spike was {peak[0]} at {peak[1]:.0f}% around {at}"
        facts.append(text + ".")
        rows.append((f"{tag} 24H CPU", ", ".join(f"{name} {total / len(past):.0f}%" for name, total in busiest)))
    else:
        facts.append(f"Per-app history for {label} is still being collected (every 5 minutes).")
    return facts, rows, top
