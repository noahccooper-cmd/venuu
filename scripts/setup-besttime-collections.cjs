#!/usr/bin/env node
/**
 * One-time setup: create a BestTime collection per city and add every
 * venue with a besttime_venue_id to its city's collection.
 *
 * After this runs, the live-refresh script can pull every venue in a
 * city in ONE BestTime API call instead of hitting the per-venue endpoint
 * 60+ times per cycle.
 *
 * Usage:
 *   node scripts/setup-besttime-collections.cjs
 *
 * Idempotent: if a collection_id already exists for a city, the script
 * reuses it instead of creating a new one. Adding the same venue to a
 * collection twice is a no-op on BestTime's side.
 *
 * Env required:
 *   BESTTIME_API_KEY_PRIVATE
 *   SUPABASE_URL  (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { randomBytes } = require('crypto');

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

const CITIES = ['knoxville', 'tampa', 'st_petersburg'];
const SLEEP_MS = 200;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Create a new BestTime collection. Returns { ok, collectionId, raw }.
 *
 * BestTime requires the caller to generate the collection_id and POST it
 * to the SINGULAR /collection endpoint with `name` (not collection_name).
 */
async function createCollection(city) {
  const collectionId = `col_${randomBytes(16).toString('hex')}`;
  const collectionName = `venuu_${city}`;

  const url = new URL('https://besttime.app/api/v1/collection');
  url.searchParams.set('api_key_private', BESTTIME_KEY);
  url.searchParams.set('collection_id', collectionId);
  url.searchParams.set('name', collectionName);

  try {
    const res = await fetch(url.toString(), { method: 'POST' });
    const data = await res.json();
    // BestTime echoes the collection_id back; fall back to the one we sent
    const returnedId = data.collection_id || data.id || data.collection?.collection_id || collectionId;
    if (!res.ok || (data.status && data.status !== 'OK')) {
      return {
        ok: false,
        error: data.message || data.status || `HTTP ${res.status}`,
        raw: data,
        urlTried: url.toString().replace(BESTTIME_KEY, '***'),
      };
    }
    return { ok: true, collectionId: returnedId, raw: data };
  } catch (err) {
    return { ok: false, error: err.message, urlTried: url.toString().replace(BESTTIME_KEY, '***') };
  }
}

/**
 * Add a single venue_id to a collection.
 */
async function addVenueToCollection(collectionId, besttimeVenueId) {
  const url = new URL(`https://besttime.app/api/v1/collection/${collectionId}/${besttimeVenueId}`);
  url.searchParams.set('api_key_private', BESTTIME_KEY);

  try {
    const res = await fetch(url.toString(), { method: 'POST' });
    const data = await res.json();
    // Treat OK / 200 / 'success' / already-present all as success
    const ok = res.ok && (data.status === 'OK' || data.status === undefined || /already/i.test(data.message || ''));
    if (!ok) {
      return { ok: false, error: data.message || data.status || `HTTP ${res.status}`, raw: data };
    }
    return { ok: true, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function ensureCollectionForCity(city) {
  // Check existing first
  const { data: existing, error: existingErr } = await supabase
    .from('besttime_collections')
    .select('city, collection_id, venue_count')
    .eq('city', city)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`besttime_collections lookup failed: ${existingErr.message}`);
  }

  if (existing?.collection_id) {
    console.log(`  ✓ Reusing existing collection for ${city}: ${existing.collection_id}`);
    return existing.collection_id;
  }

  console.log(`  → Creating new collection for ${city}`);
  const result = await createCollection(city);

  if (!result.ok) {
    console.error(`  ✗ Collection creation failed for ${city}.`);
    console.error(`    URL: ${result.urlTried}`);
    console.error(`    Error: ${result.error}`);
    if (result.raw) console.error(`    Raw: ${JSON.stringify(result.raw)}`);
    throw new Error(`Failed to create collection for ${city}`);
  }

  console.log(`  ✓ Created collection_id=${result.collectionId}`);

  const { error: insertErr } = await supabase
    .from('besttime_collections')
    .insert({ city, collection_id: result.collectionId, venue_count: 0 });

  if (insertErr) {
    throw new Error(`besttime_collections insert failed: ${insertErr.message}`);
  }

  return result.collectionId;
}

async function processCity(city) {
  console.log(`\n═══ ${city} ═══`);
  const collectionId = await ensureCollectionForCity(city);

  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, name, besttime_venue_id, besttime_collection_id')
    .eq('city', city)
    .not('besttime_venue_id', 'is', null);

  if (error) {
    console.error(`  ✗ Venues query failed: ${error.message}`);
    return { city, added: 0, skipped: 0, failed: 0 };
  }

  console.log(`  Eligible venues with besttime_venue_id: ${venues.length}`);

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const v of venues) {
    if (v.besttime_collection_id === collectionId) {
      skipped++;
      continue;
    }

    const result = await addVenueToCollection(collectionId, v.besttime_venue_id);
    if (!result.ok) {
      console.log(`    ✗ ${v.name}: ${result.error}`);
      failed++;
      await sleep(SLEEP_MS);
      continue;
    }

    const { error: updErr } = await supabase
      .from('venues')
      .update({ besttime_collection_id: collectionId })
      .eq('id', v.id);

    if (updErr) {
      console.log(`    ✗ ${v.name}: db update failed: ${updErr.message}`);
      failed++;
    } else {
      added++;
      console.log(`    ✓ ${v.name}`);
    }

    await sleep(SLEEP_MS);
  }

  // Update collection metadata
  const { count: totalInCollection } = await supabase
    .from('venues')
    .select('id', { count: 'exact', head: true })
    .eq('besttime_collection_id', collectionId);

  await supabase
    .from('besttime_collections')
    .update({
      venue_count: totalInCollection ?? added + skipped,
      last_synced_at: new Date().toISOString(),
    })
    .eq('city', city);

  console.log(`  Added: ${added}, Already in collection: ${skipped}, Failed: ${failed}`);
  return { city, added, skipped, failed, total: totalInCollection ?? added + skipped };
}

async function main() {
  console.log('═══ BestTime collection setup ═══');
  console.log(`Cities: ${CITIES.join(', ')}`);

  const summaries = [];
  for (const city of CITIES) {
    try {
      const summary = await processCity(city);
      summaries.push(summary);
    } catch (err) {
      console.error(`  Fatal for ${city}: ${err.message}`);
      summaries.push({ city, added: 0, skipped: 0, failed: 0, fatal: err.message });
    }
  }

  console.log('\n═══ Summary ═══');
  for (const s of summaries) {
    if (s.fatal) {
      console.log(`  ${s.city}: FATAL — ${s.fatal}`);
    } else {
      console.log(`  ${s.city}: ${s.total ?? '?'} venues in collection (added ${s.added}, already-in ${s.skipped}, failed ${s.failed})`);
    }
  }
  console.log('\nNext: node scripts/refresh-besttime-live.cjs --once');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
