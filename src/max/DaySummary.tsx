// One line on the M.A.X. card: the past day in a sentence or two, from the saved history (the
// same data and cache as the graphs). Nothing is estimated beyond the saved readings.
import { useEffect, useState } from 'react';
import { readHistory, type History, type Sample } from '../TemperatureGraph';
import { TEMP_WARN } from './telemetry';

const DAY_MS = 86_400_000;
const GAP_MS = 180_000; // same rule as the graphs: a gap over 3 minutes means no readings
const QUIET_WORTH_MENTIONING_MS = 15 * 60_000;
const NODES = ['nilavus', 'nilavus-storage'] as const;

const inDay = (samples: Sample[] | undefined, now: number) =>
  (samples ?? []).filter(s => { const t = Date.parse(s.sampled_at); return t >= now - DAY_MS && t <= now; })
    .sort((a, b) => Date.parse(a.sampled_at) - Date.parse(b.sampled_at));

/** Time inside >3 min gaps with no readings (including before the first and after the last). */
function quietMs(samples: Sample[], now: number) {
  if (!samples.length) return DAY_MS;
  const times = [now - DAY_MS, ...samples.map(s => Date.parse(s.sampled_at)), now];
  let missing = 0;
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    if (gap > GAP_MS) missing += gap;
  }
  return missing;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const duration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
};

/** "nilavus stayed between 50 and 64°C at 28% CPU on average." or "... but spiked to 92°C around 05:32." */
function nodeSentence(name: string, temperature: History | null, resource: History | null, now: number) {
  const temps = inDay(temperature?.nodes[name], now).filter(s => Number.isFinite(s.temperature_c));
  const cpu = inDay(resource?.nodes[name], now).map(s => s.cpu_percent).filter((v): v is number => Number.isFinite(v));
  if (!temps.length && !cpu.length) return `${name} has no readings from the past day.`;
  let text = name;
  if (temps.length) {
    const values = temps.map(s => s.temperature_c!).sort((a, b) => a - b);
    const peak = temps.reduce((hot, s) => (s.temperature_c! > hot.temperature_c! ? s : hot));
    const low = Math.round(percentile(values, 0.1));
    const high = Math.round(percentile(values, 0.9));
    text += peak.temperature_c! >= TEMP_WARN
      ? ` mostly ran ${low}–${high}°C but spiked to ${Math.round(peak.temperature_c!)}°C around ${clock(peak.sampled_at)}`
      : ` stayed between ${Math.round(values[0])} and ${Math.round(values[values.length - 1])}°C`;
  }
  if (cpu.length) {
    const average = Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length);
    text += average < 5 ? `${temps.length ? ' while' : ' was'} mostly idle` : `${temps.length ? ' at' : ' averaged'} ${average}% CPU${temps.length ? ' on average' : ''}`;
  }
  return `${text}.`;
}

function coverageSentence(temperature: History | null, resource: History | null, now: number) {
  const quiet = NODES.map(name => {
    const readings = inDay(resource?.nodes[name], now);
    return { name, ms: quietMs(readings.length ? readings : inDay(temperature?.nodes[name], now), now) };
  }).filter(q => q.ms >= QUIET_WORTH_MENTIONING_MS && q.ms < DAY_MS);
  if (!quiet.length) return 'Both reported all day.';
  const [first, second] = quiet;
  return second
    ? `${first.name} went quiet for about ${duration(first.ms)} in total, ${second.name} for about ${duration(second.ms)}.`
    : `${first.name} went quiet for about ${duration(first.ms)} in total.`;
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
  const text = failed ? 'History is unavailable right now.'
    : !data ? 'Reading the past day…'
    : [...NODES.map(name => nodeSentence(name, data.temperature, data.resource, now)), coverageSentence(data.temperature, data.resource, now)].join(' ');
  // A span, not a <p>: it sits inside the M.A.X. card's <button>.
  return <span className="day-summary"><b>Past 24 hours:</b> {text}</span>;
}
