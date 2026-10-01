import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * fuse-estimates
 *
 * Calls fuse_all_active_venues() in Postgres, which fuses all
 * non-frat active venues into headcount_estimates. Designed to run
 * once per minute via pg_cron during nightlife hours.
 *
 * The work is entirely SQL-side, so a 75-venue cycle finishes in
 * a couple of seconds — well under Supabase's 60s edge ceiling.
 *
 * Auth: requires X-Cron-Secret header matching CRON_SECRET env.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    console.error("[fuse-estimates] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    console.warn("[fuse-estimates] auth failed");
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const startedAt = Date.now();

  console.log("[fuse-estimates] invoking fuse_all_active_venues");

  const { data, error } = await supabase.rpc("fuse_all_active_venues");

  const durationMs = Date.now() - startedAt;

  if (error) {
    console.error(`[fuse-estimates] rpc failed in ${durationMs}ms: ${error.message}`);
    return jsonResponse({ error: "rpc_failed", detail: error.message, duration_ms: durationMs }, 500);
  }

  const venuesUpdated = typeof data === "number" ? data : Number(data) || 0;

  console.log(`[fuse-estimates] done venues=${venuesUpdated} duration=${durationMs}ms`);

  return jsonResponse({
    ok: true,
    venues_updated: venuesUpdated,
    duration_ms: durationMs,
  });
});
