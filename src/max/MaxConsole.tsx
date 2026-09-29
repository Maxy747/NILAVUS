import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { controlService, fetchDaily, fetchServices, type AppKey, fetchDocker, startDockerWorkers, fetchHealth, fetchHistory, MAX_URL, streamChat, type DockerStatus, type ChatTurn, type CoreHealth, type HistorySession, type QuickAction, type Row } from './api';
import { alertKey, alerts as deriveAlerts, drives, greeting, NODE_LABEL, NODES, nodesReporting, pct, serviceUp, shortUptime, storageStatus, STORAGE_WARN, systemStatus, type MaxTelemetry } from './telemetry';
import './max.css';
import TemperatureGraph, { type Metric } from '../TemperatureGraph';
import { chatExpired } from './chatDay';

type Entry = {
  id: number; kind: 'max' | 'user' | 'alert' | 'system'; text: string; time: string;
  rows?: Row[]; pending?: boolean; corrected?: boolean; seconds?: number; error?: boolean; level?: 'critical' | 'warning';
  graph?: Metric; // a live history graph with its picker, opened on this metric
};

// "restart jellyfin", "start immich", "turn on the music"... Fixed apps and verbs only (no stop).
const APP_WORDS: [RegExp, AppKey][] = [
  [/\b(jellyfin|movies?|tv)\b/i, 'jellyfin'], [/\b(immich|photos?)\b/i, 'immich'], [/\b(kavita|books?|comics?)\b/i, 'kavita'],
  [/\b(navidrome|music)\b/i, 'navidrome'], [/\b(qbittorrent|qbit|torrents?|downloads?)\b/i, 'qbit'],
];
const CONTROL_VERB = /\b(restart|reboot|start|turn on|bring up|boot)\b/i;
const controlRequest = (text: string): { app: AppKey; verb: 'start' | 'restart' } | null => {
  const verb = text.match(CONTROL_VERB)?.[1]?.toLowerCase();
  const app = APP_WORDS.find(([pattern]) => pattern.test(text))?.[1];
  if (!verb || !app || /\b(stop|kill|shut ?down|disable)\b/i.test(text)) return null;
  return { app, verb: verb === 'restart' || verb === 'reboot' ? 'restart' : 'start' };
};

// "show graphs", "cpu graph", "temperature chart"... answered locally from the saved history:
// no model, and it works while the AI core is offline.
const GRAPH_REQUEST = /\b(graphs?|charts?|plots?)\b/i;
const graphMetric = (text: string): Metric =>
  /\b(cpu|processor)\b/i.test(text) ? 'cpu' : /\b(ram|memory)\b/i.test(text) ? 'ram'
    : /\b(smart|power.?on|hours)\b/i.test(text) ? 'smart' : /\b(disk|storage|drive|space)\b/i.test(text) ? 'disk' : 'temperature';
type Core = { state: 'checking' } | { state: 'online'; health: CoreHealth } | { state: 'offline' };

const LOG_KEY = 'max-log-v1';
const ANNOUNCED_KEY = 'max-announced-v1';
const loadAnnounced = (): string[] => { try { return JSON.parse(localStorage.getItem(ANNOUNCED_KEY) ?? '[]') as string[]; } catch { return []; } };
const saveAnnounced = (keys: string[]) => { try { localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(keys)); } catch { /* this device only */ } };
const BOOT_KEY = 'max-booted';
const DAILY_KEY = 'max-daily-shown-v1';
const QUICK: { action: QuickAction | 'graphs'; label: string }[] = [
  { action: 'status', label: 'SYSTEM STATUS' }, { action: 'alerts', label: 'ALERTS' },
  { action: 'graphs', label: 'GRAPHS' },
  { action: 'dosimeter', label: 'CHECK DOSIMETER' }, { action: 'nas', label: 'CHECK NAS' },
  { action: 'services', label: 'CHECK SERVICES' }, { action: 'links', label: 'APP LINKS' },
  { action: 'storage', label: 'STORAGE' }, { action: 'temps', label: 'TEMPERATURES' },
  { action: 'load', label: 'RESOURCES' }, { action: 'uptime', label: 'UPTIME' },
  { action: 'network', label: 'NETWORK' }, { action: 'docker', label: 'DOCKER' },
];

