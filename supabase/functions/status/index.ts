import { corsHeaders, json, restHeaders } from '../_shared/http.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/node_status?select=*`, {
    headers: restHeaders(),
  });
  if (!response.ok) return json({ error: 'status unavailable' }, 500);

  const rows = await response.json() as Array<Record<string, unknown>>;
  const nodes: Record<string, unknown> = {};
  const now = Date.now();
  for (const row of rows) {
    const receivedAt = Date.parse(String(row.received_at));
    nodes[String(row.node_name)] = {
      online: Number.isFinite(receivedAt) && now - receivedAt < 90_000,
      temperatureC: row.temperature_c,
      cpuPercent: row.cpu_percent,
      memoryPercent: row.memory_percent,
      diskPercent: row.disk_percent,
      uptimeSeconds: row.uptime_seconds,
      load: row.load,
      services: row.services,
      receivedAt: row.received_at,
    };
  }
  for (const name of ['nilavus', 'nilavus-storage']) {
    nodes[name] ??= { online: false, services: {} };
  }
  return json({ nodes });
});
