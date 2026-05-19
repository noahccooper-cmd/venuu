// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * promote-presence
 *
 * Cron-invoked every 5 minutes by the schedule in migration 00031.
 *
 * The client-side proximity detector promotes confirmed visits when
 * the user actively exits a venue's geofence and the 20-min cooldown
 * elapses. But sessions where the app got killed, GPS dropped, or
 * the user walked off without the watcher seeing the exit can leave
 * "dangling" ENTERs with no corresponding EXIT and no user_visits
 * row. This worker synthesizes the missing visit using the latest
 * still_present timestamp as the proxy last_seen_at.
 *
 * Cutoff window:
 *   • ENTER must be older than 30 min (gives the client a fair shot
 *     at promoting it first).
 *   • Most-recent still_present/ENTER must be older than 25 min
 *     (the user is genuinely gone, not still hanging out).
 *   • Synthesized visit only counts if duration >= 5 min — avoids
 *     promoting "walked past the door" pings.
 *
 * Confidence is lower than client-confirmed visits (80 if >=10 min,
 * 60 if 5-10 min) so a future ML weighting pass can tell them apart.
 *
 * Auth: X-Cron-Secret header (set by the migration's net.http_post).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DanglingRow {
  user_id: string;
  venue_id: string;
  entered_at: string;
  last_seen_at: string;
}

interface PromoteResult {
  dangling: number;
  promoted: number;
  skipped_too_short: number;
  errors: number;
  error_details?: string[];
}

function computeNightOf(dt: Date): string {
  const d = new Date(dt);
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function confidenceForMinutes(minutes: number): number {
  // Lower than client-confirmed (100/70/50) so an ML weighting pass
  // can later distinguish synthesized from observed visits.
  if (minutes >= 10) return 80;
  return 60;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Auth — cron secret. Reject anything else.
  const provided = req.headers.get('x-cron-secret');
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected || provided !== expected) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'missing_env' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Cutoffs — the RPC needs both. 30-min and 25-min thresholds match
  // the spec (give the client first crack at a clean exit before the
  // cron synthesizes one).
  const now = Date.now();
  const cutoffISO    = new Date(now - 30 * 60_000).toISOString();
  const stalemarkISO = new Date(now - 25 * 60_000).toISOString();

  const { data: dangling, error: rpcErr } = await supabase.rpc(
    'find_dangling_enters',
    { p_cutoff: cutoffISO, p_stalemark: stalemarkISO },
  );

  if (rpcErr) {
    console.error('[promote-presence] RPC error:', rpcErr.message);
    return new Response(
      JSON.stringify({ error: 'rpc_failed', message: rpcErr.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const rows: DanglingRow[] = (dangling ?? []) as DanglingRow[];
  const result: PromoteResult = {
    dangling: rows.length,
    promoted: 0,
    skipped_too_short: 0,
    errors: 0,
    error_details: [],
  };

  for (const row of rows) {
    const enteredAt = new Date(row.entered_at);
    const lastSeenAt = new Date(row.last_seen_at);
    const minutes = (lastSeenAt.getTime() - enteredAt.getTime()) / 60_000;

    if (minutes < 5) {
      result.skipped_too_short += 1;
      continue;
    }

    const nightOf = computeNightOf(enteredAt);
    const durationMin = Math.min(480, Math.max(0, Math.round(minutes)));

    const { error: upsertErr } = await supabase
      .from('user_visits')
      .upsert(
        {
          user_id: row.user_id,
          venue_id: row.venue_id,
          night_of: nightOf,
          first_seen_at: enteredAt.toISOString(),
          last_seen_at: lastSeenAt.toISOString(),
          duration_min: durationMin,
          source: 'passive',
          confidence: confidenceForMinutes(minutes),
        },
        { onConflict: 'user_id,venue_id,night_of' },
      );

    if (upsertErr) {
      result.errors += 1;
      if (result.error_details && result.error_details.length < 5) {
        result.error_details.push(
          `${row.user_id}/${row.venue_id}: ${upsertErr.message}`,
        );
      }
      console.warn('[promote-presence] upsert failed:', upsertErr.message);
      continue;
    }
    result.promoted += 1;
  }

  if (result.error_details && result.error_details.length === 0) {
    delete result.error_details;
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
