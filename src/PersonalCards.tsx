import { useState } from 'react';
export default function PersonalCards() {
  const [selected, setSelected] = useState(false);
  return <>
    <article className="service-card personal-reader">
      <div className="card-top"><span className="service-icon" aria-hidden="true">◉</span><span className="access">TAILSCALE ONLY</span></div>
      <div className="card-copy"><span className="group-label">Chats</span><h2>WhatsApp Reader</h2><p>Browse your exported conversations</p></div>
      <div className="card-bottom"><div className="reader-toggle" role="group" aria-label="Chat reader version">
        <button aria-pressed={!selected} onClick={() => setSelected(false)}>General</button><button aria-pressed={selected} onClick={() => setSelected(true)}>Selected</button>
      </div><span className="host-label">Dosimeter · {selected ? 'Selected chats' : 'General reader'}</span>
      <a className="open-button" href={`http://100.89.154.37:${selected ? 8879 : 8878}/`} target="_blank" rel="noreferrer">Open ↗</a></div>
    </article>
    <article className="service-card personal-reader iphone-gallery">
      <div className="card-top"><span className="service-icon" aria-hidden="true">▧</span><span className="access">TAILSCALE ONLY</span></div>
      <div className="card-copy"><span className="group-label">Photos</span><h2>iPhone Gallery</h2><p>Browse your iPhone photo backup</p></div>
      <div className="card-bottom"><span className="host-label">Dosimeter · Gallery backup</span><a className="open-button" href="http://100.89.154.37:8877/" target="_blank" rel="noreferrer">Open ↗</a></div>
    </article>
    <article className="service-card personal-reader novel-card">
      <div className="card-top"><span className="service-icon" aria-hidden="true">▤</span><span className="access">PUBLIC</span></div>
      <div className="card-copy"><span className="group-label">Novel</span><h2>She's a Liar</h2><p>My novel · Read online</p></div>
      <div className="card-bottom"><span className="host-label">Available anywhere · No Tailscale needed</span><a className="open-button" href="https://maxy747.github.io/shes-a-liar-book/" target="_blank" rel="noreferrer">Read ↗</a></div>
    </article>
  </>;
}
