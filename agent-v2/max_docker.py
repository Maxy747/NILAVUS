"""Authenticated fixed-operation PC bridge client, with short status caching."""
import json
import threading
import time
import urllib.request
from pathlib import Path

CONFIG_PATH = Path('/home/dosimeter/.config/nilavus-pc-bridge.json')
LOCK = threading.Lock()
CACHE = (0, None)
LAST_START = 0

def config():
    try:
        return json.loads(CONFIG_PATH.read_text())
    except (OSError, ValueError):
        return {}

def call(path, post=False):
    c = config()
    if not c.get('url') or not c.get('token'):
        raise ValueError('PC bridge is not configured')
    request = urllib.request.Request(c['url'] + path, data=b'' if post else None,
                                     headers={'Authorization': 'Bearer ' + c['token']})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)

def status():
    global CACHE
    with LOCK:
        if time.monotonic() - CACHE[0] < 10 and CACHE[1] is not None:
            return dict(CACHE[1])
        try:
            data = call('/status')
        except Exception:
            data = {'reachable': False, 'engine': None, 'workers': [], 'starting': False,
                    'error': 'PC worker bridge unreachable. The PC must be awake, signed in and on Tailscale.'}
        CACHE = (time.monotonic(), data)
        return dict(data)

def start():
    global LAST_START, CACHE
    with LOCK:
        if time.monotonic() - LAST_START < 30:
            raise ValueError('Please wait 30 seconds before another start request.')
        LAST_START = time.monotonic()
        response = call('/start', True)
        CACHE = (0, None)
        return response

def allowed(peer, forwarded, user):
    # The backend binds loopback only. Identity headers are trusted exclusively
    # from local Tailscale Serve, which strips client-supplied identity headers.
    return (peer in ('127.0.0.1', '::1') and bool(forwarded) and
            bool(config().get('owner')) and user == config()['owner'])
