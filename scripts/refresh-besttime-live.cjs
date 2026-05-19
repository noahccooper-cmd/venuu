#!/usr/bin/env node
/**
 * Pull live BestTime busyness for every covered venue, persist
 * snapshots, update denormalized columns on venues, and emit
 * prediction-engine signals.
 *
 * One BestTime call PER VENUE (not per city) — the /venues/filter
 * endpoint returns forecast data only, not live. /forecasts/live is
 * the only endpoint that returns true live busyness, and it's
 * per-venue. We accept the higher API cost for accurate live data.
 *
 * Becomes a pg_cron edge function in Prompt 7; tonight we run it
 * from the laptop to validate.
 *
 * Usage:
 *   node scripts/refresh-besttime-live.cjs --once
 *     One refresh cycle then exit. Use this for testing.
 *
 *   node scripts/refresh-besttime-live.cjs --continuous
 *     Loop forever, ~30 min between cycles. Skips 3am–5pm local
 *     (no nightlife = wasted credits).
 *
 * Env required:
 *   BESTTIME_API_KEY_PRIVATE
 *   SUPABASE_URL  (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const BESTTIME_KEY = process.env.BESTTIME_API_KEY_PRIVATE;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!BESTTIME_KEY) {
  console.error('ERROR: BESTTIME_API_KEY_PRIVATE not found in .env');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const FORECASTS_LIVE_URL = 'https://besttime.app/api/v1/forecasts/live';
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min between cycles
const PER_VENUE_SLEEP_MS = 200;             // 5 req/sec ceiling — half BestTime's 10/sec
const ANOMALY_THRESHOLD = 30;               // |delta| >= 30 fires besttime_anomaly

const args = process.argv.slice(2);
const isOnce = args.includes('--once');
const isContinuous = args.includes('--continuous');

if (!isOnce && !isContinuous) {
  console.log('Usage:');
  console.log('  --once         One refresh cycle then exit');
  console.log('  --continuous   Loop every 30 min, skipping 3am–5pm local');
  process.exit(0);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * True between 03:00 and 17:00 local — wasted credits in this window.
 */
function isOffHours() {
  const hour = new Date().getHours();
  return hour >= 3 && hour < 17;
}

/**
 * POST /v1/forecasts/live for one venue. Returns the parsed body
 * (with .status, .analysis, .venue_info), or null on transport error.
 */
async function fetchVenueLive(besttimeVenueId) {
  const url = new URL(FORECASTS_LIVE_URL);
  url.searchParams.set('api_key_private', BESTTIME_KEY);
  url.searchParams.set('venue_id', besttimeVenueId);

  try {
    const res = await fetch(url.toString(), { method: 'POST' });
    const data = await res.json();
    return { httpOk: res.ok, status: res.status, body: data };
  } catch (err) {
    return { httpOk: false, status: 0, body: null, transportError: err.message };
  }
}

/**
 * Apply one venue's live data to the database:
 *   - update venues denormalized columns
 *   - insert besttime_live_snapshots row
 *   - emit 1-3 record_signal RPC calls
 * Returns { forecast, live, anomalies, surges, duds, persisted }.
 */
async function applyVenueLive(venuuVenue, analysis, venueInfo, rawResponse) {
  const forecasted = analysis?.venue_forecasted_busyness ?? null;
  const liveAvailable = analysis?.venue_live_busyness_available === true;
  const live = liveAvailable ? (analysis?.venue_live_busyness ?? null) : null;
  const delta = analysis?.venue_live_forecasted_delta ?? null;
  const hourStart = analysis?.hour_start ?? null;
  const venueOpen = venueInfo?.venue_open ?? null;

  const result = { forecast: 0, live: 0, anomalies: 0, surges: 0, duds: 0, persisted: false };

  // 1. Update denormalized columns on venues (always, even when live is null)
  const { error: vErr } = await supabase
    .from('venues')
    .update({
      live_busyness_pct: live,
      live_busyness_vs_forecast: liveAvailable ? delta : null,
      live_busyness_updated_at: new Date().toISOString(),
    })
    .eq('id', venuuVenue.id);
  if (vErr) {
    console.log(`  ✗ venues update failed for ${venuuVenue.name}: ${vErr.message}`);
  }

  // 2. Insert snapshot
  const { data: snap, error: snapErr } = await supabase
    .from('besttime_live_snapshots')
    .insert({
      venue_id: venuuVenue.id,
      forecasted_busyness: forecasted,
      live_busyness: live,
      delta: liveAvailable ? delta : null,
      venue_open: venueOpen,
      hour_start: hourStart,
      raw_response: rawResponse,
    })
    .select('id')
    .single();

  if (snapErr) {
    console.log(`  ✗ snapshot insert failed for ${venuuVenue.name}: ${snapErr.message}`);
    return result;
  }

  result.persisted = true;
  const snapshotId = snap.id;

  // 3. Emit signals via record_signal RPC
  if (forecasted !== null) {
    const { error } = await supabase.rpc('record_signal', {
      p_venue_id: venuuVenue.id,
      p_user_id: null,
      p_signal_type: 'besttime_forecast_now',
      p_signal_value: forecasted,
      p_source_table: 'besttime_live_snapshots',
      p_source_row_id: snapshotId,
      p_metadata: { hour_start: hourStart, source: 'besttime' },
    });
    if (error) {
      console.log(`  ✗ signal_besttime_forecast_now failed for ${venuuVenue.name}: ${error.message}`);
    } else {
      result.forecast = 1;
    }
  }

  if (liveAvailable && live !== null) {
    const { error } = await supabase.rpc('record_signal', {
      p_venue_id: venuuVenue.id,
      p_user_id: null,
      p_signal_type: 'besttime_live',
      p_signal_value: live,
      p_source_table: 'besttime_live_snapshots',
      p_source_row_id: snapshotId,
      p_metadata: { hour_start: hourStart, source: 'besttime' },
    });
    if (error) {
      console.log(`  ✗ signal_besttime_live failed for ${venuuVenue.name}: ${error.message}`);
    } else {
      result.live = 1;
    }
  }

  if (liveAvailable && delta !== null && Math.abs(delta) >= ANOMALY_THRESHOLD) {
    const direction = delta > 0 ? 'surge' : 'dud';
    const { error } = await supabase.rpc('record_signal', {
      p_venue_id: venuuVenue.id,
      p_user_id: null,
      p_signal_type: 'besttime_anomaly',
      p_signal_value: delta,
      p_source_table: 'besttime_live_snapshots',
      p_source_row_id: snapshotId,
      p_metadata: { hour_start: hourStart, source: 'besttime', direction },
    });
    if (error) {
      console.log(`  ✗ signal_besttime_anomaly failed for ${venuuVenue.name}: ${error.message}`);
    } else {
      result.anomalies = 1;
      if (direction === 'surge') result.surges = 1;
      else result.duds = 1;
    }
  }

  return result;
}

