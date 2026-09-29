// Live NILAVUS status, shared by the dashboard (App.tsx) and the standalone M.A.X. app
// (max.html), so both read the same telemetry the same way.
import { useEffect, useRef, useState } from 'react';
import type { MaxTelemetry } from './max/telemetry';

export type NodeName = 'nilavus' | 'nilavus-storage';
export type DriveMetric = { name: string; online: boolean; usedPercent: number | null; usedBytes?: number | null; totalBytes?: number | null };
export type NodeMetrics = { online: boolean; temperatureC: number | null; cpuPercent: number | null; memoryPercent: number | null; diskPercent: number | null; uptimeSeconds: number | null; load: number[]; services: Record<string, boolean | DriveMetric[]>; drives?: DriveMetric[]; receivedAt?: string };
export type HealthPayload = { nodes: Record<string, NodeMetrics | undefined> };

export const functionsUrl = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || 'https://gibzoyvvmwvprkubfhvc.supabase.co/functions/v1').replace(/\/$/, '');
export const offlineHealth: HealthPayload = {
  nodes: {
    nilavus: { online: false, temperatureC: null, cpuPercent: null, memoryPercent: null, diskPercent: null, uptimeSeconds: null, load: [], services: {} },
    'nilavus-storage': { online: false, temperatureC: null, cpuPercent: null, memoryPercent: null, diskPercent: null, uptimeSeconds: null, load: [], services: {} },
  },
};

export const services = {
  jellyfin: { group: 'Media', name: 'Jellyfin', description: 'Movies, TV & Anime', logo: 'logos/jellyfin.svg', tone: 'jellyfin', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:8096/jelly', remote: 'https://nilavus.whydah-darter.ts.net/jelly', installed: true },
  immich: { group: 'Photos', name: 'Immich', description: 'Photos & Videos', logo: 'logos/immich.svg', tone: 'immich', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:2283', remote: 'https://nilavus.whydah-darter.ts.net:8443/', installed: true },
  files: { group: 'Files', name: 'File Browser', description: 'NAS Files', logo: 'logos/filebrowser.svg', tone: 'files', host: 'nilavus-storage' as NodeName, lan: 'http://192.168.1.81:8081/files/', remote: 'https://nilavus-storage.whydah-darter.ts.net/files/', installed: true },
  qbit: { group: 'Downloads', name: 'qBittorrent', description: 'Downloads', logo: 'logos/qbittorrent.svg', tone: 'qbit', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:8080', remote: 'https://nilavus.whydah-darter.ts.net/qbit/', installed: true },
  kavita: { group: 'Library', name: 'Kavita', description: 'Books & Comics', logo: 'logos/kavita.svg', tone: 'kavita', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:5000/kavita/', remote: 'https://nilavus.whydah-darter.ts.net/kavita/', installed: true },
  navidrome: { group: 'Music', name: 'Navidrome', description: 'Personal Music', logo: 'logos/navidrome.png', tone: 'navidrome', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:4533/navidrome/', remote: 'https://nilavus.whydah-darter.ts.net/navidrome/', installed: true },
  ubuntu: { group: 'System', name: 'Ubuntu Server', description: 'Laptop Management', logo: 'logos/ubuntu.svg', tone: 'ubuntu', host: 'nilavus' as NodeName, lan: 'https://192.168.1.72:9090/system', remote: null, installed: true },
  omv: { group: 'Administration', name: 'OpenMediaVault', description: 'NAS Management', logo: 'logos/openmediavault.svg', tone: 'omv', host: 'nilavus-storage' as NodeName, lan: 'http://192.168.1.81', remote: null, installed: true },
} as const;

export const normalizeHealth = (payload: HealthPayload): HealthPayload => {
  const rawNodes = payload.nodes ?? {};
  const nodes: Record<string, NodeMetrics | undefined> = { ...rawNodes };
  for (const [name, node] of Object.entries(nodes)) {
    if (!node) continue;
    const embeddedDrives = node.services?._drives;
    if (!node.drives && Array.isArray(embeddedDrives)) nodes[name] = { ...node, drives: embeddedDrives };
    const receivedAt = Date.parse(String(node.receivedAt ?? ''));
    // The Edge Function uses a 90-second cutoff. Allow a short additional
    // window for delayed heartbeats so a healthy host does not flicker red.
    if (!node.online && Number.isFinite(receivedAt) && Date.now() - receivedAt < 150_000) {
      nodes[name] = { ...node, online: true };
    }
  }
  const laptopAliases = ['dosimeter', 'nilavus-laptop'] as const;
  const alias = laptopAliases.map(name => nodes[name]).find(Boolean);
  const current = nodes.nilavus;
  // Older telemetry agents identified the laptop by its local hostname. Keep
  // those heartbeats visible while the agent is being renamed to nilavus.
  const laptop = alias && (!current || (!current.online && alias.online)) ? alias : current;
  return { ...payload, nodes: { ...nodes, nilavus: laptop ?? nodes.nilavus } };
};

/** Polls the status endpoint every 10 s. Goes offline only after 3 failures in a row. */
export function useNodeStatus() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [statusLive, setStatusLive] = useState(false);
  const failures = useRef(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`${functionsUrl}/status`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Health endpoint unavailable');
        const payload = normalizeHealth(await response.json() as HealthPayload);
        failures.current = 0;
        if (active) { setHealth(payload); setStatusLive(true); }
      } catch {
        // Keep the previous state through brief cloud-status interruptions.
        failures.current += 1;
        if (active && failures.current >= 3) { setHealth(offlineHealth); setStatusLive(false); }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return { health, statusLive };
}

/** What M.A.X. sees: the same nodes, and every service except the Ubuntu admin page. */
export const maxTelemetryFrom = (health: HealthPayload | null, live: boolean): MaxTelemetry => ({
  live,
  nodes: { nilavus: health?.nodes.nilavus, 'nilavus-storage': health?.nodes['nilavus-storage'] },
  services: Object.entries(services).filter(([key]) => key !== 'ubuntu')
    .map(([key, service]) => ({ key, name: service.name, host: service.host })),
});
