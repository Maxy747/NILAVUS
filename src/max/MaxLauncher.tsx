import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchHealth } from './api';
import MaxConsole from './MaxConsole';
import DaySummary from './DaySummary';
import { alerts, storageStatus, systemStatus, type MaxTelemetry } from './telemetry';

export type CoreState = 'checking' | 'online' | 'offline';
const HEALTH_EVERY_MS = 60_000; // /health never touches the model, so this is cheap
const CLOSE_MS = 500; // matches the close animation in max.css (the opening, reversed)

// Lines the dashboard card types out in turn: questions M.A.X. really answers from telemetry.
const PROMPTS = [
  'How can I help, Max?',
  'Try: which machine is hotter?',
  'Try: how full is Bookussy?',
  'Try: is Immich up?',
  'Try: any alerts?',
  'Try: links to my apps',
  'Try: how long has NASig been up?',
];

/** Terminal-style prompt: types a line, holds it, erases it, moves to the next. */
function TypedPrompt() {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(PROMPTS[0].length); // the first line starts fully typed
  const [erasing, setErasing] = useState(false);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const line = PROMPTS[index];
  // Start the cycle only once the card is on screen (after its open animation), so the greeting
  // really is visible for its full hold instead of timing out while scrolled away or hidden.
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) { setStarted(true); return; }
    let timer = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      timer = window.setTimeout(() => setStarted(true), 700);
    });
    observer.observe(el);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!started) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let delay: number, step: () => void;
    if (still) { // no typing: just swap the whole line every few seconds
      delay = 4000; step = () => { const next = (index + 1) % PROMPTS.length; setIndex(next); setLength(PROMPTS[next].length); };
    } else if (!erasing && length < line.length) { delay = 45; step = () => setLength(n => n + 1); }
    else if (!erasing) { delay = index === 0 ? 5000 : 2800; step = () => setErasing(true); } // the greeting stays longer
    else if (length > 0) { delay = 20; step = () => setLength(n => n - 1); }
    else { delay = 350; step = () => { setErasing(false); setIndex(i => (i + 1) % PROMPTS.length); }; }
    const timer = window.setTimeout(step, delay);
    return () => window.clearTimeout(timer);
  }, [started, index, length, erasing, line.length]);
  return <span ref={ref} className="max-teaser-prompt" aria-hidden="true">&gt; {line.slice(0, length)}<span className="max-cursor">_</span></span>;
}

type Props = { telemetry: MaxTelemetry; enabled: boolean; onSound?: (name: 'click' | 'back') => void; onCoreStateChange?: (state: CoreState) => void };

/** Entry points to M.A.X.: a dashboard section, a floating button, and Ctrl+K or "/". */
export default function MaxLauncher({ telemetry, enabled, onSound, onCoreStateChange }: Props) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const [core, setCore] = useState<CoreState>('checking');
  const { status, storage } = useMemo(() => {
    const list = alerts(telemetry);
    return { status: systemStatus(telemetry, list), storage: storageStatus(telemetry, list) };
  }, [telemetry]);

  useEffect(() => { onCoreStateChange?.(core); }, [core, onCoreStateChange]);

  // The light means "is M.A.X. reachable", not system health (the status text covers that).
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const check = async (force = false) => {
      // Always check on load; skip the periodic re-checks while the tab is in the background.
      if (!force && document.visibilityState === 'hidden') return;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 6000);
      try { await fetchHealth(controller.signal); if (active) setCore('online'); }
      catch { if (active) setCore('offline'); }
      finally { window.clearTimeout(timer); }
    };
    void check(true);
    const interval = window.setInterval(() => void check(), HEALTH_EVERY_MS);
    const recheck = () => void check();
    const reconnected = () => void check(true);
    window.addEventListener('online', reconnected);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('online', reconnected);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [enabled, open]); // re-check when the console closes, too

  const show = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    onSound?.('click');
    setOpen(true);
  }, [onSound]);

  // Closing plays the opening animation backwards, then removes the console.
  const hide = useCallback(() => {
    if (closingRef.current) return;
    onSound?.('back');
    const finish = () => {
      closingRef.current = false;
      setClosing(false);
      setOpen(false);
      opener.current?.focus?.(); // give focus back to whatever opened the console
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(finish, CLOSE_MS);
  }, [onSound]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing && !open)) {
        event.preventDefault();
        if (open) hide(); else show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, open, show, hide]);

  useEffect(() => {
    document.documentElement.classList.toggle('max-open', open);
    return () => document.documentElement.classList.remove('max-open');
  }, [open]);

  if (!enabled) return null;
  const led = core; // online = green, offline = red, checking = blue pulse
  const coreLabel = core === 'online' ? 'ONLINE' : core === 'offline' ? 'OFFLINE' : 'CONNECTING';

  return <>
    <section className="max-teaser" aria-label="M.A.X. assistant">
      <div className="section-heading"><span>M.A.X.</span><b>Machine-Assisted eXecutive</b></div>
      <button type="button" className="max-teaser-card" onClick={show} aria-label={`Open M.A.X. console. M.A.X. ${coreLabel.toLowerCase()}, system status ${status.toLowerCase()}, storage status ${storage.toLowerCase()}.`}>
        <span className="max-teaser-line"><span className={`max-led ${led}`} aria-hidden="true" />M.A.X. {coreLabel} · SYSTEM STATUS: {status} · STORAGE STATUS: {storage}</span>
        <DaySummary />
        <TypedPrompt />
        <kbd>CTRL+K</kbd>
      </button>
    </section>
    {/* Portal to <body>: the dashboard sections use transforms, which would trap position: fixed. */}
    {createPortal(open
      ? <div className={closing ? 'max-closing' : undefined}><MaxConsole telemetry={telemetry} onClose={hide} /></div>
      : <button type="button" className="max-fab" onClick={show} aria-label={`Open M.A.X. console, ${coreLabel.toLowerCase()} (Ctrl+K)`}>
          <span className={`max-led ${led}`} aria-hidden="true" />M.A.X.
        </button>, document.body)}
  </>;
}
