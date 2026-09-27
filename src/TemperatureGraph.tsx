import { useEffect, useState } from 'react';
import './temperature-graph.css';

type Sample = { sampled_at: string; temperature_c?: number; used_percent?: number; cpu_percent?: number; memory_percent?: number; power_on_hours?: number };
type Metric = 'temperature' | 'disk' | 'cpu' | 'ram' | 'smart';
const titles: Record<Metric, string> = { temperature: 'THERMAL / 24H', disk: 'DISK USAGE / 24H', cpu: 'CPU USAGE / 24H', ram: 'RAM USAGE / 24H', smart: 'SMART HOURS / 24H' };
type History = { nodes: Record<string, Sample[]>; generatedAt: string };
const endpoint = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || 'https://gibzoyvvmwvprkubfhvc.supabase.co/functions/v1').replace(/\/$/, '');
const cache: Partial<Record<Metric, { data: History; at: number }>> = {};
const pending: Partial<Record<Metric, Promise<History>>> = {};
async function readHistory(metric: Metric) {
  const key = metric === 'ram' ? 'cpu' : metric;
  const cached = cache[key];
  if (cached && Date.now() - cached.at < 9000) return cached.data;
  if (!pending[key]) pending[key] = fetch(`${endpoint}/${key === 'cpu' ? 'resource' : key}-history`, { signal: AbortSignal.timeout(8000) })
    .then(async response => {
      if (!response.ok) throw new Error('History unavailable');
      const data = await response.json() as History;
      if (!data.nodes || !Number.isFinite(Date.parse(data.generatedAt))) throw new Error('Invalid history');
      cache[key] = { data, at: Date.now() }; return data;
    }).finally(() => { delete pending[key]; });
  return pending[key]!;
}

export default function TemperatureGraph({ node, active = true, selectable = false, initialMetric = 'temperature', storageOnly = false }: { node?: string; active?: boolean; selectable?: boolean; initialMetric?: Metric; storageOnly?: boolean }) {
  const [metric, setMetric] = useState<Metric>(initialMetric);
  const [history, setHistory] = useState(cache[metric]?.data);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setHistory(cache[metric]?.data);
    setFailed(false);
    if (!active) return;
    let disposed = false;
    const update = async () => {
      if (document.hidden) return;
      try { const data = await readHistory(metric); if (!disposed) { setHistory(data); setFailed(false); } }
      catch { if (!disposed) setFailed(true); }
    };
    void update();
    const timer = window.setInterval(update, 10000);
    document.addEventListener('visibilitychange', update);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [active, metric]);
  const now = Date.now();
  const since = now - 86400000;
  const disk = metric === 'disk';
  const smart = metric === 'smart';
  const percent = metric !== 'temperature' && !smart;
  const unit = smart ? 'h' : percent ? '%' : '°';
  const gap = smart ? 1800000 : 180000;
  const value = (s: Sample) => (smart ? s.power_on_hours : disk ? s.used_percent : metric === 'cpu' ? s.cpu_percent : metric === 'ram' ? s.memory_percent : s.temperature_c) ?? NaN;
  const names = disk || smart ? ['Dosimeter', 'NASig', 'WD 1 TB', 'Bookussy'] : node ? [node] : ['nilavus', 'nilavus-storage'];
  const color = (name: string) => ['nilavus', 'Dosimeter'].includes(name) ? 'temperature-laptop' : name === 'WD 1 TB' ? 'history-drive-wd' : name === 'Bookussy' ? 'history-drive-bookussy' : 'temperature-nas';
  const series = names.map(name => ({ name, samples: (history?.nodes[name] || []).filter(s =>
    Number.isFinite(value(s)) && Date.parse(s.sampled_at) >= since && Date.parse(s.sampled_at) <= now)
  }));
  const count = series.reduce((n, s) => n + s.samples.length, 0);
  const ceiling = Math.max(100, ...series.flatMap(s => s.samples.map(p => Math.ceil(value(p) / (smart ? 1000 : 20)) * (smart ? 1000 : 20))));
  const x = (p: Sample) => 28 + (Date.parse(p.sampled_at) - since) / 86400000 * 304;
  const y = (p: Sample) => 94 - value(p) / ceiling * 80;
  return <div className="temperature-history" aria-label={`Saved ${metric} history for the past 24 hours`}>
    <div className="temperature-heading">{selectable ? <select className="history-selector" aria-label="History graph" value={metric} onChange={event => setMetric(event.target.value as Metric)}>{(Object.keys(titles) as Metric[]).filter(key => storageOnly ? ['disk', 'smart'].includes(key) : !node || !['disk', 'smart'].includes(key)).map(key => <option key={key} value={key}>{titles[key]}</option>)}</select> : <b>{titles[metric]}</b>}<small>{failed ? 'RETRYING' : history ? smart ? '15m SAMPLES' : '10s REFRESH' : 'LOADING'}</small></div>
    <svg viewBox="0 0 340 115" role="img" aria-label={count ? `${smart ? 'Lifetime SMART power-on hours' : percent ? `${metric} usage in percent` : 'Temperature in degrees Celsius'}; gaps indicate missing readings` : 'No saved readings yet'}>
      {[0, .5, 1].map(f => <g key={f}><path d={`M28 ${94 - f * 80} H332`} className="temperature-grid" /><text x="1" y={97 - f * 80}>{smart && f * ceiling >= 1000 ? `${+(f * ceiling / 1000).toFixed(1)}k` : Math.round(f * ceiling)}{unit}</text></g>)}
      {[0, .25, .5, .75, 1].map(f => <path key={f} d={`M${28 + 304 * f} 14 V94`} className="temperature-grid" />)}
      {series.map(({ name, samples }) => {
        const path = samples.map((p, i) => `${!i || Date.parse(p.sampled_at) - Date.parse(samples[i - 1].sampled_at) > gap ? 'M' : 'L'}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
        const last = samples.at(-1);
        return <g key={name} className={color(name)}><path d={path} className="temperature-trace" />{last && <circle cx={x(last)} cy={y(last)} r="2.5" />}</g>;
      })}
      <text x="28" y="111">−24h</text><text x="170" y="111">−12h</text><text x="312" y="111">now</text>
      {!count && <text x="180" y="55" textAnchor="middle">{failed ? 'History unavailable' : history ? 'Collecting first readings…' : 'Loading history…'}</text>}
    </svg>
    <div className="temperature-legend">{series.map(({ name, samples }) => {
      const last = samples.at(-1);
      const stale = !last || now - Date.parse(last.sampled_at) > gap;
      return <small key={name} className={color(name)}>{name === 'nilavus' ? 'DOSIMETER' : name === 'nilavus-storage' ? 'NASig' : name} {last ? `${percent ? value(last).toFixed(1) : Math.round(value(last))}${unit}` : smart ? 'unavailable' : '—'}{stale && last ? ' · stale' : ''}</small>;
    })}</div>
    {smart && <small className="smart-history-note">Lifetime powered-on hours · not reboot uptime</small>}
  </div>;
}
