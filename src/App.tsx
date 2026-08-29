import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

type ConnectionMode = 'lan' | 'remote';
type NodeName = 'nilavus' | 'nilavus-storage';
type NodeMetrics = { online: boolean; temperatureC: number | null; cpuPercent: number | null; memoryPercent: number | null; diskPercent: number | null; uptimeSeconds: number | null; load: number[]; services: Record<string, boolean> };
type HealthPayload = { nodes: Partial<Record<NodeName, NodeMetrics>> };
type SoundName = 'intro' | 'hover' | 'click' | 'toggle' | 'offline' | 'back' | 'about' | 'logo';

const functionsUrl = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ?? '').replace(/\/$/, '');
const offlineHealth: HealthPayload = {
  nodes: {
    nilavus: { online: false, temperatureC: null, cpuPercent: null, memoryPercent: null, diskPercent: null, uptimeSeconds: null, load: [], services: {} },
    'nilavus-storage': { online: false, temperatureC: null, cpuPercent: null, memoryPercent: null, diskPercent: null, uptimeSeconds: null, load: [], services: {} },
  },
};

const services = {
  jellyfin: { group: 'Media', name: 'Jellyfin', description: 'Movies, TV & Anime', logo: 'logos/jellyfin.svg', tone: 'jellyfin', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:8096/jelly', remote: 'https://nilavus.whydah-darter.ts.net/jelly', installed: true },
  qbit: { group: 'Downloads', name: 'qBittorrent', description: 'Downloads', logo: 'logos/qbittorrent.svg', tone: 'qbit', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:8080', remote: 'https://nilavus.whydah-darter.ts.net/qbit/', installed: true },
  files: { group: 'Files', name: 'File Browser', description: 'NAS Files', logo: 'logos/filebrowser.svg', tone: 'files', host: 'nilavus-storage' as NodeName, lan: 'http://192.168.1.81:8081/files/', remote: 'https://nilavus-storage.whydah-darter.ts.net/files/', installed: true },
  immich: { group: 'Photos', name: 'Immich', description: 'Photos & Videos', logo: 'logos/immich.svg', tone: 'immich', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:2283', remote: 'https://nilavus.whydah-darter.ts.net:8443/', installed: true },
  kavita: { group: 'Library', name: 'Kavita', description: 'Books & Comics', logo: 'logos/kavita.svg', tone: 'kavita', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:5000/kavita/', remote: 'https://nilavus.whydah-darter.ts.net/kavita/', installed: true },
  navidrome: { group: 'Music', name: 'Navidrome', description: 'Personal Music', logo: 'logos/navidrome.png', tone: 'navidrome', host: 'nilavus' as NodeName, lan: 'http://192.168.1.72:4533/navidrome/', remote: 'https://nilavus.whydah-darter.ts.net/navidrome/', installed: true },
  ubuntu: { group: 'System', name: 'Ubuntu Server', description: 'Laptop Management', logo: 'logos/ubuntu.svg', tone: 'ubuntu', host: 'nilavus' as NodeName, lan: 'https://192.168.1.72:9090/system', remote: null, installed: true },
  omv: { group: 'Administration', name: 'OpenMediaVault', description: 'NAS Management', logo: 'logos/openmediavault.svg', tone: 'omv', host: 'nilavus-storage' as NodeName, lan: 'http://192.168.1.81', remote: null, installed: true },
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
  const [logoActive, setLogoActive] = useState(false);
  const [gatewayLeaving, setGatewayLeaving] = useState(false);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutLeaving, setAboutLeaving] = useState(false);
  const audioRef = useRef<Partial<Record<SoundName, HTMLAudioElement>>>({});
  const previousOffline = useRef(false);
  const allOffline = health !== null && (['nilavus', 'nilavus-storage'] as NodeName[]).every(nodeName => health.nodes[nodeName]?.online === false);

  const playSound = useCallback((name: SoundName) => {
    const audio = audioRef.current[name];
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    const soundFiles: Record<SoundName, string> = {
      intro: 'audio/intro.mp3',
      hover: 'audio/hover.mp3',
      click: 'audio/click.mp3',
      toggle: 'audio/toggle.mp3',
      offline: 'audio/offline.mp3',
      back: 'audio/back.mp3',
      about: 'audio/secret-about-v2.mp3',
      logo: 'audio/logo-spin.mp3',
    };
    const volumes: Record<SoundName, number> = { intro: .42, hover: .16, click: .22, toggle: .32, offline: .4, back: .26, about: .48, logo: .34 };

    for (const [name, file] of Object.entries(soundFiles) as [SoundName, string][]) {
      const audio = new Audio(`${import.meta.env.BASE_URL}${file}`);
      audio.preload = 'auto';
      audio.volume = volumes[name];
      audioRef.current[name] = audio;
    }

    const playBack = () => playSound('back');
    const playBackOnReturn = (event: PageTransitionEvent) => { if (event.persisted) playBack(); };
    window.addEventListener('popstate', playBack);
    window.addEventListener('pageshow', playBackOnReturn);
    return () => {
      window.removeEventListener('popstate', playBack);
      window.removeEventListener('pageshow', playBackOnReturn);
      Object.values(audioRef.current).forEach(audio => audio?.pause());
      audioRef.current = {};
    };
  }, [playSound]);

  useEffect(() => {
    if (allOffline && !previousOffline.current) playSound('offline');
    previousOffline.current = allOffline;
  }, [allOffline, playSound]);

  useEffect(() => {
    document.documentElement.classList.toggle('gateway-active', !gatewayOpen);
    document.body.classList.toggle('gateway-active', !gatewayOpen);
    if (gatewayOpen) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return () => {
      document.documentElement.classList.remove('gateway-active');
      document.body.classList.remove('gateway-active');
    };
  }, [gatewayOpen]);

  useEffect(() => {
    document.documentElement.classList.toggle('about-active', aboutOpen);
    document.body.classList.toggle('about-active', aboutOpen);
    if (aboutOpen) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return () => {
      document.documentElement.classList.remove('about-active');
      document.body.classList.remove('about-active');
    };
  }, [aboutOpen]);

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
    if (nextMode === mode) return;
    playSound('toggle');
    setMode(nextMode);
  };

  const animateLogo = () => {
    playSound('logo');
    setLogoActive(false);
    window.requestAnimationFrame(() => setLogoActive(true));
    window.setTimeout(() => setLogoActive(false), 1900);
  };

  const enterSite = () => {
    if (gatewayLeaving) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    playSound('click');
    playSound('intro');
    setGatewayLeaving(true);
    window.setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      setGatewayOpen(true);
    }, 900);
  };

  const openAbout = () => {
    if (aboutOpen) return;
    for (const [name, audio] of Object.entries(audioRef.current) as [SoundName, HTMLAudioElement][]) {
      if (name === 'about') continue;
      audio.pause();
      audio.currentTime = 0;
    }
    playSound('about');
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    setAboutLeaving(false);
    setAboutOpen(true);
  };

  const closeAbout = () => {
    if (aboutLeaving) return;
    playSound('back');
    setAboutLeaving(true);
    window.setTimeout(() => {
      setAboutOpen(false);
      setAboutLeaving(false);
    }, 650);
  };

  const moveShapes = (event: ReactPointerEvent<HTMLElement>) => {
    const x = (event.clientX / window.innerWidth - .5) * 34;
    const y = (event.clientY / window.innerHeight - .5) * 28;
    event.currentTarget.style.setProperty('--cursor-x', `${x}px`);
    event.currentTarget.style.setProperty('--cursor-y', `${y}px`);
  };

  return <main className={`${allOffline ? 'offline-world ' : ''}${gatewayOpen ? 'site-entered' : 'site-locked'}`} onPointerMove={moveShapes}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    {!gatewayOpen && <section className={`access-gateway ${gatewayLeaving ? 'gateway-leaving' : ''}`} aria-label="Enter NILAVUS">
      <div className="gateway-grid" aria-hidden="true" />
      <div className="gateway-shapes" aria-hidden="true">
        <span className="gate-circle gate-one" /><span className="gate-cross gate-two" /><span className="gate-triangle gate-three" /><span className="gate-square gate-four" />
        <span className="gate-cross gate-five" /><span className="gate-circle gate-six" /><span className="gate-square gate-seven" /><span className="gate-triangle gate-eight" />
      </div>
      <div className="gateway-content">
        <img className="gateway-logo" src={`${import.meta.env.BASE_URL}n-logo.png`} alt="NILAVUS N" />
        <button className="access-button" type="button" onClick={enterSite}><span>ACCESS</span></button>
        <p>PERSONAL INFRASTRUCTURE</p>
      </div>
    </section>}
    {aboutOpen && createPortal(<section className={`about-page ${aboutLeaving ? 'about-leaving' : ''}`} aria-label="About NILAVUS">
      <div className="about-shapes" aria-hidden="true"><span className="about-circle" /><span className="about-cross" /><span className="about-triangle" /><span className="about-square" /></div>
      <button className="about-back" type="button" onClick={closeAbout}>← Back</button>
      <article className="about-content">
        <p className="about-kicker">ABOUT</p>
        <h2>You found the other side of NILAVUS.</h2>
        <p>It started with an old computer,<br />a few hard drives,<br />and the idea that everything<br />could live in one place.</p>
        <p className="about-stack">Movies.<br />Music.<br />Photos.<br />Books.<br />Files.</p>
        <p>A little server became a system.<br />The system became a home.</p>
        <p className="about-home">NILAVUS is that home.</p>
        <div className="about-rule" />
        <div className="about-spec"><h3>Built from:</h3><p>Linux · Docker · OpenMediaVault<br />Tailscale · Jellyfin · Immich<br />Kavita · Navidrome</p></div>
        <div className="about-spec"><h3>Hardware:</h3><p>More ambition than hardware.</p></div>
        <div className="about-spec"><h3>Developers:</h3><p>Max &amp; Mar</p></div>
        <div className="about-rule" />
        <ol className="about-index"><li>STORAGE</li><li>MEDIA</li><li>PHOTOS</li><li>BOOKS</li><li>MUSIC</li></ol>
        <div className="about-mark"><strong>NILAVUS</strong><span>LOCAL • PRIVATE • PERSONAL</span></div>
      </article>
    </section>, document.body)}
    <div className="ps-shapes" aria-hidden="true">
      <span className="shape-circle" /><span className="shape-cross" /><span className="shape-triangle" /><span className="shape-square" />
      <span className="shape-circle shape-circle-two" /><span className="shape-cross shape-cross-two" /><span className="shape-triangle shape-triangle-two" /><span className="shape-square shape-square-two" />
      <span className="shape-circle shape-circle-three" /><span className="shape-cross shape-cross-three" /><span className="shape-triangle shape-triangle-three" /><span className="shape-square shape-square-three" />
      <span className="shape-circle shape-circle-four" /><span className="shape-cross shape-cross-four" /><span className="shape-triangle shape-triangle-four" /><span className="shape-square shape-square-four" />
      <span className="shape-square shape-square-left" /><span className="shape-cross shape-cross-left" />
    </div>
    <div className="boot-wash" aria-hidden="true" />
    <section className="shell">
      <header className="hero">
        <div className="topline">
          <div className="brand"><button className={`brand-trigger ${logoActive ? 'logo-active' : ''}`} type="button" onClick={animateLogo} aria-label="Animate NILAVUS logo"><img className="brand-logo" src={`${import.meta.env.BASE_URL}n-logo.png`} alt="NILAVUS" /></button><span className="brand-word">NILAVUS</span></div>
          <div className="node-statuses">{(['nilavus', 'nilavus-storage'] as NodeName[]).map(nodeName => { const node = health?.nodes[nodeName]; const state = node?.online ? 'online' : health ? 'offline' : 'checking'; return <div className={`status ${state}`} key={nodeName}><span />{nodeName} {state}</div> })}</div>
        </div>
        <div className="hero-copy">
          <div><p className="eyebrow">PERSONAL CLOUD</p><h1><span className="hero-line hero-line-one">Your media.</span><span className="hero-line hero-line-two"><em>Your space.</em></span></h1></div>
          <div className="connection-panel"><p>CONNECTION</p><div className={`mode-toggle mode-${mode}`} role="group" aria-label="Connection mode"><span className="toggle-glider" aria-hidden="true" /><button type="button" aria-pressed={mode === 'lan'} className={mode === 'lan' ? 'active' : ''} onClick={() => chooseMode('lan')}><span>LAN</span></button><button type="button" aria-pressed={mode === 'remote'} className={mode === 'remote' ? 'active' : ''} onClick={() => chooseMode('remote')}><span>Remote</span></button></div><div className="connection-detail"><i />{mode === 'lan' ? 'Direct • Local network' : 'Remote • Tailscale services'}</div></div>
        </div>
      </header>

      <section className="services" aria-label="NAS services">
        <div className="section-heading"><span>Services</span><b>{mode === 'lan' ? 'Direct connection' : 'Internet / Tailscale'}</b></div>
        <div className="service-grid">{Object.entries(services).map(([key, service], index) => {
          const target = service[mode]; const unavailable = !service.installed || !target; const node = health?.nodes[service.host]; const serviceOnline = node?.services?.[key];
          const liveState = !health ? 'checking' : !node?.online || serviceOnline === false ? 'offline' : serviceOnline ? 'online' : 'checking';
          const badge = !service.installed ? 'Coming soon' : liveState === 'online' ? 'Online' : liveState === 'offline' ? 'Offline' : 'Checking';
          return <article className={`service-card ${service.tone} ${unavailable ? 'disabled' : ''}`} key={key} style={{ '--delay': `${index * 65}ms` } as CSSProperties} onMouseEnter={() => playSound('hover')} onPointerDown={() => playSound('hover')}>
            <div className="card-top"><span className="service-icon" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}${service.logo}`} alt="" /></span><span className={`access ${liveState}`}><i />{badge}</span></div>
            <div className="card-copy"><span className="group-label">{service.group}</span><h2>{service.name}</h2><p>{service.description}</p></div>
            <div className="card-bottom"><div className="destination-block"><span className="destination" title={target ?? undefined}>{!service.installed ? 'Not installed' : displayUrl(target)}</span><span className="host-label">Running on <b>{service.host}</b></span></div>{unavailable ? <button className="open-button" type="button" disabled>{!service.installed ? 'Coming soon' : 'Unavailable'}</button> : <a className="open-button" href={target!} onClick={() => playSound('click')} aria-label={`Open ${service.name} using ${mode === 'lan' ? 'LAN' : 'Remote'}`}>Open <b>↗</b></a>}</div>
          </article>
        })}</div>
      </section>

      <section className="health" aria-label="System health">
        <div className="section-heading"><span>System health</span><b>Refreshes every 10 seconds</b></div>
        <div className="health-grid">{(['nilavus', 'nilavus-storage'] as NodeName[]).map(nodeName => { const node = health?.nodes[nodeName]; const state = node?.online ? 'online' : health ? 'offline' : 'checking'; return <article className={`health-card ${state}`} key={nodeName}><div className="health-title"><div><span>{nodeName === 'nilavus' ? 'HP Laptop' : 'Storage PC'}</span><h3>{nodeName}</h3></div><b><i />{state}</b></div><div className="metric-grid"><div><span>Temperature</span><strong>{formatMetric(node?.temperatureC, '°C')}</strong></div><div><span>CPU activity</span><strong>{formatMetric(node?.cpuPercent)}</strong></div><div><span>Memory</span><strong>{formatMetric(node?.memoryPercent)}</strong></div><div><span>Storage</span><strong>{formatMetric(node?.diskPercent)}</strong></div><div><span>Load</span><strong>{node?.load?.[0]?.toFixed(2) ?? '—'}</strong></div><div><span>Uptime</span><strong>{formatUptime(node?.uptimeSeconds)}</strong></div></div></article> })}</div>
      </section>

      <section className="kinetic-signature" aria-label="Nilavus signature">
        <button className="kinetic-word" type="button" onClick={openAbout} aria-label="Open the secret NILAVUS about page">NILAVUS<sup>®</sup></button>
      </section>

      <footer><span>Made by MoeLustHer</span><span>Nilavu Systems</span><span>Secured with Tailscale</span><span>{visitorCount == null ? 'Visitors today —' : `${visitorCount} visitor${visitorCount === 1 ? '' : 's'} today`}</span></footer>
    </section>
  </main>;
}
