// Client for M.A.X. core (agent-v2/max_core.py) on Dosimeter, published through Tailscale
// Funnel at /ai so it works from any device, with or without Tailscale.

export const MAX_URL = (import.meta.env.VITE_AI_URL || 'https://nilavus.whydah-darter.ts.net/ai').replace(/\/$/, '');

export type CoreHealth = { provider: string; model: string; available: boolean; modelLoaded: boolean | null };
export type Row = [string, string];
export type DockerStatus = { reachable: boolean; engine: boolean | null; starting: boolean; canStart: boolean;
  workers: { name: string; state: string; health?: string | null }[]; error?: string; result?: string | null };

export async function fetchDocker(signal?: AbortSignal): Promise<DockerStatus> {
  const response = await fetch(`${MAX_URL}/docker`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Docker status unavailable');
  return response.json() as Promise<DockerStatus>;
}

export async function startDockerWorkers(signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${MAX_URL}/docker/start`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }), signal });
  if (!response.ok) {
    const body = await response.json() as { error?: string };
    throw new Error(body.error ?? 'Worker start request failed');
  }
}
// Apps M.A.X. can start or restart (never stop). Control is offered to the Tailscale owner only.
export type AppKey = 'jellyfin' | 'immich' | 'kavita' | 'navidrome' | 'qbit';
export type AppStatus = { key: AppKey; name: string; up: boolean; state: string; since?: number | null };
export type AppEvent = { time: string; app: AppKey; name: string; action: string; downMinutes?: number; ok: boolean };
export type ServicesStatus = { apps: AppStatus[]; events: AppEvent[]; canControl: boolean };

export type DailyReport = { date: string; text: string; generatedAt: string };

/** Daily reports written by M.A.X. just after each midnight, newest first. */
export async function fetchDaily(signal?: AbortSignal): Promise<DailyReport[]> {
  const response = await fetch(`${MAX_URL}/daily`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Daily reports unavailable');
  return ((await response.json()) as { reports: DailyReport[] }).reports;
}

// The desktop PC: is it awake, and can this visitor wake it (the Tailscale owner only)?
export type PcStatus = { up: boolean; canWake: boolean };

export async function fetchPc(signal?: AbortSignal): Promise<PcStatus> {
  const response = await fetch(`${MAX_URL}/pc`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('PC status unavailable');
  return response.json() as Promise<PcStatus>;
}

/** Ask Dosimeter to send a Wake-on-LAN packet to the PC. */
export async function wakePc(signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${MAX_URL}/pc/wake`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }), signal });
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) throw new Error(body.error ?? "Couldn't wake the PC.");
  return body.message ?? 'Wake signal sent.';
}

export async function fetchServices(signal?: AbortSignal): Promise<ServicesStatus> {
  const response = await fetch(`${MAX_URL}/services`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('App status unavailable');
  return response.json() as Promise<ServicesStatus>;
}

export async function controlService(app: AppKey, verb: 'start' | 'restart', signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${MAX_URL}/services/${app}/${verb}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }), signal });
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) throw new Error(body.error ?? `Couldn't ${verb} it.`);
  return body.message ?? `${verb} requested.`;
}

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
