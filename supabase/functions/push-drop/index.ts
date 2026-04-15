import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  console.log('[push-drop] invoked');

  try {
    const body = await req.json();
    console.log('[push-drop] payload:', JSON.stringify(body));

    const { venue_id, venue_name, drop_text, drop_id, city } = body;
    if (!city) {
      console.error('[push-drop] missing city');
      return new Response(JSON.stringify({ error: 'missing city' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const cityKey = city.split(',')[0].trim();
    const { data: tokens, error } = await supabase
      .from('push_tokens')
      .select('token')
      .ilike('city', `%${cityKey}%`);

    if (error) {
      console.error('[push-drop] query error:', error.message);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('[push-drop] found', tokens?.length ?? 0, 'tokens for city:', cityKey);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const tokenStrings = tokens.map(t => t.token);
    const sendPushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`;

    console.log('[push-drop] calling send-push with', tokenStrings.length, 'tokens');

    const resp = await fetch(sendPushUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        tokens: tokenStrings,
        title: venue_name || 'venuu',
        body: drop_text || 'New drop',
        data: { type: 'drop', venue_id: String(venue_id ?? ''), drop_id: String(drop_id ?? ''), city: cityKey },
      }),
    });

    const result = await resp.json();
    console.log('[push-drop] send-push responded', resp.status, JSON.stringify(result));

    return new Response(JSON.stringify({ success: true, ...result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[push-drop] error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
