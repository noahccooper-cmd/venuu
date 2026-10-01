// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * morning-rating-push — daily 10am ET (15:00 UTC) cron job.
 *
 * Finds every night_plan with rating_status = 'pending_morning' that
 * was completed in the last 24h and pushes the owning user a gentle
 * nudge to rate it. Deep links into the rate flow for that plan via
 * the { type: 'rating_prompt', planId } payload.
 *
 * Auth: caller must present `Authorization: Bearer ${CRON_SECRET}`.
 * The Supabase pg_cron job sets this header from
 * current_setting('app.settings.cron_secret').
 *
 * Token sending is delegated to the proven `send-push` function so
 * we don't reimplement APNs JWT generation. We look up each user's
 * tokens in the `push_tokens` table, then POST the batch.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  console.log('[morning-rating-push] invoked, method:', req.method);

  // ── Auth gate — only the cron job (with the shared secret) is allowed. ──
  // Accepts either the project's established `X-Cron-Secret` header
  // (used by every other pg_cron job — see 00013, 00015, 00031) OR an
  // `Authorization: Bearer <secret>` header for manual invocations.
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) {
    console.error('[morning-rating-push] CRON_SECRET env var missing');
    return new Response(JSON.stringify({ error: 'cron_secret_unconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const xCronHeader = req.headers.get('x-cron-secret');
  const authHeader = req.headers.get('authorization');
  const authedViaXCron = xCronHeader === cronSecret;
  const authedViaBearer = authHeader === `Bearer ${cronSecret}`;
  if (!authedViaXCron && !authedViaBearer) {
    console.warn('[morning-rating-push] unauthorized invocation');
    return new Response('unauthorized', { status: 401 });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'missing_supabase_env' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── Find plans that need a morning nudge. ──
  // The 24h window mirrors the user's expectation: "rate it later"
  // last night becomes "rate it this morning". Anything older has
  // probably been forgotten — don't nag.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: pendingPlans, error: pendingError } = await supabase
    .from('night_plans')
    .select('id, user_id, title, completed_at')
    .eq('rating_status', 'pending_morning')
    .gte('completed_at', since);

  if (pendingError) {
    console.error('[morning-rating-push] pending plans query failed:', pendingError.message);
    return new Response(JSON.stringify({ error: pendingError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!pendingPlans || pendingPlans.length === 0) {
    console.log('[morning-rating-push] no pending plans in window');
    return new Response(JSON.stringify({ sent: 0, failed: 0, pendingCount: 0, message: 'no pending ratings' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[morning-rating-push] found ${pendingPlans.length} pending plans`);

  const sendPushUrl = `${SUPABASE_URL}/functions/v1/send-push`;
  let sent = 0;
  let failed = 0;
  let skippedNoTokens = 0;

  for (const plan of pendingPlans as any[]) {
    // Look up this user's push tokens. night_plans.user_id is the
    // profiles.id; push_tokens.user_id stores the same profile id.
    const { data: tokens, error: tokErr } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', plan.user_id);

    if (tokErr) {
      console.warn(`[morning-rating-push] token lookup failed for user ${plan.user_id}:`, tokErr.message);
      failed++;
      continue;
    }
    if (!tokens || tokens.length === 0) {
      skippedNoTokens++;
      continue;
    }

    const tokenStrings = (tokens as any[]).map(t => t.token).filter(Boolean);
    if (tokenStrings.length === 0) {
      skippedNoTokens++;
      continue;
    }

    try {
      const resp = await fetch(sendPushUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          tokens: tokenStrings,
          title: 'how was last night?',
          body: `rate "${plan.title ?? 'last night'}" to make venny smarter →`,
          data: {
            type: 'rating_prompt',
            planId: String(plan.id ?? ''),
          },
        }),
      });

      const result = await resp.json().catch(() => ({}));
      if (resp.ok) {
        sent += Number(result?.sent ?? 0);
        failed += Number(result?.failed ?? 0);
      } else {
        failed += tokenStrings.length;
        console.error(`[morning-rating-push] send-push failed for plan ${plan.id}:`, resp.status, JSON.stringify(result));
      }
    } catch (err) {
      failed += tokenStrings.length;
      console.error(`[morning-rating-push] push error for plan ${plan.id}:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[morning-rating-push] DONE. sent=${sent} failed=${failed} skipped_no_tokens=${skippedNoTokens} pending=${pendingPlans.length}`);

  return new Response(JSON.stringify({
    sent,
    failed,
    skippedNoTokens,
    pendingCount: pendingPlans.length,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
