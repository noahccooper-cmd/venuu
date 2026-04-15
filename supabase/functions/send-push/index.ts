import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function importES256Key(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function makeApnsJwt(keyId: string, teamId: string, keyPem: string): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const signInput = `${header}.${claims}`;
  const key = await importES256Key(keyPem);
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signInput));
  const sig = base64url(new Uint8Array(sigBuf));
  return `${signInput}.${sig}`;
}

async function sendViaApns(
  jwt: string,
  bundleId: string,
  sandbox: boolean,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<{ ok: boolean; status: number; error?: string }> {
  const host = sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const url = `https://${host}/3/device/${token}`;
  const payload = {
    aps: {
      alert: { title, body },
      sound: 'default',
      badge: 1,
    },
    ...data,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (resp.ok) return { ok: true, status: resp.status };
  const errText = await resp.text();
  return { ok: false, status: resp.status, error: errText };
}

Deno.serve(async (req) => {
  console.log('[send-push] invoked, method:', req.method);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { tokens, title, body: messageBody, data } = body;

    console.log('[send-push] tokens received:', tokens?.length ?? 0);
    console.log('[send-push] title:', title, 'body:', messageBody);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const keyId = Deno.env.get('APNS_KEY_ID');
    const teamId = Deno.env.get('APNS_TEAM_ID');
    const keyPem = Deno.env.get('APNS_KEY');
    const bundleId = Deno.env.get('APNS_BUNDLE_ID') ?? 'com.venuu.app';
    const sandbox = (Deno.env.get('APNS_SANDBOX') ?? 'false').toLowerCase() === 'true';

    console.log('[send-push] APNS config — keyId:', keyId, 'teamId:', teamId, 'bundle:', bundleId, 'sandbox:', sandbox);
    console.log('[send-push] APNS_KEY present:', !!keyPem, 'length:', keyPem?.length ?? 0);

    if (!keyId || !teamId || !keyPem) {
      console.error('[send-push] missing APNs env vars');
      return new Response(JSON.stringify({ error: 'APNs env vars missing (need APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID)' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let jwt: string;
    try {
      jwt = await makeApnsJwt(keyId, teamId, keyPem);
      console.log('[send-push] APNs JWT created, length:', jwt.length);
    } catch (err) {
      console.error('[send-push] JWT creation failed:', err.message);
      return new Response(JSON.stringify({ error: 'JWT creation failed: ' + err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const stringData: Record<string, string> = {};
    if (data) for (const k of Object.keys(data)) stringData[k] = String(data[k] ?? '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let sent = 0;
    let failed = 0;
    const stale: string[] = [];
    const sampleErrors: any[] = [];

    for (const token of tokens) {
      try {
        const result = await sendViaApns(jwt, bundleId, sandbox, token, title ?? 'venuu', messageBody ?? '', stringData);
        if (result.ok) {
          sent++;
        } else {
          failed++;
          if (sampleErrors.length < 5) sampleErrors.push({ token: token.substring(0, 12), status: result.status, error: result.error });
          if (result.error && (result.error.includes('BadDeviceToken') || result.error.includes('Unregistered'))) {
            stale.push(token);
          }
        }
      } catch (err) {
        failed++;
        if (sampleErrors.length < 5) sampleErrors.push({ token: token.substring(0, 12), error: err.message });
      }
    }

    if (stale.length > 0) {
      console.log('[send-push] cleaning up', stale.length, 'stale tokens');
      await supabase.from('push_tokens').delete().in('token', stale);
    }

    console.log('[send-push] DONE. sent:', sent, 'failed:', failed, 'total:', tokens.length);
    if (sampleErrors.length > 0) console.log('[send-push] sample errors:', JSON.stringify(sampleErrors));

    return new Response(
      JSON.stringify({ sent, failed, total: tokens.length, sampleErrors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[send-push] fatal error:', err.message, err.stack);
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
