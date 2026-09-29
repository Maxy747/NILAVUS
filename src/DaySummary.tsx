// One line above System Health: what the last 24 hours looked like, from the saved history
// (the same data and cache as the graphs). Nothing is estimated beyond the saved readings.
import { useEffect, useState } from 'react';
import { readHistory, type History, type Sample } from './TemperatureGraph';

const DAY_MS = 86_400_000;
const GAP_MS = 180_000; // same rule as the graphs: a gap over 3 minutes means no readings
const NODES = ['nilavus', 'nilavus-storage'] as const;

const inDay = (samples: Sample[] | undefined, now: number) =>
  (samples ?? []).filter(s => { const t = Date.parse(s.sampled_at); return t >= now - DAY_MS && t <= now; })
    .sort((a, b) => Date.parse(a.sampled_at) - Date.parse(b.sampled_at));

/** Share of the day covered by readings: time not inside a >3 min gap (including before the first/after the last). */
function reported(samples: Sample[], now: number) {
  if (!samples.length) return 0;
  const times = [now - DAY_MS, ...samples.map(s => Date.parse(s.sampled_at)), now];
  let missing = 0;
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    if (gap > GAP_MS) missing += gap;
  }
  return Math.max(0, Math.min(100, 100 * (1 - missing / DAY_MS)));
}

function summary(name: string, temperature: History | null, resource: History | null, now: number) {
  const temps = inDay(temperature?.nodes[name], now).map(s => s.temperature_c).filter((v): v is number => Number.isFinite(v));
  const readings = inDay(resource?.nodes[name], now);
  const cpu = readings.map(s => s.cpu_percent).filter((v): v is number => Number.isFinite(v));
  const parts: string[] = [];
  if (temps.length) parts.push(`${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))}°C`);
  if (cpu.length) parts.push(`CPU avg ${Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length)}%`);
  const coverage = readings.length ? readings : inDay(temperature?.nodes[name], now);
  parts.push(`reported ${Math.floor(reported(coverage, now))}%`);
  return parts.join(' · ');
}

export default function DaySummary() {
  const [data, setData] = useState<{ temperature: History | null; resource: History | null } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    const update = async () => {
      if (document.hidden) return;
      const [temperature, resource] = await Promise.allSettled([readHistory('temperature'), readHistory('cpu')]);
      if (disposed) return;
      const value = <T,>(r: PromiseSettledResult<T>) => r.status === 'fulfilled' ? r.value : null;
      if (temperature.status === 'rejected' && resource.status === 'rejected') { setFailed(true); return; }
      setFailed(false);
      setData({ temperature: value(temperature), resource: value(resource) });
    };
    void update();
    const timer = window.setInterval(update, 60_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const now = Date.now();
  return <p className="day-summary" aria-live="off">
    <b>LAST 24 H</b>
    {failed ? <span>History unavailable</span>
      : !data ? <span>Reading history…</span>
      : NODES.map(name => <span key={name}><em>{name}</em> {summary(name, data.temperature, data.resource, now)}</span>)}
  </p>;
}
