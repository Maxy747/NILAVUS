"""Which apps are using the most CPU and memory right now, read from /proc (Linux, stdlib only).

Shared by M.A.X. on Dosimeter (read directly) and NASig's metrics agent (GET /api/top).
Processes are grouped by what they belong to, not listed one by one: the systemd unit they run
under (jellyfin.service -> Jellyfin), their Docker container (named from its processes, e.g.
Immich, Immich database), or for kernel threads the kind of thread (kworker, irq/...-rtw88_pci).
CPU is measured over a short window, so it's current, not a lifetime average, and it's a share
of the whole machine (all cores = 100%), like the dashboard's CPU figure. Memory is resident
memory (RSS); memory shared between processes can be counted in each.
"""
import os
import re
import time

# /proc is Linux-only; these fallbacks just let the module import elsewhere (e.g. tests on Windows).
CLOCK_TICKS = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
PAGE = os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else 4096
CPUS = os.cpu_count() or 1

UNITS = {  # systemd unit -> the name Max knows it by
    "jellyfin.service": "Jellyfin", "kavita.service": "Kavita", "navidrome.service": "Navidrome",
    "qbittorrent-nox@qbtuser.service": "qBittorrent", "nilavu-max.service": "M.A.X.",
    "maximum-overdrive.service": "maximum-overdrive", "docker.service": "Docker engine",
    "containerd.service": "containerd", "tailscaled.service": "Tailscale", "smbd.service": "Samba",
    "nmbd.service": "Samba", "nginx.service": "nginx", "openmediavault-engined.service": "OpenMediaVault",
    "php8.4-fpm.service": "OpenMediaVault web", "monit.service": "monit", "ssh.service": "SSH",
    "systemd-journald.service": "system logs", "nilavu-metrics.service": "NILAVUS telemetry",
    "nilavu-dosimeter-metrics.service": "NILAVUS telemetry", "nilavu-storage-telemetry.service": "NILAVUS telemetry",
    "nilavu-dashboard-local.service": "NILAVUS dashboard", "nilavus-manga-webdav.service": "manga WebDAV",
}
CONTAINER = re.compile(r"docker[-/]([0-9a-f]{12})")
SERVICE = re.compile(r"([\w@.\-]+\.service)")
SHELLS = {"tini", "sh", "bash", "dumb-init"}


def _read(path):
    try:
        with open(path, "rb") as f:
            return f.read().decode("utf-8", "replace")
    except OSError:
        return None


def _where(pid):
    """(container id or None, cgroup path) for a process."""
    cgroup = (_read(f"/proc/{pid}/cgroup") or "").strip()
    path = cgroup.splitlines()[-1].split(":", 2)[-1] if cgroup else ""
    container = CONTAINER.search(path)
    return (container.group(1) if container else None), path


def _container_name(comms, cmds):
    """Name a container from all of its processes (their names and command lines)."""
    immich = "immich" in cmds
    if "postgres" in comms:
        return "Immich database" if immich else "Postgres (container)"
    caches = comms & {"redis-server", "valkey-server"}
    if caches:
        return "Immich cache" if immich else f"{sorted(caches)[0]} (container)"
    if immich and ("machine" in cmds or "gunicorn" in comms or "immich_ml" in cmds):
        return "Immich machine learning"
    if immich:
        return "Immich"
    main = sorted(comms - SHELLS) or sorted(comms) or ["container"]
    return f"{main[0]} (container)"


def _group(pid, where, containers):
    """Friendly name of what this process belongs to."""
    container, path = where
    if container:
        return containers[container]
    units = SERVICE.findall(path)
    if units:
        return UNITS.get(units[-1], units[-1][:-len(".service")])
    comm = (_read(f"/proc/{pid}/comm") or "other").strip()
    if not path or path == "/":
        # Interrupt threads keep their driver (irq/129-rtw88_pci -> IRQ rtw88_pci, the Wi-Fi card);
        # workers lose their CPU numbers (kworker/0:5+events -> kworker).
        if comm.startswith("irq/") and "-" in comm:
            return f"kernel (IRQ {comm.split('-', 1)[1]})"
        return f"kernel ({comm.split('/')[0]})"
    return comm


def _snapshot():
    out = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        stat = _read(f"/proc/{entry}/stat")
        statm = _read(f"/proc/{entry}/statm")
        if not stat or not statm:
            continue
        fields = stat[stat.rfind(")") + 2:].split()  # the command name can contain spaces
        try:
            ticks = int(fields[11]) + int(fields[12])  # utime + stime
            rss = int(statm.split()[1]) * PAGE
        except (IndexError, ValueError):
            continue
        out[entry] = (ticks, rss)
    return out


def _mem_total():
    for line in (_read("/proc/meminfo") or "").splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) * 1024
    return None


def top_apps(window=0.5, limit=5):
    """{"cpu": [{"name", "cpuPercent"}], "memory": [{"name", "memoryMb", "memoryPercent"}], ...}"""
    first = _snapshot()
    started = time.monotonic()
    time.sleep(window)
    second = _snapshot()
    elapsed = time.monotonic() - started

    where = {pid: _where(pid) for pid in second}
    members = {}
    for pid, (container, _) in where.items():
        if container:
            comms, cmds = members.setdefault(container, (set(), []))
            comms.add((_read(f"/proc/{pid}/comm") or "").strip())
            cmds.append((_read(f"/proc/{pid}/cmdline") or "").replace("\0", " ").lower())
    containers = {c: _container_name(comms, " ".join(cmds)) for c, (comms, cmds) in members.items()}

    cpu, mem = {}, {}
    for pid, (ticks, rss) in second.items():
        name = _group(pid, where[pid], containers)
        before = first.get(pid)
        cpu[name] = cpu.get(name, 0.0) + ((ticks - before[0]) / CLOCK_TICKS if before else 0.0)
        mem[name] = mem.get(name, 0) + rss
    total_mem = _mem_total()
    busiest = [kv for kv in sorted(cpu.items(), key=lambda kv: kv[1], reverse=True) if kv[1] > 0][:limit]
    biggest = sorted(mem.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    return {
        "sampledAt": int(time.time()), "cpus": CPUS, "memoryTotalMb": round(total_mem / 2**20) if total_mem else None,
        "cpu": [{"name": n, "cpuPercent": round(100 * t / elapsed / CPUS, 1)} for n, t in busiest],
        "memory": [{"name": n, "memoryMb": round(b / 2**20),
                    "memoryPercent": round(100 * b / total_mem, 1) if total_mem else None} for n, b in biggest],
    }


if __name__ == "__main__":
    import json
    print(json.dumps(top_apps(window=1.0)))
