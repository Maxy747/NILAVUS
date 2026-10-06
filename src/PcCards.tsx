import { useEffect, useState } from 'react';
import { fetchPc, wakePc, type PcStatus } from './max/api';
import './pc-cards.css';

export function usePcStatus() {
  const [pc, setPc] = useState<PcStatus | null>(null);
  const [message, setMessage] = useState('');
  const [until, setUntil] = useState(0);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const result = await fetchPc(AbortSignal.timeout(8000));
        if (!disposed) {
          setPc(result);
          if (until && result.up) { setMessage('Awake — ready to connect.'); setUntil(0); }
          else if (until && Date.now() >= until) { setMessage('No response yet. Check PC power and Wake-on-LAN.'); setUntil(0); }
        }
      } catch { if (!disposed) { setPc(null); if (until && Date.now() >= until) { setUntil(0); setMessage('Unable to verify wake-up.'); } } }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, until ? 5000 : 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [until]);
  const wake = async () => {
    if (!pc?.canWake || until || !window.confirm('Send a wake signal to Max-PC?')) return;
    setUntil(Date.now() + 120000);
    setMessage('Waking… waiting for Max-PC.');
    try { await wakePc(AbortSignal.timeout(10000)); }
    catch (error) { setUntil(0); setMessage(error instanceof Error ? error.message : 'Wake request failed.'); }
  };
  return { pc, message, waking: !!until, wake };
}
export type PcControl = ReturnType<typeof usePcStatus>;
const label = (pc: PcStatus | null) => pc === null ? 'UNKNOWN' : pc.up ? 'AWAKE' : 'ASLEEP';
function PcLogo() {
  return <svg className="pc-logo" width="24" height="24" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="24" height="17" rx="2.5" /><path d="M11 27h10M16 22v5" /></svg>;
}
function OverdriveLogo() {
  return <img className="overdrive-logo" src={`${import.meta.env.BASE_URL}logos/maximum-overdrive.png`} alt="" width="40" height="40" />;
}
export function PcLight({ control }: { control: PcControl }) {
  return <div className={`status ${control.pc === null ? 'checking' : control.pc.up ? 'online' : 'offline'}`}><span />Max-PC {label(control.pc)}</div>;
}
function Wake({ control }: { control: PcControl }) {
  return <>{control.pc?.canWake && !control.pc.up && <button className="open-button" disabled={control.waking} onClick={() => void control.wake()}>{control.waking ? 'Waking…' : 'Wake PC'}</button>}
    <small className="pc-message" role="status">{control.message}</small></>;
}
export function PcMini({ control }: { control: PcControl }) {
  const [flipped, setFlipped] = useState(false);
  return <section className={`pc-mini ${control.pc?.up ? 'pc-awake' : ''}`} aria-label="Max-PC power">
    <div className={`pc-mini-inner ${flipped ? 'pc-flipped' : ''}`}>
      <button className="pc-mini-front" inert={flipped} aria-hidden={flipped} onClick={() => setFlipped(true)} aria-label="Show Max-PC wake controls"><PcLogo /><span>Max-PC</span><b>{label(control.pc)}</b></button>
      <div className="pc-mini-back" inert={!flipped} aria-hidden={!flipped} role="button" tabIndex={flipped ? 0 : -1} aria-label="Show Max-PC status"
        onClick={event => { if (!(event.target as Element).closest('button')) setFlipped(false); }}
        onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setFlipped(false); } }}><Wake control={control} />
        {!control.pc?.canWake && <small>Wake controls require the owner on Tailscale.</small>}
        {control.pc?.up && <small>Max-PC is awake.</small>}
        </div>
    </div>
  </section>;
}
export function PcRemote({ control }: { control: PcControl }) {
  const [instructions, setInstructions] = useState(false);
  return <article className={`service-card pc-remote ${control.pc?.up ? 'pc-awake' : 'pc-dim'}`}>
    <div className="card-top"><span className="service-icon"><PcLogo /></span><span className="access">● {label(control.pc)}</span></div>
    <div className="card-copy"><span className="group-label">Remote</span><h2>Max-PC</h2><p>Stream your desktop · Sunshine (RTX 3060)</p></div>
    <div className="card-bottom"><div className="destination-block"><span className="host-label">100.95.55.83 · Tailscale only</span></div>
      <div className="pc-remote-actions"><a className="open-button" href="https://100.95.55.83:47990/" target="_blank" rel="noreferrer">Sunshine settings ↗</a><button className="open-button" disabled={!control.pc?.up} onClick={() => setInstructions(value => !value)}>Open Moonlight ↗</button></div>
      <Wake control={control} />
      {instructions && <p className="pc-instructions">Open the Moonlight app → tap <b>Max-PC</b>. Connect Tailscale when away from home.</p>}
      <small>Tailscale + Sunshine login required. ASLEEP means not reachable, not confirmed power-off.</small>
    </div>
  </article>;
}
export function OverdriveCard() {
  return <article className="service-card overdrive-card"><div className="card-top"><span className="service-icon"><OverdriveLogo /></span><span className="access">PRIVATE</span></div>
    <div className="card-copy"><span className="group-label">Personal</span><h2>MAXimum Overdrive</h2><p>Private training &amp; coach</p></div>
    <div className="card-bottom"><span className="host-label">Runs on Dosimeter · Private app</span><a className="open-button" href="https://nilavus.whydah-darter.ts.net/max/" rel="noreferrer">Open ↗</a></div>
  </article>;
}