async function runCycle() {
  const startedAt = new Date();
  console.log(`\n═══ Refresh cycle @ ${startedAt.toISOString()} ═══`);

  // Collections still drive the per-city grouping in our logs (and
  // confirm setup ran), even though the live fetch is per-venue now.
  const { data: collections, error: collErr } = await supabase
    .from('besttime_collections')
    .select('city, collection_id, venue_count')
    .gt('venue_count', 0)
    .order('city');

  if (collErr) {
    console.error(`Could not load collections: ${collErr.message}`);
    return;
  }
  if (!collections || collections.length === 0) {
    console.warn('No collections with venue_count > 0. Run setup-besttime-collections.cjs first.');
    return;
  }

  let apiCalls = 0;
  let httpFails = 0;
  let statusFails = 0;
  let persisted = 0;
  let liveAvailableCount = 0;
  const totals = { forecast: 0, live: 0, anomalies: 0, surges: 0, duds: 0 };

  for (const coll of collections) {
    const { data: venues, error: vErr } = await supabase
      .from('venues')
      .select('id, name, besttime_venue_id, city')
      .eq('city', coll.city)
      .not('besttime_venue_id', 'is', null);

    if (vErr) {
      console.warn(`  ! venues query failed for ${coll.city}: ${vErr.message}`);
      continue;
    }

    console.log(`\n  ${coll.city} (${venues.length} venues)`);

    for (const venue of venues) {
      const fetched = await fetchVenueLive(venue.besttime_venue_id);
      apiCalls++;

      if (!fetched.body) {
        httpFails++;
        console.log(`  ✗ ${venue.name}: transport error: ${fetched.transportError || 'no body'}`);
        await sleep(PER_VENUE_SLEEP_MS);
        continue;
      }
      if (!fetched.httpOk || fetched.body.status !== 'OK' || !fetched.body.analysis) {
        statusFails++;
        const msg = fetched.body.message || fetched.body.status || `HTTP ${fetched.status}`;
        console.log(`  ✗ ${venue.name}: ${msg}`);
        await sleep(PER_VENUE_SLEEP_MS);
        continue;
      }

      const analysis = fetched.body.analysis;
      const venueInfo = fetched.body.venue_info;
      const liveAvailable = analysis.venue_live_busyness_available === true;
      const liveStr = liveAvailable ? String(analysis.venue_live_busyness) : 'n/a';
      const forecastStr = analysis.venue_forecasted_busyness ?? 'n/a';
      const deltaStr = liveAvailable && analysis.venue_live_forecasted_delta !== undefined
        ? (analysis.venue_live_forecasted_delta > 0 ? '+' : '') + analysis.venue_live_forecasted_delta
        : 'n/a';
      console.log(`  → ${venue.name}: live=${liveStr} forecast=${forecastStr} delta=${deltaStr}`);

      const result = await applyVenueLive(venue, analysis, venueInfo, fetched.body);

      if (result.persisted) persisted++;
      if (liveAvailable) liveAvailableCount++;
      totals.forecast += result.forecast;
      totals.live += result.live;
      totals.anomalies += result.anomalies;
      totals.surges += result.surges;
      totals.duds += result.duds;

      await sleep(PER_VENUE_SLEEP_MS);
    }
  }

  const elapsedMs = Date.now() - startedAt.getTime();
  console.log(`\n═══ Cycle summary ═══`);
  console.log(`  API calls:        ${apiCalls} (in ${(elapsedMs / 1000).toFixed(1)}s)`);
  console.log(`  Persisted:        ${persisted} snapshots`);
  console.log(`  Live available:   ${liveAvailableCount} of ${apiCalls}`);
  console.log(`  HTTP errors:      ${httpFails}`);
  console.log(`  API status errors: ${statusFails}`);
  console.log(`  Signals emitted:  ${totals.forecast} forecast_now, ${totals.live} live, ${totals.anomalies} anomalies (${totals.surges} surges, ${totals.duds} duds)`);
}

async function main() {
  if (isOnce) {
    await runCycle();
    return;
  }

  console.log('Continuous mode — Ctrl+C to stop. Refresh interval: 30 min. Off-hours: 3am–5pm local.');
  while (true) {
    if (isOffHours()) {
      const next = new Date(Date.now() + REFRESH_INTERVAL_MS);
      console.log(`Skipping cycle, off-hours. Next check at ${next.toLocaleTimeString()}.`);
    } else {
      try {
        await runCycle();
      } catch (err) {
        console.error('Cycle error:', err);
      }
    }
    await sleep(REFRESH_INTERVAL_MS);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
