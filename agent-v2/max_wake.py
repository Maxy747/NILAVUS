"""Wake the desktop PC with a Wake-on-LAN magic packet, sent from Dosimeter on the home LAN.

A fixed operation: one known MAC address, broadcast on the local subnet only. Who may ask is
decided in max_core (the Tailscale owner, like app restarts). Whether the PC is up is checked
with plain TCP connections on the LAN (no ping, which needs privileges M.A.X. doesn't have): a
PC that accepts *or refuses* a connection is awake; one that doesn't answer at all is not.
"""
import os
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor

PC_MAC = os.environ.get("MAX_PC_MAC", "10:FF:E0:0F:C4:E2")
PC_LAN_IP = os.environ.get("MAX_PC_IP", "192.168.1.85")
BROADCAST = os.environ.get("MAX_PC_BROADCAST", "192.168.1.255")
COOLDOWN_SECONDS = 60

_lock = threading.Lock()
_last_wake = 0.0


def magic_packet(mac):
    digits = mac.replace(":", "").replace("-", "")
    if len(digits) != 12:
        raise ValueError("Bad MAC address")
    return b"\xff" * 6 + bytes.fromhex(digits) * 16


# Windows file sharing, RPC, Remote Desktop, Sunshine: something usually answers when it's on.
PROBE_PORTS = (445, 135, 3389, 47989)


GATEWAY = os.environ.get("MAX_GATEWAY_IP", "192.168.1.1")
GATEWAY_PORTS = (80, 53, 443)  # the router's web page / DNS: answers whenever the LAN works


def _answers_on(host, port, timeout):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except ConnectionRefusedError:
        return True  # the machine is there; nothing listens on that port
    except OSError:
        return False  # no answer


def _answers(host, ports, timeout):
    """True if the host accepts or refuses a connection on any port (i.e. it's there).
    All ports are tried at once, so a silent host costs one timeout, not one per port."""
    with ThreadPoolExecutor(max_workers=len(ports)) as pool:
        return any(pool.map(lambda port: _answers_on(host, port, timeout), ports))


def is_up(timeout=1.0):
    """True if the PC answers on the LAN at all. Two rounds, so one dropped packet doesn't flip it."""
    return _answers(PC_LAN_IP, PROBE_PORTS, timeout) or _answers(PC_LAN_IP, PROBE_PORTS[:2], timeout * 2)


def lan_ok(timeout=1.0):
    """Can Dosimeter reach the router at all? If not, a silent PC says nothing about the PC."""
    return _answers(GATEWAY, GATEWAY_PORTS, timeout)


def status():
    """{"up": bool, "lanOk": bool}: "not up" only means asleep/off when Dosimeter's own LAN works."""
    up = is_up()
    return {"up": up, "lanOk": True if up else lan_ok()}


def wake():
    """Send the magic packet (a few times, to two common ports). Raises ValueError for the user."""
    global _last_wake
    with _lock:
        waited = time.monotonic() - _last_wake
        if waited < COOLDOWN_SECONDS:
            raise ValueError(f"A wake signal was just sent. Give the PC a minute (try again in {int(COOLDOWN_SECONDS - waited)} s).")
        _last_wake = time.monotonic()
    packet = magic_packet(PC_MAC)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for _ in range(3):
            for port in (9, 7):
                s.sendto(packet, (BROADCAST, port))
            time.sleep(0.2)
    print("Wake-on-LAN sent to the PC, requested by the owner", flush=True)
    return {"ok": True, "message": "Wake signal sent. The PC usually takes 20–60 seconds to come up."}
