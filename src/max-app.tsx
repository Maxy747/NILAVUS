// Standalone M.A.X. (max.html): the same console as the dashboard, filling its own window,
// so it can be installed as a separate desktop app (Edge/Chrome: "Install M.A.X.").
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import MaxConsole from './max/MaxConsole';
import { maxTelemetryFrom, useNodeStatus } from './status';
import './max/standalone.css';

// Installed-app windows open at the browser's default size. Offer a sidebar-sized window the
// first time only; after that the browser remembers whatever size Max drags it to.
const SIZED_KEY = 'max-app-sized-v1';
const installed = window.matchMedia('(display-mode: standalone)').matches;
try {
  if (installed && !localStorage.getItem(SIZED_KEY)) {
    window.resizeTo(460, Math.min(900, screen.availHeight));
    localStorage.setItem(SIZED_KEY, '1');
  }
} catch { /* resizing is a nicety; browsers may refuse it */ }

// In a narrow window the quick actions become one sideways-scrolling row, and a mouse wheel
// only scrolls vertically: turn wheel turns over that row into horizontal scrolling.
// Trackpads' sideways swipes (deltaX) keep working as they are.
document.addEventListener('wheel', event => {
  const row = (event.target as Element | null)?.closest?.('.max-quick');
  if (!(row instanceof HTMLElement) || row.scrollWidth <= row.clientWidth) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  const step = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 40 : event.deltaY;
  row.scrollBy({ left: step });
  event.preventDefault();
}, { passive: false });

function MaxApp() {
  const { health, statusLive } = useNodeStatus();
  const telemetry = useMemo(() => maxTelemetryFrom(health, statusLive), [health, statusLive]);
  // ESC / close: an installed window can close itself; in a normal tab this does nothing.
  return <MaxConsole telemetry={telemetry} onClose={() => window.close()} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MaxApp />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
