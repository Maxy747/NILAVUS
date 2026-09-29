"""Private PC bridge. Only two fixed workers; never exposes the Docker socket.

Run as the Windows user who owns Docker Desktop. Config is outside the repo.
Bind only to a Tailscale IP, require Dosimeter's source IP AND a random token.
"""
import hmac
import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WORKERS = ('immich_pc_microservices', 'immich_machine_learning')
LOCK = threading.Lock()
STARTING = False
RESULT = None
CONFIG = {}

def docker(*args, timeout=12):
    return subprocess.run([CONFIG['docker'], *args], capture_output=True, text=True,
                          timeout=timeout, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

def status():
    result = {'reachable': True, 'engine': None, 'workers': [], 'starting': STARTING,
              'result': RESULT, 'checkedAt': time.time()}
    try:
        # A successful engine probe distinguishes missing containers from stopped Docker.
        result['engine'] = docker('info', '--format', '{{.ServerVersion}}').returncode == 0
        if result['engine']:
            # Inspect separately to preserve names if a container is missing.
            for name in WORKERS:
                item = docker('inspect', name, '--format', '{{json .State}}')
                s = json.loads(item.stdout) if item.returncode == 0 else {}
                result['workers'].append({'name': name, 'state': s.get('Status', 'missing'),
                                          'health': s.get('Health', {}).get('Status')})
    except (OSError, subprocess.TimeoutExpired, ValueError):
        result['error'] = 'Docker status check timed out or failed.'
    return result

def start_workers():
    global STARTING, RESULT
    try:
        if docker('info', '--format', '{{.ServerVersion}}').returncode != 0:
            docker('desktop', 'start', timeout=120)
        failures = []
        for name in WORKERS:
            item = docker('inspect', name, '--format', '{{.State.Status}}')
            if item.returncode != 0:
                failures.append(name + ': missing; not recreated')
            elif item.stdout.strip() in ('created', 'exited'):
                if docker('start', name, timeout=90).returncode != 0:
                    failures.append(name + ': start failed; check storage and server availability')
            elif item.stdout.strip() != 'running':
                failures.append(name + ': ' + item.stdout.strip() + '; left unchanged')
        RESULT = '; '.join(failures) if failures else 'Start request completed. Check worker health below.'
    except (OSError, subprocess.TimeoutExpired):
        RESULT = 'Start attempt timed out or failed. Check Docker Desktop on the PC.'
    finally:
        STARTING = False
        LOCK.release()

class Handler(BaseHTTPRequestHandler):
    def reply(self, code, payload):
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self):
        return (self.client_address[0] == CONFIG['peer'] and
                hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + CONFIG['token']))

    def do_GET(self):
        if not self.authorized():
            return self.reply(403, {'error': 'Forbidden'})
        if self.path != '/status':
            return self.reply(404, {'error': 'Not found'})
        self.reply(200, status())

    def do_POST(self):
        global STARTING, RESULT
        if not self.authorized():
            return self.reply(403, {'error': 'Forbidden'})
        if self.path != '/start':
            return self.reply(404, {'error': 'Not found'})
        if not LOCK.acquire(blocking=False):
            return self.reply(409, {'error': 'Already starting'})
        STARTING, RESULT = True, None
        threading.Thread(target=start_workers, daemon=True).start()
        self.reply(202, {'accepted': True})

    def log_message(self, *_args):
        pass

if __name__ == '__main__':
    CONFIG = json.loads(Path(sys.argv[1]).read_text())
    if len(CONFIG['token']) < 32 or not CONFIG['bind'].startswith('100.'):
        raise SystemExit('Require a strong token and a private Tailscale bind address')
    while True:
        try:
            ThreadingHTTPServer((CONFIG['bind'], 8096), Handler).serve_forever()
        except OSError:
            time.sleep(15)  # Tailscale may not yet be ready at Windows login.
