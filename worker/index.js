const HEARTBEAT_URL =
  'https://gibzoyvvmwvprkubfhvc.supabase.co/functions/v1/heartbeat';

const responseHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== '/heartbeat') {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405,
        headers: { ...responseHeaders, Allow: 'POST' },
      });
    }

    if (
      !env.TELEMETRY_SECRET ||
      request.headers.get('Authorization') !== `Bearer ${env.TELEMETRY_SECRET}`
    ) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: responseHeaders,
      });
    }

    const body = await request.text();
    if (body.length > 65_536) {
      return new Response(JSON.stringify({ error: 'payload too large' }), {
        status: 413,
        headers: responseHeaders,
      });
    }

    const upstream = await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TELEMETRY_SECRET}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};
