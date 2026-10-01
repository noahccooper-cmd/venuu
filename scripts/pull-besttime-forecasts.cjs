#!/usr/bin/env node
/**
 * BestTime.app forecast pull script.
 *
 * For each venue in the database:
 *   1. POST to BestTime forecasts endpoint with name + address
 *   2. Receive 7-day hourly busyness curves (analysis array)
 *   3. Normalize closed-hours sentinel (999 → null)
 *   4. Persist to venue_baselines.popular_times_curve as JSONB
 *   5. Save BestTime's venue_id back to venues.besttime_venue_id
 *   6. Update venue_baselines: data_quality 'cold' → 'priors_only',
 *      last_google_pull_at = now()
 *
 * Usage:
 *   node scripts/pull-besttime-forecasts.cjs --test
 *     → Pulls 2 venues only (Sunspot Knoxville + M. Bird Tampa)
 *     → Costs ~2 credits
 *
 *   node scripts/pull-besttime-forecasts.cjs --all
 *     → Pulls every venue without an existing curve
 *     → Costs ~63 credits (after test mode pulled 2)
 *
 *   node scripts/pull-besttime-forecasts.cjs --slug=sunspot-knoxville
 *     → Pulls a single venue by slug (for spot-checks)
 *
 * Environment variables required:
 *   BESTTIME_API_KEY_PRIVATE
 *   SUPABASE_URL  (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY  (NOT the anon key — needs service role to bypass RLS on venue_baselines updates)
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
  console.error('       Get the service role key from Supabase dashboard → Project Settings → API');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const FORECAST_URL = 'https://besttime.app/api/v1/forecasts';
const SLEEP_MS = 1500; // Be polite to BestTime — 1.5s between calls

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
const isTestMode = args.includes('--test');
const isAllMode = args.includes('--all');
const slugArg = args.find(a => a.startsWith('--slug='))?.split('=')[1];

if (!isTestMode && !isAllMode && !slugArg) {
  console.log('Usage:');
  console.log('  --test                Pull 2 test venues (~2 credits)');
  console.log('  --all                 Pull all venues without existing curves');
  console.log('  --slug=venue-slug     Pull one specific venue by slug');
  process.exit(0);
}

/**
 * Pull a single venue's forecast from BestTime.
 * Returns { ok: true, venueId, analysis } on success, { ok: false, error } on failure.
 */
