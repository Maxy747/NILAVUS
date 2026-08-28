import { corsHeaders, json, restHeaders } from '../_shared/http.ts';

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const pepper = Deno.env.get('VISITOR_PEPPER');
  if (!pepper) return json({ error: 'visitor counter unavailable' }, 503);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('cf-connecting-ip')
    ?? 'unknown';
  const visitDate = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${visitDate}:${pepper}:${ip}`));

  const insert = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/daily_visitors?on_conflict=visit_date,visitor_hash`, {
    method: 'POST',
    headers: { ...restHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ visit_date: visitDate, visitor_hash: hex(digest) }),
  });
  if (!insert.ok) return json({ error: 'visitor counter unavailable' }, 500);

  const count = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/daily_visitors?visit_date=eq.${visitDate}&select=visitor_hash`, {
    method: 'HEAD',
    headers: { ...restHeaders(), Prefer: 'count=exact' },
  });
  const range = count.headers.get('content-range') ?? '*/0';
  const visitors = Number(range.split('/')[1] ?? 0);
  return json({ visitors: Number.isFinite(visitors) ? visitors : 0 });
});
