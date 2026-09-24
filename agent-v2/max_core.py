#!/usr/bin/env python3
"""M.A.X. core (Machine-Assisted eXecutive): the conversational layer of NILAVUS on Dosimeter.

Design: code reads real telemetry and works out the facts; a small local model only
phrases them (a 3B model got 1/6 right choosing tools itself, 12/12 this way).

  GET  /health   -> provider, model, endpoint, whether the AI core is reachable/loaded
  GET  /context  -> structured live context (nodes, services, storage, network, alerts)
  POST /chat     -> text/event-stream of {"type": "meta" | "token" | "done" | "error", ...}
                    body: {"messages": [{"role": "user"|"assistant", "content": "..."}],
                           "action": optional quick action}

The AI only runs when Max asks something. With the default llama.cpp provider the model
process starts on demand and stops after MAX_IDLE_SECONDS. Listens on localhost only;
Tailscale Funnel publishes it openly at https://<host>/ai; /chat is rate-limited and
queue-capped so nobody can monopolise the i3. Standard library only.
"""

import ctypes
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser("~")
env = os.environ.get

# ------------------------------------------------------------------ config
# MAX_PROVIDER: "llamacpp" (managed llama-server, default), "ollama", or "openai"
# (any OpenAI-compatible server). Model names always come from the environment.
PROVIDER = env("MAX_PROVIDER", "llamacpp")
LLAMA_SERVER = env("MAX_LLAMA_SERVER", f"{HOME}/llm/llama-b11149/llama-server")
LLAMA_MODEL = env("MAX_LLAMA_MODEL", f"{HOME}/llm/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf")
LLAMA_THREADS = env("MAX_LLAMA_THREADS", "2")  # 2 of the i3's 4 threads; 4 is much slower
LLAMA_PORT = int(env("MAX_LLAMA_PORT", "8099"))
OLLAMA_BASE_URL = env("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = env("OLLAMA_MODEL", "")
OPENAI_BASE_URL = env("OPENAI_BASE_URL", "").rstrip("/")
OPENAI_MODEL = env("OPENAI_MODEL", "")
OPENAI_API_KEY = env("OPENAI_API_KEY", "")
IDLE_SECONDS = int(env("MAX_IDLE_SECONDS", "600"))
PORT = int(env("MAX_PORT", "8098"))
# M.A.X. is public through Tailscale Funnel at https://<host>/ai (open, no key), so the
# rate limit and queue cap below are what keep the i3 from being monopolised.
PATH_PREFIX = env("MAX_PATH_PREFIX", "/ai").rstrip("/")
RATE_PER_MINUTE = int(env("MAX_RATE_PER_MINUTE", "10"))  # across everyone; protects the i3
MAX_WAITING = 2            # questions allowed to queue behind the one being answered
HISTORY_TURNS = 4          # recent messages sent to the model; more = slower on the i3
MAX_MESSAGE = 600
ALLOWED_ORIGINS = set(filter(None, env("MAX_ORIGINS", ",".join([
    "https://maxy747.github.io",               # GitHub Pages
    "https://nilavus.mazinworlds.workers.dev",  # Cloudflare Worker
    "https://nilavus.whydah-darter.ts.net",     # Dosimeter
    "http://localhost:5173",                    # local dev
])).split(",")))

METRICS = {
    "nilavus": "http://127.0.0.1:8765/api/node",
    "nilavus-storage": "http://192.168.1.81:8765/api/node",
}
ROLES = {"nilavus": "Dosimeter, the services laptop", "nilavus-storage": "NASig, the storage NAS"}
DRIVES = (("Dosimeter", "/"), ("WD 1 TB", "/mnt/nas"), ("Bookussy", "/mnt/bookus"))
DRIVE_HOST = {"Dosimeter": "nilavus", "WD 1 TB": "nilavus-storage", "Bookussy": "nilavus-storage"}  # physical location
SERVICES = {  # telemetry key -> (name, what it is, host, tailnet link)
    "jellyfin": ("Jellyfin", "movies and TV app", "nilavus", "https://nilavus.whydah-darter.ts.net/jelly"),
    "immich": ("Immich", "photos app", "nilavus", "https://nilavus.whydah-darter.ts.net:8443/"),
    "qbit": ("qBittorrent", "downloads app", "nilavus", "https://nilavus.whydah-darter.ts.net/qbit/"),
    "kavita": ("Kavita", "books and comics app", "nilavus", "https://nilavus.whydah-darter.ts.net/kavita/"),
    "navidrome": ("Navidrome", "music app", "nilavus", "https://nilavus.whydah-darter.ts.net/navidrome/"),
    "files": ("File Browser", "NAS files app", "nilavus-storage", "https://nilavus-storage.whydah-darter.ts.net/files/"),
    "omv": ("OpenMediaVault", "NAS admin panel", "nilavus-storage", None),
}
# Alert thresholds (the dashboard uses the same numbers).
# A big media drive at 92% still has ~300 GB free: that's a warning, not an emergency.
STORAGE_WARN, STORAGE_CRIT = 90, 98
TEMP_WARN, TEMP_CRIT = 75, 85

# ----------------------------------------------------------------- context

def fetch_json(url, timeout=4):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return json.load(response)
    except (OSError, ValueError):
        return None


def plural(count, unit):
    return f"{count} {unit}{'' if count == 1 else 's'}"


def format_uptime(seconds):
    days, rest = divmod(int(seconds), 86400)
    hours, minutes = divmod(rest // 60, 60)
    if days:
        return f"{plural(days, 'day')} {plural(hours, 'hour')}"
    return f"{plural(hours, 'hour')} {plural(minutes, 'minute')}" if hours else plural(minutes, "minute")


def storage_level(percent):
    return "critical" if percent >= STORAGE_CRIT else "warning" if percent >= STORAGE_WARN else "ok"


def build_context():
    """Structured, real telemetry only. Anything not monitored is None, never guessed."""
    raw = {name: fetch_json(url) for name, url in METRICS.items()}
    nodes = {}
    for name, m in raw.items():
        if not m:
            nodes[name] = {"online": False, "role": ROLES[name]}
            continue
        nodes[name] = {
            "online": True, "role": ROLES[name],
            "cpuPercent": m.get("cpuPercent"), "memoryPercent": m.get("memoryPercent"),
            "diskPercent": m.get("diskPercent"), "temperatureC": m.get("temperatureC"),
            "load1": (m.get("load") or [None])[0], "uptimeSeconds": m.get("uptimeSeconds"),
            "uptime": format_uptime(m["uptimeSeconds"]) if m.get("uptimeSeconds") is not None else None,
        }
    services = {}
    for key, (name, role, host, link) in SERVICES.items():
        up = bool((raw.get(host) or {}).get("services", {}).get(key))
        services[key] = {"name": name, "role": role, "host": host, "online": up, "link": link if up else None}
    storage = []
    for name, path in DRIVES:
        try:
            if not os.path.ismount(path):
                storage.append({"name": name, "online": False})
                continue
            usage = shutil.disk_usage(path)
            used = round(100 * usage.used / usage.total, 1)
            storage.append({"name": name, "online": True, "usedPercent": used, "freeGb": round(usage.free / 1e9),
                            "totalGb": round(usage.total / 1e9), "level": storage_level(used)})
        except OSError:
            storage.append({"name": name, "online": False})

    alerts = []
    for name, node in nodes.items():
        if not node["online"]:
            alerts.append({"level": "critical", "source": name, "message": f"{name} is unreachable."})
        elif (node.get("temperatureC") or 0) >= TEMP_WARN:
            level = "critical" if node["temperatureC"] >= TEMP_CRIT else "warning"
            alerts.append({"level": level, "source": name, "message": f"{name} is running hot at {node['temperatureC']:.0f}C."})
    for drive in storage:
        if drive.get("online") and drive["level"] != "ok":
            alerts.append({"level": drive["level"], "source": drive["name"], "category": "storage",
                           "message": f"{drive['name']} storage is at {drive['usedPercent']}%."})
        elif not drive.get("online"):
            alerts.append({"level": "warning", "source": drive["name"], "category": "storage",
                           "message": f"{drive['name']} is not mounted."})
    for service in services.values():
        if not service["online"] and nodes[service["host"]]["online"]:
            alerts.append({"level": "warning", "source": service["name"], "message": f"{service['name']} is offline."})

    for alert in alerts:
        alert.setdefault("category", "system")

    def worst(category):
        # Storage has its own status so a full media drive doesn't make the whole system "critical".
        levels = {a["level"] for a in alerts if a["category"] == category}
        return "CRITICAL" if "critical" in levels else "WARNING" if levels else "NORMAL"

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "telemetry": any(n["online"] for n in nodes.values()),
        "status": worst("system"), "storageStatus": worst("storage"),
        "nodes": nodes, "services": services, "storage": storage, "alerts": alerts,
        # Reachability from Dosimeter is all we know about the network today.
        "network": {"nasigReachable": nodes["nilavus-storage"]["online"]},
        # TODO: not exposed by the telemetry agents yet. Add to dosimeter_metrics.py
        # (e.g. `docker ps` summary, top processes) and these light up automatically.
        "docker": None, "topProcesses": None, "history": None,
    }

# --------------------------------------------------- facts ("code thinks")

FRIENDLY = {"nilavus": "Dosimeter (the laptop)", "nilavus-storage": "NASig (the NAS)"}
LABEL = {"nilavus": "DOSIMETER", "nilavus-storage": "NASIG"}
SHORT = {"nilavus": ("dosimeter", "laptop"), "nilavus-storage": ("nasig", "nas")}
APP_ALIASES = {
    "jellyfin": "jellyfin", "movies": "jellyfin", "immich": "immich", "photos": "immich", "photo": "immich",
    "qbittorrent": "qbit", "qbit": "qbit", "torrent": "qbit", "torrents": "qbit", "downloads": "qbit",
    "kavita": "kavita", "books": "kavita", "comics": "kavita", "navidrome": "navidrome", "music": "navidrome",
    "filebrowser": "files", "files": "files", "omv": "omv", "openmediavault": "omv",
}
STATUS_WORDS = {"online", "offline", "everything", "down", "ok", "okay", "status", "working", "alive", "healthy", "doing", "fine"}
TEMP_WORDS = {"hot", "hotter", "temp", "temperature", "heat", "warm", "warmer", "cool", "cooler"}
UPTIME_WORDS = {"uptime", "reboot", "rebooted", "restart", "restarted"}
DRIVE_WORDS = {"full", "space", "storage", "disk", "drive", "drives", "bookussy", "wd", "capacity", "free", "left"}
LOAD_WORDS = {"cpu", "memory", "ram", "load", "slow", "resources", "busy", "usage"}
ALERT_WORDS = {"alert", "alerts", "warning", "warnings", "problem", "problems", "issue", "issues", "wrong"}
UNMONITORED = {  # word -> honest answer until the integration exists
    "docker": "Docker/container status isn't monitored by NILAVUS yet.",
    "container": "Docker/container status isn't monitored by NILAVUS yet.",
    "containers": "Docker/container status isn't monitored by NILAVUS yet.",
    "process": "Per-process usage isn't tracked by NILAVUS yet, only totals per machine.",
    "processes": "Per-process usage isn't tracked by NILAVUS yet, only totals per machine.",
    "yesterday": "NILAVUS doesn't keep telemetry history yet, so it can't compare with earlier.",
    "changed": "NILAVUS doesn't keep telemetry history yet, so it can't compare with earlier.",
    "backup": "Backups aren't monitored by NILAVUS yet.",
    "backups": "Backups aren't monitored by NILAVUS yet.",
}
SERVER_TOPIC = (STATUS_WORDS | TEMP_WORDS | UPTIME_WORDS | DRIVE_WORDS | LOAD_WORDS | ALERT_WORDS
                | set(APP_ALIASES) | set(UNMONITORED)
                | {"server", "servers", "nas", "nasig", "laptop", "dosimeter", "nilavus", "running", "network", "services"})
NEGATIVE = re.compile(r"\b(not|isn't|isnt|down|unavailable|offline)\b")
# Word an honest "not monitored" answer must contain.
UNMONITORED_KEY = {text: key for text, key in [
    ("Docker/container status isn't monitored by NILAVUS yet.", "monitor"),
    ("Per-process usage isn't tracked by NILAVUS yet, only totals per machine.", "process"),
    ("NILAVUS doesn't keep telemetry history yet, so it can't compare with earlier.", "history"),
    ("Backups aren't monitored by NILAVUS yet.", "monitor"),
]}


def denies_problems(answer):
    """False if the answer claims there's nothing wrong ("No critical or warning conditions")."""
    return not re.search(r"\b(no|not any|without)\b[^.]*\b(critical|warning|warnings|issues?|problems?|alerts?|concerns?)\b",
                         answer.lower())


def claims_something_down_is_false(answer):
    """False if the answer says something is offline/down, but "no services are offline" is fine."""
    for sentence in re.split(r"[.!?]", answer.lower()):
        if re.search(r"\b(offline|down|not online)\b", sentence) and not re.search(r"\b(no|none|nothing|not any|zero)\b", sentence):
            return False
    return True

ACTIONS = {  # quick action -> the question it answers (routing below is deterministic)
    "status": "How is the system doing?",
    "nas": "How is NASig doing?",
    "services": "Which services are online?",
    "storage": "How much storage is left?",
    "docker": "What is the Docker status?",
    "network": "How is the network?",
    "alerts": "Are there any alerts?",
    "dosimeter": "How is Dosimeter doing?",
    "temps": "Which machine is hotter, and what are the temperatures?",
    "uptime": "How long have the machines been running?",
    "load": "How busy are the machines (CPU, memory, load)?",
    "links": "What are the links to my apps?",
}
# Quick actions that reuse the keyword routing: they answer with exactly these topic words.
ACTION_WORDS = {
    "temps": {"which", "hotter", "temperature"},
    "uptime": {"uptime"},
    "load": {"cpu", "memory", "load"},
}


def cap(text):
    return text[0].upper() + text[1:]


def which_nodes(words, q):
    if words & {"laptop", "dosimeter"} or re.search(r"\bnilavus\b(?!-)", q):
        return ["nilavus"]
    if words & {"nas", "nasig"} or "nilavus-storage" in q or "storage pc" in q:
        return ["nilavus-storage"]
    return list(METRICS)


def pct(value):
    return "—" if value is None else f"{value:.0f}%"


def node_rows(name, node, full=True):
    label = LABEL[name]
    if not node["online"]:
        return [(label, "OFFLINE")]
    rows = [(f"{label} CPU", pct(node["cpuPercent"])), (f"{label} MEM", pct(node["memoryPercent"])),
            (f"{label} DISK", pct(node["diskPercent"]))]
    if full:
        rows += [(f"{label} TEMP", "—" if node["temperatureC"] is None else f"{node['temperatureC']:.0f}C"),
                 (f"{label} UPTIME", node["uptime"] or "—")]
    return rows


def build_facts(question, ctx, action=None):
    """Returns (facts for the model, [(fact index, guard check)], rows the UI renders as a stat block)."""
    q = question.lower()
    words = set(re.findall(r"[a-z0-9]+", q))
    facts, checks, rows = [], [], []

    def check(test, contradiction=False):
        # Each guard check is tied to the fact it verifies (the one just added). A failed
        # "mention" check means the model left that fact out (we append it); a failed
        # contradiction check means it said the opposite (we replace its answer).
        checks.append((len(facts) - 1, test, contradiction))
    if action is None and not words & SERVER_TOPIC:
        return facts, checks, rows
    if not ctx["telemetry"]:
        facts.append("Telemetry is unavailable: M.A.X. cannot read any live system information right now.")
        return facts, checks, [("TELEMETRY", "UNAVAILABLE")]

    nodes, services = ctx["nodes"], ctx["services"]
    added = set()
    if action:
        words = set(ACTION_WORDS.get(action, ()))  # a quick action answers only its own topic
    machine_action = {"nas": "nilavus-storage", "dosimeter": "nilavus"}.get(action)

    def add(kind):
        if kind in added:
            return False
        added.add(kind)
        return True

    if action == "docker" or words & set(UNMONITORED):
        for word, text in UNMONITORED.items():
            if (word in words or action == word) and text not in facts:
                facts.append(text)
                # Never let the model claim data NILAVUS doesn't have ("No changes since yesterday").
                check(lambda a, key=UNMONITORED_KEY[text]: key in a.lower(), contradiction=True)
        if action == "docker" or words & {"docker", "container", "containers"}:
            rows.append(("DOCKER", "NOT MONITORED"))

    app_keys = sorted({APP_ALIASES[w] for w in words if w in APP_ALIASES})
    for key in app_keys:
        s = services[key]
        facts.append(f"{s['name']}, your {s['role']}, is {'UP and working' if s['online'] else 'DOWN (not working)'}"
                     f" (runs on {FRIENDLY[s['host']]})." + (f" Link: {s['link']}" if s["link"] else ""))
        check(lambda a, up=s["online"]: not NEGATIVE.search(a.lower()) if up else bool(NEGATIVE.search(a.lower())),
              contradiction=True)
        if s["link"] and "link" in words:
            check(lambda a, link=s["link"]: link in a)
        rows.append((s["name"].upper(), "ONLINE" if s["online"] else "OFFLINE"))

    def add_overview():
        if not add("overview"):
            return
        down = [n for n, node in nodes.items() if not node["online"]]
        down_apps = [s["name"] for s in services.values() if not s["online"]]
        facts.append("OFFLINE: " + ", ".join(FRIENDLY[n] for n in down) + "." if down
                     else "Both machines (Dosimeter and NASig) are online.")
        facts.append(f"Services offline: {', '.join(down_apps)}." if down_apps else "All monitored services are up.")
        if not down and not down_apps:
            check(claims_something_down_is_false, contradiction=True)
        facts.append(f"System status: {ctx['status']}. Storage status: {ctx['storageStatus']}."
                     + (" Active alerts: " + " ".join(a["message"] for a in ctx["alerts"]) if ctx["alerts"] else " No active alerts."))
        if ctx["alerts"]:
            # "Everything is normal" while an alert is active: the answer must name what's wrong.
            check(lambda a, names=[a_["source"].lower() for a_ in ctx["alerts"]]: any(n in a.lower() for n in names))
            check(denies_problems, contradiction=True)
        for name, node in nodes.items():
            rows.extend(node_rows(name, node, full=False))
        rows.extend((a["level"].upper(), a["message"]) for a in ctx["alerts"])

    if action == "status" or (not app_keys and words & STATUS_WORDS and not words & {"nas", "nasig", "laptop", "dosimeter"}):
        add_overview()

    per_node = machine_action or (words & {"nas", "nasig", "laptop", "dosimeter"} and words & (STATUS_WORDS | LOAD_WORDS))
    if per_node and add("node"):
        for name in ([machine_action] if machine_action else which_nodes(words, q)):
            node = nodes[name]
            if not node["online"]:
                facts.append(f"{cap(FRIENDLY[name])} is OFFLINE (unreachable).")
                rows += node_rows(name, node)
                continue
            facts.append(f"{cap(FRIENDLY[name])} is online: CPU {pct(node['cpuPercent'])}, memory {pct(node['memoryPercent'])}, "
                         f"load {node['load1']}, uptime {node['uptime']}.")
            rows += node_rows(name, node)
            # "Is NASig okay?" must mention its own drive problems, not just CPU and memory.
            # (The NAS quick action lists every drive in the storage section instead.)
            for d in ([] if machine_action else ctx["storage"]):
                if d.get("online") and DRIVE_HOST[d["name"]] == name and d["level"] != "ok":
                    facts.append(f"But its {d['name']} drive is {d['level'].upper()}: {d['usedPercent']}% used, {d['freeGb']} GB free.")
                    check(lambda a, d=d: d["name"].lower() in a.lower())
                    check(denies_problems, contradiction=True)
                    rows.append((d["name"].upper(), f"{d['usedPercent']:.0f}%  {d['level'].upper()}"))

    if (words & LOAD_WORDS) and not per_node and add("load"):
        for name, node in nodes.items():
            if node["online"]:
                facts.append(f"{cap(FRIENDLY[name])}: CPU {pct(node['cpuPercent'])}, memory {pct(node['memoryPercent'])}, load {node['load1']}.")
                rows += node_rows(name, node, full=False)[:2] + [(f"{LABEL[name]} LOAD", str(node["load1"]))]
        if words & {"slow", "resources"}:
            facts.append("Per-process usage isn't tracked yet, so M.A.X. can only see totals per machine.")
            check(lambda a: "process" in a.lower())

    if words & TEMP_WORDS:
        temps = {n: node["temperatureC"] for n, node in nodes.items() if node["online"] and node.get("temperatureC") is not None}
        if words & {"which", "hotter", "warmer", "cooler", "compare"} and len(temps) > 1:
            hot, cool = sorted(temps, key=temps.get, reverse=True)
            facts.append(f"Hotter: {FRIENDLY[hot]} at {temps[hot]:.0f}C. Cooler: {FRIENDLY[cool]} at {temps[cool]:.0f}C.")

            def hot_first(a, hot=hot, cool=cool):
                # Right if the hotter machine is named first, or the cooler one is called cooler.
                a = a.lower()
                h = min((a.find(w) for w in SHORT[hot] if w in a), default=-1)
                c = min((a.find(w) for w in SHORT[cool] if w in a), default=-1)
                named_first = h != -1 and (c == -1 or h < c)
                cooler_named = any(re.search(rf"\b{w}\w*\b[^.]*\b(cooler|colder|lower)\b", a) for w in SHORT[cool])
                return named_first or cooler_named
            check(hot_first, contradiction=True)
        else:
            for name in which_nodes(words, q):
                if name in temps:
                    facts.append(f"{cap(FRIENDLY[name])} is at {temps[name]:.0f}C.")
                    check(lambda a, t=temps[name]: f"{t:.0f}" in a)
        rows += [(f"{LABEL[n]} TEMP", f"{t:.0f}C") for n, t in temps.items()]

    if words & UPTIME_WORDS or "how long" in q or "been running" in q:
        for name in which_nodes(words, q):
            node = nodes[name]
            if not node["online"]:
                facts.append(f"{cap(FRIENDLY[name])} is offline.")
                continue
            facts.append(f"{cap(FRIENDLY[name])} has been running for {node['uptime']} (last restarted {node['uptime']} ago).")
            check(lambda a, up=node["uptime"]: up.split()[0] in a)
            rows.append((f"{LABEL[name]} UPTIME", node["uptime"]))

    if action == "services" or (words & {"services"} and not app_keys):
        for s in services.values():
            rows.append((s["name"].upper(), "ONLINE" if s["online"] else "OFFLINE"))
        down = [s["name"] for s in services.values() if not s["online"]]
        facts.append(f"Services offline: {', '.join(down)}." if down else f"All {len(services)} monitored services are online.")

    if action == "links":
        up = [s for s in services.values() if s["online"]]
        facts.append(f"{len(up)} of {len(services)} apps are up; their links are listed below."
                     + (" Down: " + ", ".join(s["name"] for s in services.values() if not s["online"]) + "." if len(up) < len(services) else ""))
        for key, s in services.items():
            link = SERVICES[key][3]
            rows.append((s["name"].upper(), (link or "LAN ONLY") if s["online"] else "OFFLINE"))

    if (action in ("storage", "nas", "dosimeter") or words & DRIVE_WORDS) and add("storage"):
        drives = [d for d in ctx["storage"] if d.get("online")]
        if machine_action:
            drives = [d for d in drives if DRIVE_HOST[d["name"]] == machine_action]  # that machine's own drives
        named = [d for d in drives if d["name"].lower().split()[0] in words]
        for d in named or drives:
            verdict = {"critical": f"CRITICAL (over {STORAGE_CRIT}%, nearly full)",
                       "warning": f"WARNING (over {STORAGE_WARN}%, getting full but not urgent)", "ok": "OK"}[d["level"]]
            facts.append(f"{d['name']}: {d['usedPercent']}% used, {d['freeGb']} GB free of {d['totalGb']} GB. Verdict: {verdict}.")
            # The UI shows every drive's numbers; the sentence must get the asked-about or critical ones right.
            if named or d["level"] != "ok":
                numbers = {str(d["freeGb"]), str(d["usedPercent"]), f"{d['usedPercent']:.0f}%"}  # models round
                check(lambda a, numbers=numbers: any(n in a for n in numbers))
            if d["level"] == "critical":
                check(lambda a: not re.search(r"\b(safe|no need|not worr|don't worry|nothing to worry)", a.lower()),
                      contradiction=True)
            if d["level"] != "ok":
                check(denies_problems, contradiction=True)
            rows.append((d["name"].upper(), f"{d['usedPercent']:.0f}%  {d['freeGb']} GB FREE"))

    if action == "network" or "network" in words:
        facts.append("NASig is reachable from Dosimeter over the LAN." if ctx["network"]["nasigReachable"]
                     else "NASig is NOT reachable from Dosimeter.")
        facts.append("Internet and Wi-Fi quality aren't monitored by NILAVUS yet.")
        rows.append(("NASIG LINK", "ONLINE" if ctx["network"]["nasigReachable"] else "OFFLINE"))

    if action == "alerts" or words & ALERT_WORDS:
        alerts = ctx["alerts"]
        facts.append("No active alerts." if not alerts else "Active alerts: " + " ".join(a["message"] for a in alerts))
        rows += [(a["level"].upper(), a["message"]) for a in alerts] or [("ALERTS", "NONE")]

    if not facts:
        # A server question no specific topic matched ("How is the server?"): give the model
        # the overview rather than nothing, so it never has to guess.
        add_overview()
    return facts, checks, rows


SYSTEM_PROMPT = (
    "You are M.A.X. (Machine-Assisted eXecutive), the built-in intelligence of NILAVUS, "
    "Max's personal home-server system. You are talking to Max. Be calm, concise and competent, "
    "with an occasionally dry wit; never gushing, no emojis. When FACTS are given, answer only "
    "from them, keep their numbers and verdicts, and never invent values or features. If something "
    "isn't monitored, say so plainly. Don't promise to watch, notify or do anything; you can only answer. "
    "Without FACTS, just answer Max's question helpfully and don't mention the servers. "
    "Reply in 1-3 short sentences. No lists; the interface shows the numbers separately."
)
JUNK = re.compile(r"FACTS|Verdict:|^\s*\d+\.\s*\d+\.|^\d+, \d+", re.M)

# --------------------------------------------------------------- providers

def die_with_parent():
    """Runs in the child before exec: the kernel kills llama-server if its parent goes away.
    Note the "parent" is the creating *thread*, so the process must be spawned from a thread
    that lives as long as M.A.X. core (see LlamaCppProvider._spawner), not a request thread."""
    ctypes.CDLL("libc.so.6", use_errno=True).prctl(1, signal.SIGTERM)  # 1 = PR_SET_PDEATHSIG


class OpenAICompatibleProvider:
    """Any server with /v1/chat/completions streaming (llama.cpp, LM Studio, vLLM, OpenAI...)."""
    name = "openai"

    def __init__(self, base_url, model, api_key=""):
        self.base_url, self.model, self.api_key = base_url, model, api_key

    @property
    def endpoint(self):
        return self.base_url

    def available(self):
        return bool(self.base_url) and fetch_json(f"{self.base_url}/models", timeout=3) is not None

    def loaded(self):
        return None  # unknown for remote providers

    def prepare(self):
        if not self.base_url or not self.model:
            raise RuntimeError("OPENAI_BASE_URL and OPENAI_MODEL must be set")

    def stream(self, messages):
        self.prepare()
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = {"model": self.model, "messages": messages, "stream": True,
                "max_tokens": 250, "temperature": 0.2, "seed": 42}
        request = urllib.request.Request(f"{self.base_url}/chat/completions", data=json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(request, timeout=180) as response:
            for raw in response:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                delta = (json.loads(data).get("choices") or [{}])[0].get("delta", {}).get("content")
                if delta:
                    yield delta

    def stop(self):
        pass


class LlamaCppProvider(OpenAICompatibleProvider):
    """llama.cpp's llama-server, started on demand and stopped when idle to free ~2 GB RAM."""
    name = "llamacpp"

    def __init__(self):
        super().__init__(f"http://127.0.0.1:{LLAMA_PORT}/v1", os.path.basename(LLAMA_MODEL))
        self.proc = None
        self.lock = threading.Lock()
        self._spawn_requests = queue.Queue()
        threading.Thread(target=self._spawner, name="model-spawner", daemon=True).start()

    def _spawner(self):
        # Long-lived thread that owns llama-server, so PDEATHSIG only fires if M.A.X. core itself dies.
        while True:
            job = self._spawn_requests.get()
            try:
                job["proc"] = subprocess.Popen(
                    [LLAMA_SERVER, "-m", LLAMA_MODEL, "-t", LLAMA_THREADS, "-c", "4096", "--parallel", "1",
                     "--host", "127.0.0.1", "--port", str(LLAMA_PORT)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=die_with_parent)
            except OSError as error:
                job["error"] = error
            job["done"].set()

    def _spawn(self):
        job = {"done": threading.Event()}
        self._spawn_requests.put(job)
        job["done"].wait()
        if "error" in job:
            raise RuntimeError(f"could not start llama-server: {job['error']}")
        return job["proc"]

    def available(self):
        return os.access(LLAMA_SERVER, os.X_OK) and os.path.isfile(LLAMA_MODEL)

    def loaded(self):
        return self.proc is not None and self.proc.poll() is None

    def prepare(self):
        with self.lock:
            if self.loaded() and fetch_json(f"http://127.0.0.1:{LLAMA_PORT}/health", timeout=2) is not None:
                return
            self._stop()
            self.proc = self._spawn()
            deadline = time.time() + 90
            while time.time() < deadline:
                if self.proc.poll() is not None:
                    raise RuntimeError("llama-server exited while loading the model")
                if fetch_json(f"http://127.0.0.1:{LLAMA_PORT}/health", timeout=2) is not None:
                    return
                time.sleep(0.5)
            self._stop()
            raise RuntimeError("model took too long to load")

    def _stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None

    def stop(self):
        with self.lock:
            self._stop()


class OllamaProvider:
    """Ollama's native API. Ollama loads/unloads models itself (keep_alive)."""
    name = "ollama"

    def __init__(self, base_url, model):
        self.base_url, self.model = base_url, model

    @property
    def endpoint(self):
        return self.base_url

    def available(self):
        return fetch_json(f"{self.base_url}/api/tags", timeout=3) is not None

    def loaded(self):
        running = fetch_json(f"{self.base_url}/api/ps", timeout=3)
        return None if running is None else any(m.get("name", "").startswith(self.model) for m in running.get("models", []))

    def stream(self, messages):
        if not self.model:
            raise RuntimeError("OLLAMA_MODEL must be set")
        body = {"model": self.model, "messages": messages, "stream": True, "keep_alive": f"{IDLE_SECONDS}s",
                "options": {"temperature": 0.2, "seed": 42, "num_predict": 250}}
        request = urllib.request.Request(f"{self.base_url}/api/chat", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=180) as response:
            for raw in response:
                chunk = json.loads(raw)
                if chunk.get("message", {}).get("content"):
                    yield chunk["message"]["content"]
                if chunk.get("done"):
                    break

    def stop(self):
        pass


def make_provider():
    if PROVIDER == "ollama":
        return OllamaProvider(OLLAMA_BASE_URL, OLLAMA_MODEL)
    if PROVIDER == "openai":
        return OpenAICompatibleProvider(OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_KEY)
    return LlamaCppProvider()


AI = make_provider()
GENERATE = threading.Lock()  # one generation at a time on a 2-core CPU
last_used = time.time()


class RateLimiter:
    """Sliding one-minute window shared by all callers; stops a loop from monopolising the CPU."""

    def __init__(self, per_minute):
        self.per_minute, self.times, self.lock = per_minute, [], threading.Lock()

    def allow(self):
        with self.lock:
            now = time.time()
            self.times = [t for t in self.times if now - t < 60]
            if len(self.times) >= self.per_minute:
                return False
            self.times.append(now)
            return True


LIMITER = RateLimiter(RATE_PER_MINUTE)
waiting = threading.BoundedSemaphore(MAX_WAITING + 1)  # the running question + MAX_WAITING queued


def reap_idle():
    while True:
        time.sleep(30)
        if isinstance(AI, LlamaCppProvider) and AI.loaded() and not GENERATE.locked() and time.time() - last_used > IDLE_SECONDS:
            AI.stop()
            print("model unloaded after idle timeout", flush=True)

# ---------------------------------------------------------------------- chat

def clean_history(messages):
    history = []
    for m in messages[-HISTORY_TURNS:] if isinstance(messages, list) else []:
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str):
            history.append({"role": m["role"], "content": m["content"][:MAX_MESSAGE]})
    return history


def chat_events(messages, action):
    """Yields event dicts: meta -> token* -> done (or error)."""
    global last_used
    started = time.time()
    history = clean_history(messages)
    if action in ACTIONS:
        question = ACTIONS[action]
        history.append({"role": "user", "content": question})
    elif not history or history[-1]["role"] != "user" or not history[-1]["content"].strip():
        yield {"type": "error", "error": "last message must be a non-empty user message"}
        return
    else:
        question = history[-1]["content"].strip()
        action = None

    ctx = build_context()
    facts, checks, rows = build_facts(question, ctx, action)
    yield {"type": "meta", "rows": rows, "telemetry": ctx["telemetry"], "status": ctx["status"], "storageStatus": ctx["storageStatus"]}

    hint = "\nMention anything marked CRITICAL or WARNING." if any(w in f for f in facts for w in ("CRITICAL", "WARNING")) else ""
    prompt = history[:-1] + [{"role": "user", "content":
                              ("FACTS:\n" + "\n".join(facts) + f"\n\nQuestion: {question}{hint}") if facts else question}]
    if not waiting.acquire(blocking=False):
        yield {"type": "error", "error": "M.A.X. is busy. Try again in a moment."}
        return
    try:
        if not GENERATE.acquire(timeout=120):
            yield {"type": "error", "error": "M.A.X. is busy with another request."}
            return
        text = ""
        try:
            for piece in AI.stream([{"role": "system", "content": SYSTEM_PROMPT}] + prompt):
                text += piece
                yield {"type": "token", "text": piece}
        except (OSError, ValueError, RuntimeError, urllib.error.URLError) as error:
            yield {"type": "error", "error": f"AI core error: {error}"}
            return
        finally:
            last_used = time.time()
            GENERATE.release()
    finally:
        waiting.release()

    text = text.strip()
    def tidy(indexes):
        return " ".join(facts[i].replace("Verdict: ", "") for i in indexes)

    contradicted = sorted({i for i, test, hard in checks if hard and not test(text)})
    omitted = sorted({i for i, test, hard in checks if not hard and not test(text)} - set(contradicted))
    junk = bool(facts) and bool(JUNK.search(text))
    corrected = junk or bool(contradicted) or bool(omitted)
    if junk or contradicted:
        # The model garbled or contradicted code-computed facts: replace its answer with them.
        text = tidy(contradicted) or tidy(range(min(2, len(facts))))
    elif omitted:
        # The answer is right but incomplete: keep it and add what it left out.
        text = f"{text} {tidy(omitted)}"
    yield {"type": "done", "answer": text, "corrected": corrected, "seconds": round(time.time() - started, 1)}

# ---------------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "max-core"

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        if self.headers.get("Origin") in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")
            # Chrome asks before a public site talks to a private (tailnet) address.
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    @property
    def route(self):
        # Funnel publishes M.A.X. at https://<host>/ai (/max belongs to maximum-overdrive); accept the prefix either way.
        path = self.path.split("?", 1)[0]
        if PATH_PREFIX and (path == PATH_PREFIX or path.startswith(PATH_PREFIX + "/")):
            return path[len(PATH_PREFIX):] or "/"
        return path

    def do_GET(self):
        if self.route == "/health":
            return self._json(200, {"ok": True, "name": "M.A.X.", "provider": AI.name, "model": AI.model,
                                    "available": AI.available(), "modelLoaded": AI.loaded()})
        if self.route == "/context":
            return self._json(200, build_context())
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.route != "/chat":
            return self._json(404, {"error": "not found"})
        if not LIMITER.allow():
            return self._json(429, {"error": f"Rate limit: at most {RATE_PER_MINUTE} questions a minute."})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 16384:
                return self._json(413, {"error": "request too large"})
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._json(400, {"error": "invalid JSON"})
        action = body.get("action") if body.get("action") in ACTIONS else None

        # Server-sent events: tokens appear as the model writes them.
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            for event in chat_events(body.get("messages", []), action):
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # Max closed the console mid-answer; nothing to do

    def log_message(self, message, *args):
        return


def exit_on_sigterm(signum, frame):
    # systemctl stop/restart sends SIGTERM; a normal exit lets the finally block stop the model.
    raise SystemExit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, exit_on_sigterm)
    threading.Thread(target=reap_idle, daemon=True).start()
    print(f"M.A.X. core on 127.0.0.1:{PORT} | provider={AI.name} model={AI.model}", flush=True)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    finally:
        AI.stop()
