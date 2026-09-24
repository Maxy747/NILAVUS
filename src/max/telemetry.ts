// M.A.X. side panel, alerts and greeting, derived from the telemetry the dashboard
// already polls. No AI and no extra requests. Thresholds match agent-v2/max_core.py.

export type MaxNodeName = 'nilavus' | 'nilavus-storage';
export type MaxDrive = { name: string; online: boolean; usedPercent: number | null; usedBytes?: number | null; totalBytes?: number | null };
export type MaxNode = {
  online: boolean; temperatureC: number | null; cpuPercent: number | null; memoryPercent: number | null;
  diskPercent: number | null; uptimeSeconds: number | null; load: number[];
  services: Record<string, unknown>; drives?: MaxDrive[];
};
export type MaxService = { key: string; name: string; host: MaxNodeName };
export type MaxTelemetry = {
  /** false when the status endpoint can't be reached; never show stale numbers as live. */
  live: boolean;
  nodes: Partial<Record<MaxNodeName, MaxNode>>;
  services: MaxService[];
};
export type Alert = { level: 'critical' | 'warning'; source: string; message: string; category: 'system' | 'storage' };

// A big media drive at 92% still has ~300 GB free: a warning (shown red), not an emergency.
export const STORAGE_WARN = 90;
export const STORAGE_CRIT = 98;
export const TEMP_WARN = 75;
export const TEMP_CRIT = 85;

export const NODE_LABEL: Record<MaxNodeName, string> = { nilavus: 'DOSIMETER', 'nilavus-storage': 'NASIG' };
export const NODES: MaxNodeName[] = ['nilavus', 'nilavus-storage'];

export const pct = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value)}%`;

export const shortUptime = (seconds: number | null | undefined) => {
  if (seconds == null) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

export const serviceUp = (t: MaxTelemetry, service: MaxService) => {
  const node = t.nodes[service.host];
  return Boolean(node?.online && node.services?.[service.key] === true);
};

export const drives = (t: MaxTelemetry) => NODES.flatMap(name => t.nodes[name]?.online ? t.nodes[name]?.drives ?? [] : []);

export function alerts(t: MaxTelemetry): Alert[] {
  if (!t.live) return [];
  const list: Alert[] = [];
  for (const name of NODES) {
    const node = t.nodes[name];
    if (!node?.online) { list.push({ level: 'critical', source: NODE_LABEL[name], category: 'system', message: `${NODE_LABEL[name]} is unreachable.` }); continue; }
    if (node.temperatureC != null && node.temperatureC >= TEMP_WARN) {
      list.push({ level: node.temperatureC >= TEMP_CRIT ? 'critical' : 'warning', source: NODE_LABEL[name], category: 'system',
        message: `${NODE_LABEL[name]} is running hot at ${Math.round(node.temperatureC)}C.` });
    }
  }
  for (const drive of drives(t)) {
    if (!drive.online) list.push({ level: 'warning', source: drive.name, category: 'storage', message: `${drive.name} is not mounted.` });
    else if (drive.usedPercent != null && drive.usedPercent >= STORAGE_WARN) {
      list.push({ level: drive.usedPercent >= STORAGE_CRIT ? 'critical' : 'warning', source: drive.name, category: 'storage',
        message: `${drive.name} storage is at ${drive.usedPercent.toFixed(1)}%.` });
    }
  }
  for (const service of t.services) {
    if (t.nodes[service.host]?.online && !serviceUp(t, service)) {
      list.push({ level: 'warning', source: service.name, category: 'system', message: `${service.name} is offline.` });
    }
  }
  return list;
}

export type SystemStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

const worst = (t: MaxTelemetry, list: Alert[]): SystemStatus =>
  !t.live ? 'UNKNOWN' : list.some(a => a.level === 'critical') ? 'CRITICAL' : list.length ? 'WARNING' : 'NORMAL';

/** Machines, services and temperatures. Storage is separate so a full drive doesn't read as a broken system. */
export const systemStatus = (t: MaxTelemetry, list = alerts(t)) => worst(t, list.filter(a => a.category === 'system'));
export const storageStatus = (t: MaxTelemetry, list = alerts(t)) => worst(t, list.filter(a => a.category === 'storage'));

const RANK: Record<SystemStatus, number> = { UNKNOWN: 0, NORMAL: 1, WARNING: 2, CRITICAL: 3 };
export const overallStatus = (t: MaxTelemetry, list = alerts(t)): SystemStatus => {
  const a = systemStatus(t, list), b = storageStatus(t, list);
  return RANK[a] >= RANK[b] ? a : b;
};

/** Opening lines, written by code from real telemetry, so opening the console costs no inference. */
export function greeting(t: MaxTelemetry, now = new Date()): string {
  const hour = now.getHours();
  const hello = hour < 5 ? 'Still up, Max?' : hour < 12 ? 'Good morning, Max.' : hour < 18 ? 'Good afternoon, Max.' : 'Good evening, Max.';
  if (!t.live) return `${hello}\n\nTelemetry is unavailable, so I can't see the servers right now.`;
  const list = alerts(t);
  const down = t.services.filter(s => !serviceUp(t, s));
  const lines = [hello, ''];
  lines.push(down.length ? `${down.length} service${down.length === 1 ? '' : 's'} offline: ${down.map(s => s.name).join(', ')}.`
    : 'All monitored services are operational.');
  // Name every active alert (critical first) instead of pointing at them.
  const ordered = [...list].sort((a, b) => (a.level === 'critical' ? 0 : 1) - (b.level === 'critical' ? 0 : 1));
  for (const alert of ordered.filter(a => !(a.category === 'system' && a.message.endsWith('is offline.')))) {
    lines.push(`${alert.level === 'critical' ? 'CRITICAL' : 'Warning'}: ${alert.message}`);
  }
  lines.push(list.some(a => a.level === 'critical') ? 'Needs attention.' : list.length ? 'Nothing critical detected.' : 'No alerts. System check complete.');
  return lines.join('\n');
}

/** Stable identity of an alert, so M.A.X. announces it once, and again only if it escalates. */
export const alertKey = (alert: Alert) => `${alert.source}|${alert.level}`;
