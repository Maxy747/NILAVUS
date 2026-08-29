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

    const body = await request.text();
    if (body.length > 65_536) {
      return new Response(JSON.stringify({ error: 'payload too large' }), {
        status: 413,
        headers: responseHeaders,
      });
    }

    const upstream = await env.TELEMETRY_RELAY.fetch('https://relay/heartbeat', {
      method: 'POST',
      headers: {
        Authorization: request.headers.get('Authorization') ?? '',
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