async function pullForecast(venueName, venueAddress) {
  const url = new URL(FORECAST_URL);
  url.searchParams.set('api_key_private', BESTTIME_KEY);
  url.searchParams.set('venue_name', venueName);
  url.searchParams.set('venue_address', venueAddress);

  try {
    const res = await fetch(url.toString(), { method: 'POST' });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      return {
        ok: false,
        error: `HTTP ${res.status} non-JSON response: ${text.slice(0, 200)}`
      };
    }

    if (data.status !== 'OK') {
      return { ok: false, error: data.message || data.status || 'unknown' };
    }

    return {
      ok: true,
      venueId: data.venue_info?.venue_id,
      analysis: data.analysis,
      venueInfo: data.venue_info,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Normalize the analysis array for storage.
 * Converts 999 (closed) sentinel to null so consumers can handle it cleanly.
 */
function normalizeAnalysis(analysis) {
  return analysis.map(day => ({
    day_int: day.day_info?.day_int,
    day_text: day.day_info?.day_text,
    venue_open: day.day_info?.venue_open,
    venue_closed: day.day_info?.venue_closed,
    day_mean: day.day_info?.day_mean,
    day_max: day.day_info?.day_max,
    day_rank_mean: day.day_info?.day_rank_mean,
    day_rank_max: day.day_info?.day_rank_max,
    busy_hours: day.busy_hours || [],
    quiet_hours: day.quiet_hours || [],
    peak_hours: day.peak_hours || [],
    surge_hours: day.surge_hours || null,
    hour_analysis: (day.hour_analysis || []).map(h => ({
      hour: h.hour,
      intensity_nr: h.intensity_nr === 999 ? null : h.intensity_nr,
      intensity_txt: h.intensity_txt === 'Closed' ? null : h.intensity_txt,
    })),
    day_raw: day.day_raw || [],
  }));
}

/**
 * Persist forecast to venue_baselines.
 */
async function persistForecast(venueRowId, besttimeVenueId, normalizedAnalysis, rawVenueInfo) {
  const { error: venueErr } = await supabase
    .from('venues')
    .update({ besttime_venue_id: besttimeVenueId })
    .eq('id', venueRowId);

  if (venueErr) {
    return { ok: false, error: 'venue update failed: ' + venueErr.message };
  }

  const { error: baselineErr } = await supabase
    .from('venue_baselines')
    .upsert({
      venue_id: venueRowId,
      popular_times_curve: {
        source: 'besttime',
        besttime_venue_id: besttimeVenueId,
        venue_info: {
          dwell_time_avg: rawVenueInfo?.venue_dwell_time_avg,
          venue_type: rawVenueInfo?.venue_type,
          rating: rawVenueInfo?.rating,
          reviews: rawVenueInfo?.reviews,
          timezone: rawVenueInfo?.venue_timezone,
        },
        analysis: normalizedAnalysis,
      },
      last_google_pull_at: new Date().toISOString(),
      data_quality: 'priors_only',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'venue_id' });

  if (baselineErr) {
    return { ok: false, error: 'baseline upsert failed: ' + baselineErr.message };
  }

  return { ok: true };
}

/**
 * Fetch venues to process based on CLI args.
 */
async function getVenuesToProcess() {
  let query = supabase
    .from('venues')
    .select('id, name, slug, address, city, besttime_venue_id')
    .eq('is_active', true)
    .order('city')
    .order('sort_order');

  if (isTestMode) {
    query = query.in('slug', ['sunspot', 'm-bird-tampa']);
  } else if (slugArg) {
    query = query.eq('slug', slugArg);
  } else if (isAllMode) {
    query = query
      .is('besttime_venue_id', null)
      .in('city', ['knoxville', 'tampa', 'st_petersburg'])
      .not('category', 'in', '(fraternity,system,venue)');
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch venues:', error.message);
    process.exit(1);
  }
  return data || [];
}

/**
 * Pretty-print one day's curve for terminal eyeballing.
 */
function printDayCurve(day) {
  const bars = day.day_raw.map(v => {
    if (v === 0) return '·';
    if (v < 25) return '▁';
    if (v < 50) return '▃';
    if (v < 75) return '▅';
    return '█';
  }).join('');
  console.log(`    ${day.day_text.padEnd(10)} ${bars}  max=${day.day_max} mean=${day.day_mean}`);
}

async function main() {
  console.log('═══ BestTime forecast pull ═══');
  console.log(`Mode: ${isTestMode ? 'TEST (2 venues)' : isAllMode ? 'ALL (uncovered venues)' : `SLUG (${slugArg})`}`);

  const venues = await getVenuesToProcess();
  console.log(`Venues to process: ${venues.length} (excludes greek venues, already-pulled venues)`);

  if (venues.length === 0) {
    console.log('No venues to process. Exiting.');
    return;
  }

  console.log(`Estimated cost: ${venues.length} forecast credits`);
  console.log('Starting in 3 seconds... (Ctrl+C to abort)');
  await sleep(3000);

  let succeeded = 0;
  let failed = 0;
  const failures = [];

  for (const venue of venues) {
    const venueAddress = venue.address || `${venue.name}, ${venue.city}`;
    console.log(`\n→ ${venue.name}  (${venue.city})`);
    console.log(`  Address: ${venueAddress}`);

    const forecast = await pullForecast(venue.name, venueAddress);

    if (!forecast.ok) {
      console.log(`  ✗ FAILED: ${JSON.stringify(forecast.error)}`);
      failed++;
      failures.push({ venue: venue.name, error: forecast.error });
      await sleep(SLEEP_MS);
      continue;
    }

    const normalized = normalizeAnalysis(forecast.analysis);
    const persistResult = await persistForecast(
      venue.id,
      forecast.venueId,
      normalized,
      forecast.venueInfo
    );

    if (!persistResult.ok) {
      console.log(`  ✗ PERSIST FAILED: ${persistResult.error}`);
      failed++;
      failures.push({ venue: venue.name, error: persistResult.error });
      await sleep(SLEEP_MS);
      continue;
    }

    console.log(`  ✓ Saved venue_id=${forecast.venueId.substring(0, 18)}...`);

    if (isTestMode || slugArg) {
      console.log('  Weekly curve:');
      normalized.forEach(printDayCurve);
    }

    succeeded++;
    await sleep(SLEEP_MS);
  }

  console.log('\n═══ Summary ═══');
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed:    ${failed}`);
  if (failures.length > 0) {
    console.log('\n  Failed venues:');
    failures.forEach(f => console.log(`    - ${f.venue}: ${JSON.stringify(f.error)}`));
  }
  console.log(`  Credits used: ~${succeeded + failed}`);
  console.log('\nRun `node scripts/pull-besttime-forecasts.cjs --all` to pull remaining venues.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
