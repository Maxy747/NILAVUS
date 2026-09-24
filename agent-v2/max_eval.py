#!/usr/bin/env python3
"""Graded end-to-end check of a running M.A.X. core: python3 max_eval.py [http://127.0.0.1:8098]

The suite deliberately uses the production rate limits. If another request (or this
17-case suite) fills the sliding window, it waits for that window instead of failing.

Every expectation is computed from live /context, so it stays valid as telemetry changes.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8098").rstrip("/")


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as response:
        return json.load(response)


def chat(body):
    for attempt in range(2):
        request = urllib.request.Request(BASE + "/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        done, first, started = {}, None, time.time()
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                for raw in response:
                    line = raw.decode().strip()
                    if not line.startswith("data: "):
                        continue
                    event = json.loads(line[6:])
                    if event["type"] == "token" and first is None:
                        first = time.time() - started
                    if event["type"] in ("done", "error"):
                        done = event
            return done, first
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt:
                raise
            print("Rate-limit window reached; waiting 61 seconds before continuing ...", flush=True)
            time.sleep(61)
    raise RuntimeError("unreachable")


ctx = get("/context")
crit = [d for d in ctx["storage"] if d.get("level") in ("warning", "critical")]  # drives that need a mention
has = lambda *words: lambda a: all(w.lower() in a.lower() for w in words)  # noqa: E731
mentions_critical = (lambda a: all(d["name"].lower() in a.lower() for d in crit)) if crit else (lambda a: True)
hot = max((n for n in ctx["nodes"] if ctx["nodes"][n].get("temperatureC") is not None),
          key=lambda n: ctx["nodes"][n]["temperatureC"])
hot_word = {"nilavus": "dosimeter", "nilavus-storage": "nas"}[hot]
not_down = lambda a: not re.search(r"\b(offline|down|not working)\b", a.lower())  # noqa: E731

CASES = [
    ({"action": "status"}, "status action mentions critical drive", mentions_critical),
    ({"action": "nas"}, "NAS action mentions its critical drive", mentions_critical),
    ({"action": "services"}, "services action: all up", not_down),
    ({"action": "storage"}, "storage action mentions critical drive", mentions_critical),
    ({"action": "docker"}, "docker is honestly not monitored", has("monitor")),
    ({"action": "network"}, "network: NASig reachable", has("nasig")),
    ("How is the server?", "overview names the critical drive", mentions_critical),
    ("Is NASig okay?", "NAS question flags critical drive", mentions_critical),
    ("How much storage do I have left?", "storage question flags critical drive", mentions_critical),
    ("Is Immich running?", "Immich up", lambda a: "immich" in a.lower() and not_down(a)),
    ("What's using the most resources?", "honest about per-process", has("process")),
    ("Are there any alerts?", "alerts listed", mentions_critical),
    ("Why is the server slow?", "load answer", lambda a: bool(a)),
    ("What services are offline?", "none offline", lambda a: bool(re.search(r"\b(no|none|all)\b", a.lower()))),
    ("What changed since yesterday?", "honest about history", has("history")),
    ("Which server is running hotter?", "hotter machine correct", lambda a: hot_word in a.lower()),
    ("Suggest a name for a cat.", "answers, no server talk", lambda a: not re.search(r"\b(nas|server|nilavus|dosimeter)\b", a.lower())
     and not re.search(r"no information|can't|cannot", a.lower())),
]

passed = 0
times = []
for request, label, expect in CASES:
    body = request if isinstance(request, dict) else {"messages": [{"role": "user", "content": request}]}
    result, first = chat(body)
    answer = result.get("answer") or result.get("error", "")
    ok = result.get("type") == "done" and expect(answer)
    passed += ok
    times.append(result.get("seconds", 0))
    tag = "PASS" if ok else "FAIL"
    fixed = " (guard fixed)" if result.get("corrected") else ""
    print(f"{tag} {label}{fixed} | first word {first or 0:.1f}s, total {result.get('seconds', 0):.1f}s\n     {answer[:220]}")
print(f"\nSCORE {passed}/{len(CASES)} | average {sum(times) / len(times):.1f}s per answer")