// Chat history. Each conversation has an id that goes with every question, so Dosimeter's
// chat log groups it the same way. CLR archives the current one on this device; the HISTORY
// view shows those plus Dosimeter's log when this device is on the tailnet.
const SESSION_KEY = 'max-session-v1';
const ARCHIVE_KEY = 'max-sessions-v1';
const ARCHIVE_LIMIT = 30;
type Session = { id: string; started: string };
type SavedChat = { id: string; started: string; last: string; entries: Entry[] };
type PastChat = { id: string; last: string; title: string; count: number; entries: Entry[]; source: 'DEVICE' | 'DOSIMETER' | 'BOTH' };
const newSession = (): Session => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
  started: new Date().toISOString(),
});
const saveSession = (session: Session) => { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* this device only */ } };
const loadSession = (): Session => {
  try { const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null; if (saved?.id) return saved; } catch { /* fall through */ }
  const session = newSession();
  saveSession(session);
  return session;
};
const loadArchive = (): SavedChat[] => { try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? '[]') as SavedChat[]; } catch { return []; } };
const saveArchive = (chats: SavedChat[]) => { try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(chats.slice(0, ARCHIVE_LIMIT))); } catch { /* storage full: keep what fits */ } };
const when = (iso: string) => new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const fromServer = (session: HistorySession): Entry[] => session.turns.flatMap((turn, index) => [
  { id: index * 2, kind: 'user' as const, text: turn.question, time: timeOf(turn.time) },
  { id: index * 2 + 1, kind: 'max' as const, text: turn.answer ?? turn.error ?? '', error: !turn.answer, time: timeOf(turn.time),
    corrected: Boolean(turn.corrected), seconds: turn.seconds ?? undefined },
]);

/** This device's archive and Dosimeter's log, merged by conversation id, newest first. */
function pastChats(archive: SavedChat[], server: HistorySession[] | null, currentId: string): PastChat[] {
  const byId = new Map<string, PastChat>();
  const summary = (entries: Entry[]) => ({
    title: entries.find(e => e.kind === 'user')?.text ?? '(no questions)', count: entries.filter(e => e.kind === 'user').length,
  });
  for (const chat of server ?? []) {
    const entries = fromServer(chat);
    byId.set(chat.id, { id: chat.id, last: chat.last, entries, source: 'DOSIMETER', ...summary(entries) });
  }
  for (const chat of archive) {
    // The device copy has the telemetry rows, so it wins when both exist.
    byId.set(chat.id, { id: chat.id, last: chat.last, entries: chat.entries, source: byId.has(chat.id) ? 'BOTH' : 'DEVICE', ...summary(chat.entries) });
  }
  return [...byId.values()].filter(chat => chat.id !== currentId && chat.count > 0).sort((a, b) => b.last.localeCompare(a.last));
}

const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const loadLog = (): Entry[] => {
  try { return (JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as Entry[]).filter(e => !e.pending); } catch { return []; }
};
const saveLog = (log: Entry[]) => {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log.filter(e => !e.pending).slice(-40))); } catch { /* per-device history only */ }
};

