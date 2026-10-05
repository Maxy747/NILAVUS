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


def is_up(timeout=1.0):
    """True if the PC answers on the LAN at all (accepts or refuses a connection)."""
    for port in PROBE_PORTS:
        try:
            with socket.create_connection((PC_LAN_IP, port), timeout=timeout):
                return True
        except ConnectionRefusedError:
            return True  # the machine is there; nothing listens on that port
        except OSError:
            continue  # no answer (asleep/off, or a firewall dropping it): try the next port
    return False


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
