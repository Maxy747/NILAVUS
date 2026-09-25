import { useEffect, useState } from 'react';
import './temperature-graph.css';

type Sample = { sampled_at: string; temperature_c: number };
type History = { nodes: Record<string, Sample[]>; generatedAt: string };
const endpoint = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || 'https://gibzoyvvmwvprkubfhvc.supabase.co/functions/v1').replace(/\/$/, '');
let cached: History | null = null;
let fetchedAt = 0;
let pending: Promise<History> | null = null;
async function readHistory() {
  if (cached && Date.now() - fetchedAt < 9000) return cached;
  if (!pending) pending = fetch(`${endpoint}/temperature-history`, { signal: AbortSignal.timeout(8000) })
    .then(async response => {
      if (!response.ok) throw new Error('History unavailable');
      const data = await response.json() as History;
      if (!data.nodes || !Number.isFinite(Date.parse(data.generatedAt))) throw new Error('Invalid history');
      cached = data; fetchedAt = Date.now(); return data;
    }).finally(() => { pending = null; });
  return pending;
}

export default function TemperatureGraph({ node, active = true }: { node?: string; active?: boolean }) {
  const [history, setHistory] = useState(cached);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const update = async () => {
      if (document.hidden) return;
      try { const data = await readHistory(); if (!disposed) { setHistory(data); setFailed(false); } }
      catch { if (!disposed) setFailed(true); }
    };
    void update();
    const timer = window.setInterval(update, 10000);
    document.addEventListener('visibilitychange', update);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [active]);
  const now = Date.now();
  const since = now - 86400000;
  const names = node ? [node] : ['nilavus', 'nilavus-storage'];
  const series = names.map(name => ({ name, samples: (history?.nodes[name] || []).filter(s =>
    Number.isFinite(s.temperature_c) && Date.parse(s.sampled_at) >= since && Date.parse(s.sampled_at) <= now)
  }));
  const count = series.reduce((n, s) => n + s.samples.length, 0);
  const ceiling = Math.max(100, ...series.flatMap(s => s.samples.map(p => Math.ceil(p.temperature_c / 20) * 20)));
  const x = (p: Sample) => 28 + (Date.parse(p.sampled_at) - since) / 86400000 * 304;
  const y = (p: Sample) => 94 - p.temperature_c / ceiling * 80;
  return <div className="temperature-history" aria-label="Saved temperature history for the past 24 hours">
    <div className="temperature-heading"><b>THERMAL / 24H</b><small>{failed ? 'RETRYING' : history ? '10s REFRESH' : 'LOADING'}</small></div>
    <svg viewBox="0 0 340 115" role="img" aria-label={count ? 'Temperature in degrees Celsius; gaps indicate missing readings' : 'No saved readings yet'}>
      {[0, .5, 1].map(f => <g key={f}><path d={`M28 ${94 - f * 80} H332`} className="temperature-grid" /><text x="1" y={97 - f * 80}>{Math.round(f * ceiling)}°</text></g>)}
      {[0, .25, .5, .75, 1].map(f => <path key={f} d={`M${28 + 304 * f} 14 V94`} className="temperature-grid" />)}
      {series.map(({ name, samples }) => {
        const path = samples.map((p, i) => `${!i || Date.parse(p.sampled_at) - Date.parse(samples[i - 1].sampled_at) > 180000 ? 'M' : 'L'}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
        const last = samples.at(-1);
        return <g key={name} className={name === 'nilavus' ? 'temperature-laptop' : 'temperature-nas'}><path d={path} className="temperature-trace" />{last && <circle cx={x(last)} cy={y(last)} r="2.5" />}</g>;
      })}
      <text x="28" y="111">−24h</text><text x="170" y="111">−12h</text><text x="312" y="111">now</text>
      {!count && <text x="180" y="55" textAnchor="middle">{failed ? 'History unavailable' : history ? 'Collecting first readings…' : 'Loading history…'}</text>}
    </svg>
    <div className="temperature-legend">{series.map(({ name, samples }) => {
      const last = samples.at(-1);
      const stale = !last || now - Date.parse(last.sampled_at) > 180000;
      return <small key={name} className={name === 'nilavus' ? 'temperature-laptop' : 'temperature-nas'}>{name === 'nilavus' ? 'DOSIMETER' : 'NASig'} {last ? `${Math.round(last.temperature_c)}°` : '—'}{stale && last ? ' · stale' : ''}</small>;
    })}</div>
  </div>;
}
