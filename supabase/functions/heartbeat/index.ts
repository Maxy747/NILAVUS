import { corsHeaders, json, restHeaders } from '../_shared/http.ts';

const allowedNodes = new Set(['nilavus', 'nilavus-storage']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const expected = Deno.env.get('TELEMETRY_SECRET');
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const nodeName = payload?.nodeName;
  if (typeof nodeName !== 'string' || !allowedNodes.has(nodeName)) {
    return json({ error: 'invalid node' }, 400);
  }

  const row = {
    node_name: nodeName,
    received_at: new Date().toISOString(),
    temperature_c: payload?.temperatureC ?? null,
    cpu_percent: payload?.cpuPercent ?? null,
    memory_percent: payload?.memoryPercent ?? null,
    disk_percent: payload?.diskPercent ?? null,
    uptime_seconds: payload?.uptimeSeconds ?? null,
    load: Array.isArray(payload?.load) ? payload.load : [],
    services: typeof payload?.services === 'object' && payload.services !== null ? payload.services : {},
  };

  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/node_status?on_conflict=node_name`, {
    method: 'POST',
    headers: { ...restHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });

  if (!response.ok) return json({ error: 'heartbeat rejected' }, 500);
  return json({ ok: true });
});
