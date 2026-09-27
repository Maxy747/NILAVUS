import { corsHeaders, json, restHeaders } from '../_shared/http.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const now = new Date();
  const since = new Date(now.getTime() - 86400000).toISOString();
  try {
    const nodes = Object.fromEntries(await Promise.all(['Dosimeter', 'NASig', 'WD 1 TB', 'Bookussy'].map(async name => {
      const pages = await Promise.all([0, 1000].map(async offset => {
        const query = new URLSearchParams({ select: 'sampled_at,used_percent', drive_name: `eq.${name}`,
          sampled_at: `gte.${since}`, order: 'bucket.asc', limit: '1000', offset: String(offset) });
        const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/disk_history?${query}`, { headers: restHeaders() });
        if (!response.ok) throw new Error('History read failed');
        return await response.json();
      }));
      return [name, pages.flat()];
    })));
    return json({ nodes, generatedAt: now.toISOString() });
  } catch {
    return json({ error: 'Disk history unavailable' }, 503);
  }
});
