import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchHealth } from './api';
import MaxConsole from './MaxConsole';
import { alerts, storageStatus, systemStatus, type MaxTelemetry } from './telemetry';

type CoreState = 'checking' | 'online' | 'offline';
const HEALTH_EVERY_MS = 60_000; // /health never touches the model, so this is cheap

type Props = { telemetry: MaxTelemetry; enabled: boolean; onSound?: (name: 'click' | 'back') => void };

/** Entry points to M.A.X.: a dashboard section, a floating button, and Ctrl+K or "/". */
export default function MaxLauncher({ telemetry, enabled, onSound }: Props) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const [core, setCore] = useState<CoreState>('checking');
  const { status, storage } = useMemo(() => {
    const list = alerts(telemetry);
    return { status: systemStatus(telemetry, list), storage: storageStatus(telemetry, list) };
  }, [telemetry]);

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

  const hide = useCallback(() => {
    onSound?.('back');
    setOpen(false);
    opener.current?.focus?.(); // give focus back to whatever opened the console
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
      <button type="button" className="max-teaser-card" onClick={show}>
        <span className="max-teaser-line"><span className={`max-led ${led}`} aria-hidden="true" />M.A.X. {coreLabel} · SYSTEM STATUS: {status} · STORAGE STATUS: {storage}</span>
        <span className="max-teaser-prompt">&gt; How can I help, Max?<span className="max-cursor" aria-hidden="true">_</span></span>
        <kbd>CTRL+K</kbd>
      </button>
    </section>
    {/* Portal to <body>: the dashboard sections use transforms, which would trap position: fixed. */}
    {createPortal(open
      ? <MaxConsole telemetry={telemetry} onClose={hide} />
      : <button type="button" className="max-fab" onClick={show} aria-label={`Open M.A.X. console, ${coreLabel.toLowerCase()} (Ctrl+K)`}>
          <span className={`max-led ${led}`} aria-hidden="true" />M.A.X.
        </button>, document.body)}
  </>;
}
