"""Daily report: at midnight (Max's time zone) summarise the day that just ended, from the
saved telemetry history, and append it to daily.jsonl in M.A.X.'s state directory.

Runs inside M.A.X. core as a background thread, so a report exists every day even if nobody
opens the site. The sentence matches the dashboard's "Past 24 hours" line (DaySummary.tsx).
"""
import json
import os
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

HISTORY_URL = os.environ.get("MAX_HISTORY_URL", "https://gibzoyvvmwvprkubfhvc.supabase.co/functions/v1").rstrip("/")
TIMEZONE = ZoneInfo(os.environ.get("MAX_TIMEZONE", "Asia/Kolkata"))
NODES = ("nilavus", "nilavus-storage")
TEMP_WARN = 75                 # matches max_core / telemetry.ts
GAP_SECONDS = 180              # a gap over 3 minutes means no readings (same rule as the graphs)
QUIET_WORTH_MENTIONING = 15 * 60
KEEP_DAYS = 60

_lock = threading.Lock()


def _path():
    base = os.environ.get("STATE_DIRECTORY") or os.path.expanduser("~/.local/state/nilavu-max")
    return os.path.join(base, "daily.jsonl")


def _fetch(kind):
    with urllib.request.urlopen(f"{HISTORY_URL}/{kind}-history", timeout=20) as response:
        return json.load(response).get("nodes", {})


def _samples(nodes, name, start, end, field):
    out = []
    for s in nodes.get(name) or []:
        try:
            t = datetime.fromisoformat(s["sampled_at"].replace("Z", "+00:00")).timestamp()
        except (KeyError, ValueError):
            continue
        if start <= t <= end and isinstance(s.get(field), (int, float)):
            out.append((t, float(s[field])))
    return sorted(out)


def _quiet(times, start, end):
    edges = [start, *times, end]
    return sum(b - a for a, b in zip(edges, edges[1:]) if b - a > GAP_SECONDS)


def _duration(seconds):
    minutes = round(seconds / 60)
    return f"{minutes // 60} h{f' {minutes % 60} min' if minutes % 60 else ''}" if minutes >= 60 else f"{minutes} min"


def summarise(temperature, resource, start, end):
    sentences = []
    quiet = []
    for name in NODES:
        temps = _samples(temperature, name, start, end, "temperature_c")
        cpu = _samples(resource, name, start, end, "cpu_percent")
        if not temps and not cpu:
            sentences.append(f"{name} has no readings for the day.")
            continue
        text = name
        if temps:
            values = sorted(v for _, v in temps)
            peak_t, peak = max(temps, key=lambda p: p[1])
            pick = lambda p: values[min(len(values) - 1, max(0, round(p * (len(values) - 1))))]
            if peak >= TEMP_WARN:
                at = datetime.fromtimestamp(peak_t, TIMEZONE).strftime("%H:%M")
                text += f" mostly ran {round(pick(.1))}–{round(pick(.9))}°C but spiked to {round(peak)}°C around {at}"
            else:
                text += f" stayed between {round(values[0])} and {round(values[-1])}°C"
        if cpu:
            average = round(sum(v for _, v in cpu) / len(cpu))
            text += (" while mostly idle" if temps else " was mostly idle") if average < 5 else \
                (f" at {average}% CPU on average" if temps else f" averaged {average}% CPU")
        sentences.append(text + ".")
        missing = _quiet([t for t, _ in (cpu or temps)], start, end)
        if QUIET_WORTH_MENTIONING <= missing < end - start:
            quiet.append((name, missing))
    if not quiet:
        sentences.append("Both reported all day.")
    elif len(quiet) == 1:
        sentences.append(f"{quiet[0][0]} went quiet for about {_duration(quiet[0][1])} in total.")
    else:
        sentences.append(f"{quiet[0][0]} went quiet for about {_duration(quiet[0][1])} in total, "
                         f"{quiet[1][0]} for about {_duration(quiet[1][1])}.")
    return " ".join(sentences)


def write_report(day):
    """Summarise `day` (a date in TIMEZONE) and append it, unless it's already there."""
    start = datetime.combine(day, datetime.min.time(), TIMEZONE).timestamp()
    end = start + 86400
    # The saved history only reaches back 24 hours: once the start of the day has aged out, a
    # report would be missing hours and wrongly say the machines "went quiet". Skip it instead.
    if time.time() - start > 86400 + 1800:
        return None
    if any(r.get("date") == day.isoformat() for r in reports(KEEP_DAYS)):
        return None
    text = summarise(_fetch("temperature"), _fetch("resource"), start, end)
    record = {"date": day.isoformat(), "text": text, "generatedAt": datetime.now(TIMEZONE).isoformat(timespec="seconds")}
    with _lock:
        path = _path()
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        try:
            with open(path, encoding="utf-8") as f:
                lines = f.read().splitlines()[-(KEEP_DAYS - 1):]
        except FileNotFoundError:
            lines = []
        lines.append(json.dumps(record, ensure_ascii=False))
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    return record


def reports(limit=14):
    with _lock:
        try:
            with open(_path(), encoding="utf-8") as f:
                lines = f.read().splitlines()[-limit:]
        except FileNotFoundError:
            return []
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out[::-1]  # newest first


def run_forever():
    """Background thread: write yesterday's report now if missing, then again just after each midnight."""
    while True:
        now = datetime.now(TIMEZONE)
        try:
            write_report((now - timedelta(days=1)).date())
        except (OSError, ValueError) as error:
            print(f"daily report: {error}", flush=True)
            time.sleep(600)  # history unreachable: try again in 10 minutes
            continue
        midnight = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), TIMEZONE)
        time.sleep(max(60, (midnight - now).total_seconds() + 120))  # 00:02, after the last readings land
