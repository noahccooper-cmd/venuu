import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * refresh-besttime-live
 *
 * Per-cycle worker that pulls live BestTime busyness for one chunk of
 * one city, persists snapshots, updates denormalized columns, and
 * emits prediction-engine signals.
 *
 * Sized to fit in Supabase's 60s edge function ceiling. The cron in
 * migration 00013 fans out 5 invocations per cycle (knoxville,
 * tampa-a, tampa-b, stpete-a, stpete-b).
 *
 * Auth: requires X-Cron-Secret header matching CRON_SECRET env.
 *
 * Query params:
 *   ?city=knoxville|tampa|st_petersburg
 *   ?chunk=0|1   (ignored for knoxville)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FORECASTS_LIVE_URL = "https://besttime.app/api/v1/forecasts/live";
const PER_VENUE_SLEEP_MS = 200;
const ANOMALY_THRESHOLD = 30;
const VALID_CITIES = ["knoxville", "tampa", "st_petersburg"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const besttimeKey = Deno.env.get("BESTTIME_API_KEY_PRIVATE");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!besttimeKey) {
    console.error("[refresh-besttime-live] missing BESTTIME_API_KEY_PRIVATE");
    return jsonResponse({ error: "server_misconfigured", detail: "BESTTIME_API_KEY_PRIVATE not set" }, 500);
  }
  if (!supabaseUrl || !serviceKey) {
    console.error("[refresh-besttime-live] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse({ error: "server_misconfigured", detail: "supabase env not set" }, 500);
  }

  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    console.warn("[refresh-besttime-live] auth failed");
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const city = url.searchParams.get("city") ?? "";
  const chunkParam = url.searchParams.get("chunk") ?? "0";
  const chunk = Number.parseInt(chunkParam, 10);

  if (!VALID_CITIES.includes(city)) {
    return jsonResponse({ error: "invalid_city", got: city, valid: VALID_CITIES }, 400);
  }
  if (!Number.isInteger(chunk) || (chunk !== 0 && chunk !== 1)) {
    return jsonResponse({ error: "invalid_chunk", got: chunkParam, valid: [0, 1] }, 400);
  }

  const cycleStartedAt = new Date();
  const supabase = createClient(supabaseUrl, serviceKey);

  // Load all eligible venues for the city, ordered deterministically
  const { data: allVenues, error: vErr } = await supabase
    .from("venues")
    .select("id, name, besttime_venue_id")
    .eq("city", city)
    .not("besttime_venue_id", "is", null)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (vErr) {
    console.error(`[refresh-besttime-live] venues query failed: ${vErr.message}`);
    return jsonResponse({ error: "venues_query_failed", detail: vErr.message }, 500);
  }

  // Chunk selection
  let venues = allVenues ?? [];
  if (city !== "knoxville") {
    const half = Math.ceil(venues.length / 2);
    venues = chunk === 0 ? venues.slice(0, half) : venues.slice(half);
  }

  console.log(`[refresh-besttime-live] city=${city} chunk=${chunk} venues=${venues.length}`);

  let snapshotsPersisted = 0;
  let signalsForecast = 0;
  let signalsLive = 0;
  let signalsAnomaly = 0;
  let surges = 0;
  let duds = 0;
  let errorsCount = 0;
  const errorDetails: Array<{ venue: string; step: string; message: string }> = [];

  for (const venue of venues) {
    try {
      const btUrl = new URL(FORECASTS_LIVE_URL);
      btUrl.searchParams.set("api_key_private", besttimeKey);
      btUrl.searchParams.set("venue_id", venue.besttime_venue_id);

      const res = await fetch(btUrl.toString(), { method: "POST" });
      const body = await res.json();

      if (!res.ok || body.status !== "OK" || !body.analysis) {
        const message = body.message || body.status || `HTTP ${res.status}`;
        console.warn(`[refresh-besttime-live] ${venue.name}: ${message}`);
        errorsCount++;
        errorDetails.push({ venue: venue.name, step: "fetch", message: String(message) });
        await sleep(PER_VENUE_SLEEP_MS);
        continue;
      }

      const analysis = body.analysis;
      const venueInfo = body.venue_info ?? {};
      const liveAvailable = analysis.venue_live_busyness_available === true;

      const forecasted: number | null = analysis.venue_forecasted_busyness ?? null;
      const live: number | null = liveAvailable ? (analysis.venue_live_busyness ?? null) : null;
      const delta: number | null = liveAvailable ? (analysis.venue_live_forecasted_delta ?? null) : null;
      const hourStart: number | null = analysis.hour_start ?? null;
      const venueOpen: string | null = venueInfo.venue_open ?? null;

      // Update denormalized columns
      const { error: updErr } = await supabase
        .from("venues")
        .update({
          live_busyness_pct: live,
          live_busyness_vs_forecast: delta,
          live_busyness_updated_at: new Date().toISOString(),
        })
        .eq("id", venue.id);
      if (updErr) {
        console.warn(`[refresh-besttime-live] venues update failed for ${venue.name}: ${updErr.message}`);
        errorsCount++;
        errorDetails.push({ venue: venue.name, step: "venues_update", message: updErr.message });
      }

      // Insert snapshot
      const { data: snap, error: snapErr } = await supabase
        .from("besttime_live_snapshots")
        .insert({
          venue_id: venue.id,
          forecasted_busyness: forecasted,
          live_busyness: live,
          delta,
          venue_open: venueOpen,
          hour_start: hourStart,
          raw_response: body,
        })
        .select("id")
        .single();

      if (snapErr || !snap) {
        console.warn(`[refresh-besttime-live] snapshot insert failed for ${venue.name}: ${snapErr?.message}`);
        errorsCount++;
        errorDetails.push({ venue: venue.name, step: "snapshot_insert", message: snapErr?.message ?? "no row returned" });
        await sleep(PER_VENUE_SLEEP_MS);
        continue;
      }
      snapshotsPersisted++;
      const snapshotId = snap.id;

      // Emit signals
      if (forecasted !== null) {
        const { error } = await supabase.rpc("record_signal", {
          p_venue_id: venue.id,
          p_user_id: null,
          p_signal_type: "besttime_forecast_now",
          p_signal_value: forecasted,
          p_source_table: "besttime_live_snapshots",
          p_source_row_id: snapshotId,
          p_metadata: { hour_start: hourStart, source: "besttime" },
        });
        if (error) {
          errorsCount++;
          errorDetails.push({ venue: venue.name, step: "signal_forecast", message: error.message });
        } else {
          signalsForecast++;
        }
      }

      if (liveAvailable && live !== null) {
        const { error } = await supabase.rpc("record_signal", {
          p_venue_id: venue.id,
          p_user_id: null,
          p_signal_type: "besttime_live",
          p_signal_value: live,
          p_source_table: "besttime_live_snapshots",
          p_source_row_id: snapshotId,
          p_metadata: { hour_start: hourStart, source: "besttime" },
        });
        if (error) {
          errorsCount++;
          errorDetails.push({ venue: venue.name, step: "signal_live", message: error.message });
        } else {
          signalsLive++;
        }
      }

      if (liveAvailable && delta !== null && Math.abs(delta) >= ANOMALY_THRESHOLD) {
        const direction = delta > 0 ? "surge" : "dud";
        const { error } = await supabase.rpc("record_signal", {
          p_venue_id: venue.id,
          p_user_id: null,
          p_signal_type: "besttime_anomaly",
          p_signal_value: delta,
          p_source_table: "besttime_live_snapshots",
          p_source_row_id: snapshotId,
          p_metadata: { hour_start: hourStart, source: "besttime", direction, delta },
        });
        if (error) {
          errorsCount++;
          errorDetails.push({ venue: venue.name, step: "signal_anomaly", message: error.message });
        } else {
          signalsAnomaly++;
          if (direction === "surge") surges++;
          else duds++;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[refresh-besttime-live] unexpected error for ${venue.name}: ${message}`);
      errorsCount++;
      errorDetails.push({ venue: venue.name, step: "exception", message });
    }

    await sleep(PER_VENUE_SLEEP_MS);
  }

  const cycleCompletedAt = new Date();
  const durationMs = cycleCompletedAt.getTime() - cycleStartedAt.getTime();
  const signalsTotal = signalsForecast + signalsLive + signalsAnomaly;

  // Persist run-history row (non-fatal if it fails)
  const { error: runErr } = await supabase.from("besttime_refresh_runs").insert({
    cycle_started_at: cycleStartedAt.toISOString(),
    cycle_completed_at: cycleCompletedAt.toISOString(),
    city,
    chunk,
    venues_processed: venues.length,
    snapshots_persisted: snapshotsPersisted,
    signals_emitted_total: signalsTotal,
    errors_count: errorsCount,
    error_details: errorDetails.length > 0 ? errorDetails : null,
    triggered_by: "cron",
  });
  if (runErr) console.warn(`[refresh-besttime-live] run-row insert failed: ${runErr.message}`);

  console.log(
    `[refresh-besttime-live] done city=${city} chunk=${chunk} venues=${venues.length} snapshots=${snapshotsPersisted} signals=${signalsTotal} errors=${errorsCount} duration=${durationMs}ms`,
  );

  return jsonResponse({
    ok: true,
    city,
    chunk,
    venues_processed: venues.length,
    snapshots_persisted: snapshotsPersisted,
    duration_ms: durationMs,
    signals_emitted: {
      total: signalsTotal,
      forecast: signalsForecast,
      live: signalsLive,
      anomaly: signalsAnomaly,
      surges,
      duds,
    },
    errors: errorsCount,
  });
});
