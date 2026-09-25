// Client for M.A.X. core (agent-v2/max_core.py) on Dosimeter, published through Tailscale
// Funnel at /ai so it works from any device, with or without Tailscale.

export const MAX_URL = (import.meta.env.VITE_AI_URL || 'https://nilavus.whydah-darter.ts.net/ai').replace(/\/$/, '');

export type CoreHealth = { provider: string; model: string; available: boolean; modelLoaded: boolean | null };
export type Row = [string, string];
export type QuickAction = 'status' | 'nas' | 'dosimeter' | 'services' | 'links' | 'storage' | 'temps' | 'load' | 'uptime'
  | 'docker' | 'network' | 'alerts';
export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type ChatEvent =
  | { type: 'meta'; rows: Row[]; telemetry: boolean; status: string }
  | { type: 'token'; text: string }
  | { type: 'done'; answer: string; corrected: boolean; seconds: number }
  | { type: 'error'; error: string };
export type HistoryTurn = { time: string; question: string; answer: string | null; error: string | null; corrected?: boolean | null; seconds?: number | null };
export type HistorySession = { id: string; started: string; last: string; via?: string; turns: HistoryTurn[] };

export async function fetchHealth(signal?: AbortSignal): Promise<CoreHealth> {
  const response = await fetch(`${MAX_URL}/health`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`M.A.X. core replied ${response.status}`);
  return response.json() as Promise<CoreHealth>;
}

/** Chat log kept on Dosimeter. null when this device isn't on the tailnet (the core refuses public reads). */
export async function fetchHistory(signal?: AbortSignal): Promise<HistorySession[] | null> {
  const response = await fetch(`${MAX_URL}/history`, { cache: 'no-store', signal });
  if (response.status === 403) return null;
  if (!response.ok) throw new Error(`M.A.X. core replied ${response.status}`);
  return ((await response.json()) as { sessions: HistorySession[] }).sessions;
}

/** POST /chat and deliver its server-sent events as they arrive. */
export async function streamChat(body: { messages?: ChatTurn[]; action?: QuickAction; session?: string }, onEvent: (event: ChatEvent) => void, signal: AbortSignal) {
  const response = await fetch(`${MAX_URL}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error ?? `M.A.X. core replied ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('');
      if (data) onEvent(JSON.parse(data) as ChatEvent);
    }
  }
}
