import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_URL } from './max/api';
import './pc-cards.css';
export default function ShutdownControl() {
  const dialog = useRef<HTMLDialogElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return <>
    <button type="button" className="open-button pc-shutdown" onClick={() => { setMessage(''); dialog.current?.showModal(); }}>Shut down PC</button>
    {createPortal(<dialog ref={dialog} className="shutdown-dialog" onClose={() => { if (password.current) password.current.value = ''; }}>
      <form onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setMessage('');
        try {
          const response = await fetch(`${MAX_URL}/pc/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true, password: password.current?.value ?? '' }), signal: AbortSignal.timeout(15000) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'Shutdown request failed.');
          setMessage(body.message || 'Shutdown requested.');
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Shutdown request failed.'); }
        finally { if (password.current) password.current.value = ''; setBusy(false); }
      }}>
        <h2>Shut down Max-PC?</h2><p>Save your work first. This stops streaming and PC workers. Windows may block shutdown if an app needs attention.</p>
        <label>Password<input ref={password} type="password" required maxLength={128} autoComplete="off" autoFocus /></label>
        <p role="status">{message}</p>
        <div className="pc-remote-actions"><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button><button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Confirm shutdown'}</button></div>
      </form>
    </dialog>, document.body)}
  </>;
}