const linkify = (text: string): ReactNode[] => text.split(/(https?:\/\/[^\s)]+)/g).map((part, index) => {
  if (!/^https?:\/\//.test(part)) return part;
  const url = part.replace(/[.,]$/, '');
  return <a key={index} href={url} rel="noreferrer" referrerPolicy="no-referrer">{url}</a>;
});

export default function MaxConsole({ telemetry, onClose }: { telemetry: MaxTelemetry; onClose: () => void }) {
  const [core, setCore] = useState<Core>({ state: 'checking' });
  const [log, setLog] = useState<Entry[]>(loadLog);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [docker, setDocker] = useState<DockerStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { setDocker(await fetchDocker(AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]))); }
      catch { if (!controller.signal.aborted) setDocker(null); }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  const [booting, setBooting] = useState(() => { try { return !sessionStorage.getItem(BOOT_KEY) && !reducedMotion(); } catch { return false; } });
  const [bootLines, setBootLines] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false); // mobile: system panel collapsed by default
  const [session, setSession] = useState(loadSession);
  const [archive, setArchive] = useState(loadArchive);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<PastChat | null>(null);
  const [serverHistory, setServerHistory] = useState<HistorySession[] | null | 'loading' | 'error'>(null);
  const nextId = useRef(Date.now());
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;
  const announcedRef = useRef<string[] | null>(null);
  const logLength = useRef(log.length);
  logLength.current = log.length;

  const alertList = useMemo(() => deriveAlerts(telemetry), [telemetry]);
  const status = systemStatus(telemetry, alertList);
  const storage = storageStatus(telemetry, alertList);

  const checkCore = useCallback(async () => {
    setCore({ state: 'checking' });
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    try { setCore({ state: 'online', health: await fetchHealth(controller.signal) }); } catch { setCore({ state: 'offline' }); } finally { window.clearTimeout(timer); }
  }, []);

  useEffect(() => { void checkCore(); }, [checkCore]);

  // The daily report M.A.X. writes just after midnight: shown once per day, on the first open.
  const coreOnline = core.state === 'online';
  useEffect(() => {
    if (!coreOnline) return;
    const controller = new AbortController();
    void fetchDaily(controller.signal).then(reports => {
      const latest = reports[0];
      if (!latest) return;
      try { if (localStorage.getItem(DAILY_KEY) === latest.date) return; localStorage.setItem(DAILY_KEY, latest.date); } catch { /* show it anyway */ }
      const day = new Date(`${latest.date}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
      setLog(list => [...list, { id: nextId.current++, kind: 'max', time: clock(), text: `Daily report for ${day}: ${latest.text}` }]);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [coreOnline]);

  // Proactive alerts, written by code from live telemetry (no inference). Runs on open and
  // on every telemetry refresh, so an alert that appears later is announced when it appears,
  // not buried in a greeting from an earlier session.
  // The "already announced" bookkeeping lives in a ref and is updated synchronously here (not
  // inside a state updater), so overlapping runs can never announce the same alert twice.
  useEffect(() => {
    if (!telemetry.live) return;
    announcedRef.current ??= loadAnnounced();
    const known = announcedRef.current;
    const keys = alertList.map(alertKey);
    const added: Entry[] = [];
    if (logLength.current === 0) {
      // First open: the greeting already names every active alert.
      added.push({ id: nextId.current++, kind: 'max', text: greeting(telemetry), time: clock() });
    } else {
      for (const alert of alertList) {
        if (!known.includes(alertKey(alert))) added.push({ id: nextId.current++, kind: 'alert', level: alert.level, text: alert.message, time: clock() });
      }
      const activeSources = new Set(alertList.map(a => a.source));
      for (const source of new Set(known.map(key => key.split('|')[0]))) {
        if (!activeSources.has(source)) added.push({ id: nextId.current++, kind: 'system', text: `Resolved: ${source} is back to normal.`, time: clock() });
      }
    }
    announcedRef.current = keys;
    saveAnnounced(keys);
    logLength.current += added.length;
    if (added.length) setLog(log => [...log, ...added]);
  }, [alertList, telemetry]);

  useEffect(() => { saveLog(log); }, [log]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' }); }, [log]);

  // Boot sequence: once per session, skippable, skipped entirely with reduced motion.
  // Every line is a real check: nothing reads OK unless it answered.
  const reporting = nodesReporting(telemetry);
  const bootScript = useMemo(() => {
    const line = (label: string, value: string) => `${label} ${'.'.repeat(Math.max(3, 17 - label.length))} ${value}`;
    const ready = core.state === 'online' && core.health.available;
    return [
      'NILAVUS SYSTEM', '--------------', 'INITIALIZING M.A.X....', '',
      line('DEVICE NETWORK', navigator.onLine ? 'OK' : 'OFFLINE'),
      line('TELEMETRY', !telemetry.live ? 'UNAVAILABLE' : reporting === NODES.length ? 'OK'
        : reporting === 0 ? 'NO MACHINES REPORTING' : `PARTIAL (${reporting}/${NODES.length})`),
      line('M.A.X. CORE', core.state === 'checking' ? 'CHECKING' : core.state === 'online' ? 'OK' : 'OFFLINE'),
      line('AI MODEL', core.state !== 'online' ? '—' : ready ? 'READY' : 'UNAVAILABLE'),
      '', ready ? 'M.A.X. READY.' : 'M.A.X. LIMITED: TELEMETRY ONLY.',
    ];
  }, [telemetry.live, reporting, core]);
  const finishBoot = useCallback(() => {
    setBooting(false);
    try { sessionStorage.setItem(BOOT_KEY, '1'); } catch { /* per-tab only */ }
  }, []);
  useEffect(() => {
    if (!booting) return;
    if (bootLines >= bootScript.length) { const done = window.setTimeout(finishBoot, 500); return () => window.clearTimeout(done); }
    // Hold on the core line until the health check has answered.
    if (bootScript[bootLines]?.startsWith('M.A.X. CORE') && core.state === 'checking') return;
    const next = window.setTimeout(() => setBootLines(n => n + 1), 110);
    return () => window.clearTimeout(next);
  }, [booting, bootLines, bootScript, core.state, finishBoot]);

  useEffect(() => { if (!booting) inputRef.current?.focus(); }, [booting]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const update = (id: number, fields: Partial<Entry>) => setLog(list => list.map(e => e.id === id ? { ...e, ...fields } : e));

  const showGraph = (asked: string, metric: Metric) => {
    setInput('');
    setHistoryOpen(false);
    setLog(list => [...list, { id: nextId.current++, kind: 'user', text: asked, time: clock() },
      { id: nextId.current++, kind: 'max', time: clock(), graph: metric,
        text: 'Saved history for the last 24 hours. Pick Thermal, Disk, CPU, RAM or SMART hours below.' }]);
  };

  const send = async (request: { text?: string; action?: QuickAction; label?: string }) => {
    if (busy) return;
    if (request.text && GRAPH_REQUEST.test(request.text)) { showGraph(request.text, graphMetric(request.text)); return; }
    if (core.state !== 'online') return;
    const shown = request.label ?? request.text ?? '';
    if (!shown.trim()) return;
    setInput('');
    setBusy(true);
    setHistoryOpen(false);
    const history: ChatTurn[] = log.filter(e => (e.kind === 'user' || e.kind === 'max') && !e.error && !e.pending)
      .slice(-3).map(e => ({ role: e.kind === 'user' ? 'user' : 'assistant', content: e.text }));
    const userEntry: Entry = { id: nextId.current++, kind: 'user', text: shown, time: clock() };
    const replyId = nextId.current++;
    setLog(list => [...list, userEntry, { id: replyId, kind: 'max', text: '', time: clock(), pending: true }]);
    const controller = new AbortController();
    abortRef.current = controller;
    let streamed = '';
    try {
      const control = request.text ? controlRequest(request.text) : null;
      if (control) {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
        const status = await fetchServices(signal);
        const app = status.apps.find(a => a.key === control.app);
        const name = app?.name ?? control.app;
        const rows: Row[] = status.apps.map(a => [a.name.toUpperCase(), a.up ? 'RUNNING' : a.state.toUpperCase()]);
        if (!status.canControl) {
          update(replyId, { text: `Only you, connected through Tailscale with the owner account, can start or restart apps. ${name} is ${app?.up ? 'running' : 'down'}.`, rows, pending: false });
          return;
        }
        if (control.verb === 'start' && app?.up) {
          update(replyId, { text: `${name} is already running. Say "restart ${name.toLowerCase()}" if it's misbehaving.`, rows, pending: false });
          return;
        }
        if (control.verb === 'restart' && app?.up) {
          update(replyId, { text: `Waiting for confirmation to restart ${name}…`, rows });
          await new Promise(resolve => window.setTimeout(resolve, 50));
          if (!window.confirm(`Restart ${name}? Anyone using it right now will be interrupted.`)) {
            update(replyId, { text: `Left ${name} alone.`, rows, pending: false });
            return;
          }
        }
        update(replyId, { text: `${control.verb === 'restart' ? 'Restarting' : 'Starting'} ${name}…`, rows });
        const message = await controlService(control.app, control.verb, signal);
        // Give it a moment, then report what actually happened.
        await new Promise(resolve => window.setTimeout(resolve, 8000));
        const after = await fetchServices(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])).catch(() => null);
        const now = after?.apps.find(a => a.key === control.app);
        update(replyId, { pending: false, rows: after ? after.apps.map(a => [a.name.toUpperCase(), a.up ? 'RUNNING' : a.state.toUpperCase()]) : rows,
          text: now?.up ? `${message} ${name} is up.` : `${message} ${name} isn't answering yet; it can take a minute (Immich longer). Ask again shortly.` });
        return;
      }
      if (request.action === 'docker' || /\b(start|run|enable|turn on)\b.{0,40}\b(docker|(?:pc |immich )?workers)\b/i.test(request.text ?? '')) {
        const state = await fetchDocker(AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
        setDocker(state);
        const rows: Row[] = [['PC DOCKER', !state.reachable ? 'UNREACHABLE' : state.engine === null ? 'UNKNOWN' : state.engine ? 'RUNNING' : 'STOPPED'],
          ...state.workers.map(w => [w.name === 'immich_pc_microservices' ? 'BACKGROUND WORKER' : 'GPU / ML WORKER',
            `${w.state.toUpperCase()}${w.health ? ` / ${w.health.toUpperCase()}` : ''}`] as Row)];
        const stopped = state.reachable && (state.engine === false || state.workers.some(w => ['created', 'exited'].includes(w.state)));
        let text = !state.reachable || state.error ? state.error ?? 'PC unavailable.' : state.starting ? 'PC workers are starting.'
          : stopped ? 'Some PC workers are stopped.' : 'Live PC worker status. Running does not guarantee jobs are completing.';
        if (state.result) text += `\n${state.result}`;
        if (stopped && !state.canStart) text += '\nConnect Tailscale with the owner account, then press DOCKER to start them.';
        update(replyId, { text, rows, pending: false });
        if (stopped && state.canStart && !state.starting) {
          // Let React paint the status before asking; typed start requests are explicit.
          if (request.action === 'docker') {
            await new Promise(resolve => window.setTimeout(resolve, 100));
            if (controller.signal.aborted || !window.confirm('Your PC is reachable and some Immich workers are stopped. Turn them on now? Docker Desktop will also start if needed.')) return;
          }
          await startDockerWorkers(AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
          update(replyId, { text: 'Start request accepted. Allow up to two minutes, then press DOCKER again to verify. The sidebar refreshes automatically.', rows, pending: false });
        }
        return;
      }
      await streamChat(request.action ? { action: request.action, session: session.id }
        : { messages: [...history, { role: 'user', content: request.text! }], session: session.id }, event => {
        if (event.type === 'meta') update(replyId, { rows: event.rows });
        else if (event.type === 'token') { streamed += event.text; update(replyId, { text: streamed }); }
        else if (event.type === 'done') update(replyId, { text: event.answer, corrected: event.corrected, seconds: event.seconds, pending: false });
        else update(replyId, { text: event.error, error: true, pending: false });
      }, controller.signal);
      update(replyId, { pending: false });
    } catch (error) {
      if (controller.signal.aborted) update(replyId, { text: streamed ? `${streamed} [interrupted]` : '[ interrupted ]', pending: false });
      else {
        update(replyId, { text: `Connection to M.A.X. core lost. ${error instanceof Error ? error.message : ''}`.trim(), error: true, pending: false });
        void checkCore();
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send({ text: input }); }
  };

  const clear = (daily = false) => {
    abortRef.current?.abort();
    const t = telemetryRef.current;
    announcedRef.current = deriveAlerts(t).map(alertKey); // the fresh greeting names them all
    saveAnnounced(announcedRef.current);
    const saved = log.some(e => e.kind === 'user');
    if (saved) {
      const next = [{ id: session.id, started: session.started, last: new Date().toISOString(), entries: log.filter(e => !e.pending) },
        ...archive.filter(chat => chat.id !== session.id)].slice(0, ARCHIVE_LIMIT);
      setArchive(next);
      saveArchive(next);
    }
    const fresh = newSession();
    setSession(fresh);
    saveSession(fresh);
    setLog([{ id: nextId.current++, kind: 'system', text: daily ? 'Daily reset · 06:00 IST. Previous conversation saved in HISTORY.' : saved ? 'New conversation. The previous one is in HISTORY.' : 'Conversation cleared.', time: clock() },
      { id: nextId.current++, kind: 'max', text: greeting(t), time: clock() }]);
  };

  const rolloverRef = useRef(() => {});
  rolloverRef.current = () => {
    // Finish an in-flight answer before archiving it; never discard a streamed reply.
    if (!busy && chatExpired(session.started)) clear(true);
  };
  useEffect(() => {
    const check = () => rolloverRef.current();
    check();
    const interval = window.setInterval(check, 1000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  const openHistory = async () => {
    setHistoryOpen(true);
    setViewing(null);
    if (core.state !== 'online') return;
    setServerHistory('loading');
    try { setServerHistory(await fetchHistory()); } catch { setServerHistory('error'); }
  };
  const closeHistory = () => { setHistoryOpen(false); setViewing(null); inputRef.current?.focus(); };
  const chats = useMemo(() => pastChats(archive, Array.isArray(serverHistory) ? serverHistory : null, session.id),
    [archive, serverHistory, session.id]);
  const serverNote = serverHistory === 'loading' ? 'Dosimeter log: loading…'
    : serverHistory === 'error' ? 'Dosimeter log: could not be read.'
    : serverHistory === null ? (core.state === 'online' ? 'Dosimeter log: only readable on your tailnet. Showing chats saved on this device.'
      : 'Dosimeter log: AI core offline. Showing chats saved on this device.')
    : `Dosimeter log: ${serverHistory.length} conversation${serverHistory.length === 1 ? '' : 's'}.`;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (booting) finishBoot();
        else if (viewing) setViewing(null);
        else if (historyOpen) setHistoryOpen(false);
        else onClose();
      }
      else if (booting) finishBoot();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booting, finishBoot, onClose, historyOpen, viewing]);

  const coreLabel = core.state === 'online' ? 'ONLINE' : core.state === 'offline' ? 'OFFLINE' : 'CONNECTING';
  const t = telemetry;
  // live: the current conversation (interactive); false for a read-only past one.
  const renderEntry = (entry: Entry, live: boolean) => <article key={entry.id} className={`max-entry ${entry.kind}${entry.level ? ` ${entry.level}` : ''}${entry.error ? ' error' : ''}`}>
              <header>{entry.kind === 'user' ? 'MAX // USER' : entry.kind === 'alert' ? 'M.A.X. // ALERT' : entry.kind === 'system' ? 'SYSTEM' : 'M.A.X.'} <time>// {entry.time}</time></header>
              {entry.pending && !entry.text
                ? <p className="max-processing">M.A.X. // PROCESSING<span className="max-bar" aria-hidden="true" /></p>
                : <p>{linkify(entry.text)}{entry.pending && <span className="max-cursor" aria-hidden="true">_</span>}</p>}
              <div className={live && entry.rows?.some(([label]) => label === 'DOSIMETER MIN' || label === 'NASIG MIN') ? 'max-temperature-layout' : undefined}>
              {entry.rows && entry.rows.length > 0 && <dl className="max-rows">{entry.rows.map(([label, value], index) =>
                [<dt key={`l${index}`}>{label}</dt>, <dd key={`v${index}`}>{linkify(value)}</dd>])}</dl>}
              {live && entry.kind === 'max' && entry.rows?.some(([label]) => label === 'DOSIMETER MIN' || label === 'NASIG MIN') &&
                <section className="max-reply-graph" aria-label="Live 24-hour temperature graphs">
                  <TemperatureGraph />
                  <small className="dim">Live last 24 hours · summary above reflects when you asked</small>
                </section>}
              </div>
              {entry.graph && (live
                ? <section className="max-reply-graph max-graph-picker" aria-label="Saved 24-hour history graphs">
                    <TemperatureGraph selectable initialMetric={entry.graph} />
                  </section>
                : <p className="dim">[ graph: open GRAPHS for the current history ]</p>)}
              {live && entry.kind === 'alert' && core.state === 'online' && (() => {
                const offline = entry.text.match(/^(.+) is offline\.$/)?.[1];
                const app = offline && APP_WORDS.find(([pattern]) => pattern.test(offline))?.[1];
                return app ? <button type="button" className="max-inline" disabled={busy}
                  onClick={() => void send({ text: `start ${offline}`, label: `[ START ${offline.toUpperCase()} ]` })}>[ START {offline.toUpperCase()} ]</button> : null;
              })()}
              {live && entry.kind === 'alert' && core.state === 'online' && <button type="button" className="max-inline" disabled={busy}
                onClick={() => void send({ action: 'alerts', label: '[ ANALYZE ALERTS ]' })}>[ ANALYZE ]</button>}
              {(entry.corrected || entry.seconds != null) && <footer>
                {entry.corrected && <span>Model answer didn't match telemetry; showing verified facts.</span>}
                {entry.seconds != null && <span>{entry.seconds.toFixed(1)}s</span>}
              </footer>}
            </article>;

  return <div className="max-overlay" role="dialog" aria-modal="true" aria-label="M.A.X. console">
    <div className="max-shell">
      <header className="max-header">
        <div className="max-title">
          <strong>M.A.X.</strong>
          <span>Machine-Assisted eXecutive</span>
        </div>
        <div className="max-header-status">
          <span className={`max-led ${core.state}`} aria-hidden="true" /><span>{coreLabel}</span>
          <span className="max-sep" aria-hidden="true">│</span>
          <span className={`max-sys ${status.toLowerCase()}`}>SYSTEM STATUS: {status}</span>
          <span className="max-sep" aria-hidden="true">│</span>
          <span className={`max-sys ${storage.toLowerCase()}`}>STORAGE STATUS: {storage}</span>
        </div>
        <button className="max-close" type="button" onClick={onClose} aria-label="Close M.A.X. console">ESC ×</button>
      </header>

      {booting ? <section className="max-boot" aria-live="polite" onClick={finishBoot}>
        <pre>{bootScript.slice(0, bootLines).join('\n')}<span className="max-cursor" aria-hidden="true">_</span></pre>
        <button type="button" className="max-skip" onClick={finishBoot}>SKIP ▸</button>
      </section> : <div className="max-body">
        <aside className={`max-panel ${panelOpen ? 'open' : ''}`} aria-label="Live system information">
          <button className="max-panel-toggle" type="button" aria-expanded={panelOpen} onClick={() => setPanelOpen(open => !open)}>
            <span>SYSTEM</span><span>{t.live ? `${alertList.length ? `${alertList.length} ALERT${alertList.length === 1 ? '' : 'S'}` : 'ALL CLEAR'}` : 'NO TELEMETRY'} {panelOpen ? '▴' : '▾'}</span>
          </button>
          <div className="max-panel-body">
            {!t.live ? <div className="max-block warn">
              <h3>TELEMETRY UNAVAILABLE</h3>
              <p>M.A.X. cannot access live system information.</p>
            </div> : <>
              {NODES.map(name => {
                const node = t.nodes[name];
                return <div className="max-block" key={name}>
                  <h3><span className={`max-led ${node?.online ? 'online' : 'offline'}`} aria-hidden="true" />{NODE_LABEL[name]}<em>{node?.online ? 'ONLINE' : 'OFFLINE'}</em></h3>
                  {node?.online && <dl>
                    <dt>CPU</dt><dd>{pct(node.cpuPercent)}</dd>
                    <dt>MEMORY</dt><dd>{pct(node.memoryPercent)}</dd>
                    <dt>DISK</dt><dd>{pct(node.diskPercent)}</dd>
                    <dt>TEMP</dt><dd>{node.temperatureC == null ? '—' : `${Math.round(node.temperatureC)}C`}</dd>
                    <dt>UPTIME</dt><dd>{shortUptime(node.uptimeSeconds)}</dd>
                  </dl>}
                </div>;
              })}
              <div className="max-block">
                <h3>SERVICES</h3>
                <dl>{t.services.map(service => {
                  const up = serviceUp(t, service);
                  return [<dt key={`${service.key}-n`}>{service.name.toUpperCase()}</dt>,
                    <dd key={`${service.key}-v`} className={up ? 'ok' : 'bad'}>{up ? 'ONLINE' : 'OFFLINE'}</dd>];
                })}
                  <dt>PC DOCKER</dt><dd className={!docker?.reachable ? 'dim' : docker.engine ? 'up' : 'down'} title="PC Immich worker bridge; refreshes every 15 seconds">{!docker ? 'UNKNOWN' : !docker.reachable ? 'UNREACHABLE' : docker.starting ? 'STARTING' : docker.engine === null ? 'UNKNOWN' : docker.engine ? `${docker.workers.filter(w => w.state === 'running').length}/2 RUNNING` : 'STOPPED'}</dd>
                </dl>
              </div>
              <div className="max-block">
                <h3>STORAGE</h3>
                <dl>{drives(t).map(drive => [<dt key={`${drive.name}-n`}>{drive.name.toUpperCase()}</dt>,
                  <dd key={`${drive.name}-v`} className={drive.usedPercent != null && drive.usedPercent >= STORAGE_WARN ? 'bad' : ''}>
                    {drive.online ? pct(drive.usedPercent) : 'UNMOUNTED'}</dd>])}
                </dl>
              </div>
            </>}
            <div className="max-block">
              <h3>NETWORK</h3>
              <dl>
                <dt>THIS DEVICE</dt><dd className={navigator.onLine ? 'ok' : 'bad'}>{navigator.onLine ? 'ONLINE' : 'OFFLINE'}</dd>
                <dt>TELEMETRY</dt><dd className={t.live ? 'ok' : 'bad'}>{t.live ? 'LINKED' : 'LOST'}</dd>
                <dt>AI CORE</dt><dd className={core.state === 'online' ? 'ok' : core.state === 'offline' ? 'bad' : ''}>{coreLabel}</dd>
              </dl>
            </div>
            {t.live && <div className="max-block">
              <h3>ALERTS</h3>
              {alertList.length ? <ul>{alertList.map(a => <li key={a.message} className={a.level}>{a.message}</li>)}</ul> : <p className="dim">None active.</p>}
            </div>}
            <div className="max-block max-thermal-block"><TemperatureGraph selectable /></div>
          </div>
        </aside>

        <section className="max-console" aria-label="Conversation">
          {core.state === 'offline' && <div className="max-offline" role="status">
            <h2>AI CORE OFFLINE</h2>
            <p>The M.A.X. interface is available, but the AI provider cannot be reached.
              Dosimeter may be offline, or the M.A.X. service isn't running.</p>
            <p className="dim">AI endpoint: {MAX_URL}</p>
            <button type="button" onClick={() => void checkCore()}>[ RETRY ]</button>
          </div>}

          {historyOpen ? <div className="max-log max-history" aria-label="Chat history">
            <div className="max-history-bar">
              {viewing ? <button type="button" onClick={() => setViewing(null)}>◂ BACK</button> : <strong>HISTORY</strong>}
              <span>{viewing ? `${when(viewing.last)} · ${viewing.source}` : `${chats.length} past conversation${chats.length === 1 ? '' : 's'}`}</span>
              <button type="button" onClick={closeHistory}>CURRENT ▸</button>
            </div>
            {viewing ? viewing.entries.map(entry => renderEntry(entry, false)) : <>
              <p className="dim max-history-note">{serverNote}</p>
              {chats.length ? <ul className="max-history-list">{chats.map(chat => <li key={chat.id}>
                <button type="button" onClick={() => setViewing(chat)}>
                  <time>{when(chat.last)}</time>
                  <span className="max-history-title">{chat.title}</span>
                  <span className="dim">{chat.count} question{chat.count === 1 ? '' : 's'} · {chat.source}</span>
                </button>
              </li>)}</ul> : <p className="dim">No past conversations yet. CLR saves the current one here and starts a new one.</p>}
            </>}
          </div> : <div className="max-log" ref={logRef} aria-live="polite">
            {log.map(entry => renderEntry(entry, true))}
          </div>}

          <div className="max-quick" role="group" aria-label="Quick actions">
            {QUICK.map(q => q.action === 'graphs'
              ? <button key={q.action} type="button" disabled={busy} onClick={() => showGraph(`[ ${q.label} ]`, 'temperature')}>[ {q.label} ]</button>
              : <button key={q.action} type="button" disabled={busy || core.state !== 'online'}
                  onClick={() => void send({ action: q.action as QuickAction, label: `[ ${q.label} ]` })}>[ {q.label} ]</button>)}
          </div>

          <div className="max-prompt">
            <span aria-hidden="true">&gt;</span>
            <textarea ref={inputRef} rows={1} value={input} maxLength={600} disabled={core.state !== 'online'}
              placeholder={core.state === 'online' ? (busy ? 'M.A.X. is working…' : 'Ask M.A.X.')
                : 'AI core offline'}
              aria-label="Message M.A.X." onChange={event => setInput(event.target.value)} onKeyDown={onKeyDown} />
            {busy
              ? <button type="button" onClick={() => abortRef.current?.abort()}>STOP</button>
              : <button type="button" disabled={!input.trim() || core.state !== 'online'} onClick={() => void send({ text: input })}>SEND</button>}
            <button type="button" className="max-clear" onClick={() => void (historyOpen ? closeHistory() : openHistory())}
              aria-pressed={historyOpen} aria-label="Chat history">HISTORY</button>
            <button type="button" className="max-clear" onClick={() => clear()} aria-label="Save this conversation and start a new one">CLR</button>
          </div>
        </section>
      </div>}
      <div className="max-scanlines" aria-hidden="true" />
    </div>
  </div>;
}
