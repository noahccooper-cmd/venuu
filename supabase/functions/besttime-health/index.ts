import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * besttime-health
 *
 * Public health probe for the BestTime live-data pipeline.
 * No auth — returns per-city freshness, coverage, and the most
 * recent refresh runs.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const CITIES = ["knoxville", "tampa", "st_petersburg"];

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function classifyAge(ageMinutes: number | null): "fresh" | "stale" | "cold" {
  if (ageMinutes === null) return "cold";
  if (ageMinutes < 90) return "fresh";
  if (ageMinutes < 180) return "stale";
  return "cold";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const now = new Date();

  const cities: Record<string, unknown> = {};

  for (const city of CITIES) {
    const { count: totalCount, error: totalErr } = await supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .eq("city", city)
      .not("besttime_venue_id", "is", null);

    if (totalErr) {
      cities[city] = { error: totalErr.message };
      continue;
    }

    const { count: liveCount } = await supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .eq("city", city)
      .not("live_busyness_pct", "is", null);

    const { data: latest } = await supabase
      .from("venues")
      .select("live_busyness_updated_at")
      .eq("city", city)
      .not("live_busyness_updated_at", "is", null)
      .order("live_busyness_updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastRefresh: string | null = latest?.live_busyness_updated_at ?? null;
    const ageMinutes: number | null =
      lastRefresh === null ? null : Math.round((now.getTime() - new Date(lastRefresh).getTime()) / 60000);

    cities[city] = {
      last_refresh: lastRefresh,
      age_minutes: ageMinutes,
      venues_with_live: liveCount ?? 0,
      venues_total: totalCount ?? 0,
      status: classifyAge(ageMinutes),
    };
  }

  const { data: latestRuns } = await supabase
    .from("besttime_refresh_runs")
    .select("id, cycle_started_at, cycle_completed_at, city, chunk, venues_processed, snapshots_persisted, signals_emitted_total, errors_count")
    .order("cycle_started_at", { ascending: false })
    .limit(5);

  return jsonResponse({
    now: now.toISOString(),
    cities,
    latest_runs: latestRuns ?? [],
  });
});
