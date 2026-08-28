import { useEffect, useState, type CSSProperties } from 'react';

type ConnectionMode = 'lan' | 'remote';
type NodeName = 'nilavus' | 'nilavus-storage';
type NodeMetrics = { online: boolean; temperatureC: number | null; cpuPercent: number | null; memoryPercent: number | null; diskPercent: number | null; uptimeSeconds: number | null; load: number[]; services: Record<string, boolean> };
type HealthPayload = { nodes: Partial<Record<NodeName, NodeMetrics>> };

const functionsUrl = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ?? '').replace(/\/$/, '');
const offlineHealth: HealthPayload = {
  nodes: {
    nilavus: { online: false, temperatureC: null, cpuPercent: null, memoryPercent: null, diskPercent: null, uptimeSeconds: null, load: [], services: {} },
    'nilavus-storage': { online: false, temperatureC: null, cpuPercent: null, memoryPercent: null, diskPercent: null, uptimeSeconds: null, load: [], services: {} },
  },
};

const services = {
  jellyfin: { group: 'Media', name: 'Jellyfin', description: 'Movies, TV & Anime', icon: '🎬', tone: 'jellyfin', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:8096/jelly', remote: 'https://nilavus.whydah-darter.ts.net/jelly', installed: true },
  qbit: { group: 'Downloads', name: 'qBittorrent', description: 'Downloads', icon: '⬇️', tone: 'qbit', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:8080', remote: 'https://nilavus.whydah-darter.ts.net/qbit/', installed: true },
  files: { group: 'Files', name: 'File Browser', description: 'NAS Files', icon: '📁', tone: 'files', host: 'nilavus-storage' as NodeName, lan: 'http://192.168.1.81:8081/files/', remote: 'https://nilavus-storage.whydah-darter.ts.net/files/', installed: true },
  immich: { group: 'Photos', name: 'Immich', description: 'Photos & Videos', icon: '📷', tone: 'immich', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:2283', remote: 'https://nilavus.whydah-darter.ts.net:8443/', installed: true },
  kavita: { group: 'Library', name: 'Kavita', description: 'Books & Comics', icon: '📚', tone: 'kavita', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:5000/kavita/', remote: 'https://nilavus.whydah-darter.ts.net/kavita/', installed: true },
  navidrome: { group: 'Music', name: 'Navidrome', description: 'Personal Music', icon: '🎵', tone: 'navidrome', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:4533/navidrome/', remote: 'https://nilavus.whydah-darter.ts.net/navidrome/', installed: true },
  ubuntu: { group: 'System', name: 'Ubuntu Server', description: 'Laptop Management', icon: '🖥️', tone: 'ubuntu', host: 'nilavus' as NodeName, lan: 'https://192.168.1.72:9090/system', remote: null, installed: true },
  omv: { group: 'Administration', name: 'OpenMediaVault', description: 'NAS Management', icon: '⚙️', tone: 'omv', host: 'nilavus-storage' as NodeName, lan: 'http://192.168.1.81', remote: null, installed: true },
} as const;

const displayUrl = (url: string | null) => url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Remote link not configured';
const formatMetric = (value: number | null | undefined, suffix = '%') => value == null ? '—' : `${Math.round(value)}${suffix}`;
const formatUptime = (seconds: number | null | undefined) => {
  if (seconds == null) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days}d ${hours}h` : `${hours}h`;
};

export default function Home() {
  const [mode, setMode] = useState<ConnectionMode>('remote');
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [visitorCount, setVisitorCount] = useState<number | null>(null);

  useEffect(() => {
    if (!functionsUrl) return;
    fetch(`${functionsUrl}/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).then(response => {
      if (!response.ok) throw new Error('Visitor endpoint unavailable');
      return response.json() as Promise<{ visitors: number }>;
    }).then(payload => setVisitorCount(payload.visitors)).catch(() => setVisitorCount(null));
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        if (!functionsUrl) throw new Error('Telemetry is not configured');
        const response = await fetch(`${functionsUrl}/status`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Health endpoint unavailable');
        const payload = await response.json() as HealthPayload;
        if (active) setHealth(payload);
      } catch { if (active) setHealth(offlineHealth); }
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const signature = document.querySelector<HTMLElement>('.kinetic-signature');
    if (!signature) return;
    let frame = 0;
    const update = () => {
      const rect = signature.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (window.innerHeight - rect.top) / (window.innerHeight * 0.45)));
      signature.style.setProperty('--signature-drift', `${(1 - progress) * 8}vw`);
      frame = 0;
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, []);

  const chooseMode = (nextMode: ConnectionMode) => {
    setMode(nextMode);
  };

  return <main>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <section className="shell">
      <header className="hero">
        <div className="topline">
          <div className="brand"><img className="brand-logo" src={`${import.meta.env.BASE_URL}nilavus-logo.png`} alt="NILAVUS" /><span><small>Personal Server</small></span></div>
          <div className="node-statuses">{(['nilavus', 'nilavus-storage'] as NodeName[]).map(nodeName => { const node = health?.nodes[nodeName]; const state = node?.online ? 'online' : health ? 'offline' : 'checking'; return <div className={`status ${state}`} key={nodeName}><span />{nodeName} {state}</div> })}</div>
        </div>
        <div className="hero-copy">
          <div><p className="eyebrow">PERSONAL CLOUD</p><h1>Your media.<br /><em>Your space.</em></h1></div>
          <div className="connection-panel"><p>CONNECTION</p><div className="mode-toggle" role="group" aria-label="Connection mode"><button type="button" aria-pressed={mode === 'lan'} className={mode === 'lan' ? 'active' : ''} onClick={() => chooseMode('lan')}>🏠 <span>LAN</span></button><button type="button" aria-pressed={mode === 'remote'} className={mode === 'remote' ? 'active' : ''} onClick={() => chooseMode('remote')}>🌐 <span>Remote</span></button></div><div className="connection-detail"><i />{mode === 'lan' ? 'Direct • Local network' : 'Remote • Tailscale services'}</div></div>
        </div>
      </header>

      <section className="services" aria-label="NAS services">
        <div className="section-heading"><span>Services</span><b>{mode === 'lan' ? 'Direct connection' : 'Internet / Tailscale'}</b></div>
        <div className="service-grid">{Object.entries(services).map(([key, service], index) => {
          const target = service[mode]; const unavailable = !service.installed || !target; const node = health?.nodes[service.host]; const serviceOnline = node?.services?.[key];
          const liveState = !health ? 'checking' : !node?.online || serviceOnline === false ? 'offline' : serviceOnline ? 'online' : 'checking';
          const badge = !service.installed ? 'Coming soon' : liveState === 'online' ? 'Online' : liveState === 'offline' ? 'Offline' : 'Checking';
          return <article className={`service-card ${service.tone} ${unavailable ? 'disabled' : ''}`} key={key} style={{ '--delay': `${index * 65}ms` } as CSSProperties}>
            <div className="card-top"><span className="service-icon" aria-hidden="true">{service.icon}</span><span className={`access ${liveState}`}><i />{badge}</span></div>
            <div className="card-copy"><span className="group-label">{service.group}</span><h2>{service.name}</h2><p>{service.description}</p></div>
            <div className="card-bottom"><div className="destination-block"><span className="destination" title={target ?? undefined}>{!service.installed ? 'Not installed' : displayUrl(target)}</span><span className="host-label">Running on <b>{service.host}</b></span></div>{unavailable ? <button className="open-button" type="button" disabled>{!service.installed ? 'Coming soon' : 'Unavailable'}</button> : <a className="open-button" href={target!} aria-label={`Open ${service.name} using ${mode === 'lan' ? 'LAN' : 'Remote'}`}>Open <b>↗</b></a>}</div>
          </article>
        })}</div>
      </section>

      <section className="health" aria-label="System health">
        <div className="section-heading"><span>System health</span><b>Refreshes every 10 seconds</b></div>
        <div className="health-grid">{(['nilavus', 'nilavus-storage'] as NodeName[]).map(nodeName => { const node = health?.nodes[nodeName]; const state = node?.online ? 'online' : health ? 'offline' : 'checking'; return <article className={`health-card ${state}`} key={nodeName}><div className="health-title"><div><span>{nodeName === 'nilavus' ? 'HP Laptop' : 'Storage PC'}</span><h3>{nodeName}</h3></div><b><i />{state}</b></div><div className="metric-grid"><div><span>Temperature</span><strong>{formatMetric(node?.temperatureC, '°C')}</strong></div><div><span>CPU activity</span><strong>{formatMetric(node?.cpuPercent)}</strong></div><div><span>Memory</span><strong>{formatMetric(node?.memoryPercent)}</strong></div><div><span>Storage</span><strong>{formatMetric(node?.diskPercent)}</strong></div><div><span>Load</span><strong>{node?.load?.[0]?.toFixed(2) ?? '—'}</strong></div><div><span>Uptime</span><strong>{formatUptime(node?.uptimeSeconds)}</strong></div></div></article> })}</div>
      </section>

      <section className="kinetic-signature" aria-label="Nilavus signature">
        <div className="kinetic-word" aria-hidden="true">NILAVUS<sup>®</sup></div>
        <div className="signature-meta"><span>Private infrastructure</span><span>Made by MoeLustHer</span><span>Secured with Tailscale</span></div>
      </section>

      <footer><span>Made by MoeLustHer</span><span>Nilavu Systems</span><span>Secured with Tailscale</span><span>{visitorCount == null ? 'Visitors today —' : `${visitorCount} visitor${visitorCount === 1 ? '' : 's'} today`}</span></footer>
    </section>
  </main>;
}
