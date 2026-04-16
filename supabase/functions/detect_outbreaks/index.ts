import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

serve(async () => {
  try {
    const apiUrl = Deno.env.get('FASTAPI_URL');
    const internalToken = Deno.env.get('INTERNAL_API_TOKEN');

    if (!apiUrl) {
      return new Response(JSON.stringify({ error: 'FASTAPI_URL is not configured.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch(`${apiUrl}/internal/detect-outbreaks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(internalToken ? { 'X-Internal-Token': internalToken } : {}),
      },
      body: JSON.stringify({ source: 'supabase-edge-cron' }),
    });

    const payload = await response.json().catch(() => ({ ok: false }));

    return new Response(JSON.stringify(payload), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
