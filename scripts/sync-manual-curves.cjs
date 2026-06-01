#!/usr/bin/env node
/**
 * Manual operator-curve sync script.
 *
 * Loads Karston's "manual_curves" tab (Operator Brain) into
 * venue_baselines.learned_curve — the PRIMARY baseline the fusion engine
 * reads first (get_current_hour_from_manual_curve, migrations 00067/00068).
 *
 * For each venue_slug in the CSV:
 *   1. Collect its 7 day-rows (day_int 0=Mon … 6=Sun), each with h00..h23.
 *   2. Assemble JSONB: { "0":[24 ints], "1":[...], … "6":[...] }
 *      — string day keys, 24-element integer arrays indexed by hour.
 *      This MUST match exactly what get_current_hour_from_manual_curve
 *      reads: v_curve -> day_key  then  v_day_array ->> hour.
 *   3. Map venue_slug -> venue_id via the venues table (slug column).
 *   4. Upsert { venue_id, learned_curve, last_learned_update_at } into
 *      venue_baselines (onConflict venue_id). Touches ONLY those two
 *      columns — popular_times_curve and everything else are untouched.
 *
 * MODES:
 *   (default)   --dry-run  Fetch, parse, build, VALIDATE. Writes nothing.
 *   --sync                 Everything dry-run does, then upsert valid venues.
 *
 * Usage:
 *   node scripts/sync-manual-curves.cjs              # dry-run (default)
 *   node scripts/sync-manual-curves.cjs --dry-run    # explicit dry-run
 *   node scripts/sync-manual-curves.cjs --sync       # actually write
 *
 * Environment variables required:
 *   MANUAL_CURVES_CSV_URL      Published Google Sheets CSV (manual_curves tab)
 *   SUPABASE_URL  (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY  (service role — bypasses RLS on venue_baselines)
 *
 * HANDLING OF BAD DATA (explicit, so the report shows exactly what lands):
 *   - blank / N/A hour cell inside an otherwise-valid row  → coerced to 0
 *   - a day-row whose 24 hours are ALL blank/N/A           → that day SKIPPED
 *     (omitted from the curve; engine falls through for that day)
 *   - hour value outside 0..100                            → clamped, reported
 *   - venue with ZERO usable day-rows                      → venue SKIPPED
 *   - venue whose every usable value is 0 (data gap)       → venue SKIPPED
 *   - venue_slug not found in venues table                 → venue SKIPPED
 *   A bad row never throws — errors are collected and reported.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const CSV_URL = process.env.MANUAL_CURVES_CSV_URL;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!CSV_URL) {
  console.error('ERROR: MANUAL_CURVES_CSV_URL not found in .env');
  console.error('       Publish the manual_curves tab: File → Share → Publish to web → manual_curves → CSV');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in .env');
  console.error('       Get the service role key from Supabase dashboard → Project Settings → API');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const args = process.argv.slice(2);
const isSync = args.includes('--sync');
const MODE = isSync ? 'SYNC' : 'DRY-RUN';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // index = day_int

// ───────────────────────────────────────────────────────────────
// CSV parser — state machine, handles quoted fields with embedded
// commas / quotes ("") / newlines. Returns array of string arrays.
// ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // ignore — handled by the \n branch
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Parse one hour cell. Returns { value:int|null, na:bool, bad:bool, outOfRange:bool, original }
function parseHourCell(raw) {
  const s = (raw == null ? '' : String(raw)).trim();
  if (s === '' || /^(n\/?a|na|null|-|—|–)$/i.test(s)) {
    return { value: null, na: true, bad: false, outOfRange: false, original: s };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    // non-numeric junk — treat like N/A (coerce to 0) but flag as bad
    return { value: null, na: true, bad: true, outOfRange: false, original: s };
  }
  let v = Math.round(n);
  let outOfRange = false;
  if (v < 0 || v > 100) { outOfRange = true; v = Math.max(0, Math.min(100, v)); }
  return { value: v, na: false, bad: false, outOfRange, original: s };
}

// ───────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  sync-manual-curves — MODE: ${MODE}`);
  console.log(`  CSV: ${CSV_URL}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Fetch CSV ──────────────────────────────────────────────
  let csvText;
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    csvText = await res.text();
  } catch (e) {
    console.error('ERROR: failed to fetch CSV — ' + e.message);
    process.exit(1);
  }

  // HTML guard: a non-published / auth-required sheet returns an HTML page.
  if (/^\s*<(!doctype|html)/i.test(csvText)) {
    console.error('ERROR: fetch returned HTML, not CSV — the sheet is not published as CSV (or needs auth).');
    console.error('       Re-publish: File → Share → Publish to web → manual_curves tab → CSV.');
    process.exit(1);
  }

  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    console.error('ERROR: CSV has no data rows.');
    process.exit(1);
  }

  // ── Locate the header row ──────────────────────────────────
  // The Operator Brain tabs carry banner/title rows above the real header,
  // so scan for the first row containing a 'venue_slug' cell rather than
  // assuming row 0.
  const headerRowIdx = rows.findIndex(row =>
    row.some(c => c.trim().toLowerCase() === 'venue_slug'));
  if (headerRowIdx < 0) {
    console.error('ERROR: no "venue_slug" header row found anywhere in the CSV.');
    console.error('       This almost always means the URL is exporting the WRONG TAB (e.g. the');
    console.error('       cover/intro sheet) instead of manual_curves. Fix one of:');
    console.error('         • Re-publish the manual_curves tab specifically as CSV, or');
    console.error('         • Append  &single=true&gid=<manual_curves_gid>  to the pub URL');
    console.error('           (the gid is the #gid=NNN in the browser URL with that tab open).');
    process.exit(1);
  }

  // ── Map header columns ─────────────────────────────────────
  const header = rows[headerRowIdx].map(h => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name.toLowerCase());
  const idx = {
    slug: col('venue_slug'),
    name: col('venue_name'),
    dayInt: col('day_int'),
    dayName: col('day_name'),
    hours: Array.from({ length: 24 }, (_, h) => col('h' + String(h).padStart(2, '0'))),
  };

  const missingCols = [];
  if (idx.slug < 0) missingCols.push('venue_slug');
  if (idx.dayInt < 0) missingCols.push('day_int');
  idx.hours.forEach((hi, h) => { if (hi < 0) missingCols.push('h' + String(h).padStart(2, '0')); });
  if (missingCols.length) {
    console.error('ERROR: CSV is missing required columns: ' + missingCols.join(', '));
    console.error('       Found header: ' + header.join(', '));
    process.exit(1);
  }

  // ── Load venues for slug → id mapping ──────────────────────
  const { data: venueRows, error: venueErr } = await supabase
    .from('venues')
    .select('id, slug, name, city');
  if (venueErr) {
    console.error('ERROR: could not read venues table — ' + venueErr.message);
    process.exit(1);
  }
  const slugToVenue = new Map();
  for (const v of venueRows) if (v.slug) slugToVenue.set(v.slug.trim().toLowerCase(), v);

  // ── Group CSV data rows by venue_slug, build per-venue state ─
  const venues = new Map(); // slug -> state
  const globalErrors = [];

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    try {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      const slug = (row[idx.slug] || '').trim();
      if (slug === '') continue; // blank line / trailing
      const name = idx.name >= 0 ? (row[idx.name] || '').trim() : '';

      let v = venues.get(slug.toLowerCase());
      if (!v) {
        v = { slug, name, days: {}, dupDays: [], dayIssues: [], rowCount: 0 };
        venues.set(slug.toLowerCase(), v);
      }
      v.rowCount++;
      if (name && !v.name) v.name = name;

      // day_int 0..6
      const dayRaw = (row[idx.dayInt] || '').trim();
      const dayInt = Number(dayRaw);
      if (!Number.isInteger(dayInt) || dayInt < 0 || dayInt > 6) {
        v.dayIssues.push(`row ${r + 1}: invalid day_int "${dayRaw}" — row skipped`);
        continue;
      }
      const dayKey = String(dayInt);
      if (v.days[dayKey]) v.dupDays.push(dayInt); // duplicate; last wins below

      // Parse 24 hour cells
      const parsed = idx.hours.map(hi => parseHourCell(hi >= 0 ? row[hi] : ''));
      const naCount = parsed.filter(p => p.na).length;

      if (naCount === 24) {
        // entire day-row is N/A → skip this day
        v.dayIssues.push(`${DAY_NAMES[dayInt]} (day ${dayInt}): all 24 hours N/A — day skipped`);
        continue;
      }

      const arr = parsed.map(p => (p.na ? 0 : p.value));
      // collect per-cell issues
      const coerced = [];
      const bad = [];
      const oor = [];
      parsed.forEach((p, h) => {
        if (p.na && p.bad) bad.push(`h${String(h).padStart(2, '0')}="${p.original}"`);
        else if (p.na) coerced.push('h' + String(h).padStart(2, '0'));
        if (p.outOfRange) oor.push(`h${String(h).padStart(2, '0')}="${p.original}"→${p.value}`);
      });
      if (bad.length) v.dayIssues.push(`${DAY_NAMES[dayInt]}: non-numeric → coerced to 0: ${bad.join(', ')}`);
      if (coerced.length) v.dayIssues.push(`${DAY_NAMES[dayInt]}: blank/N/A → coerced to 0: ${coerced.length} hour(s) [${coerced.join(',')}]`);
      if (oor.length) v.dayIssues.push(`${DAY_NAMES[dayInt]}: out of 0-100 → clamped: ${oor.join(', ')}`);

      v.days[dayKey] = arr; // last write wins on duplicate day_int
    } catch (e) {
      globalErrors.push(`row ${r + 1}: unexpected parse error — ${e.message}`);
    }
  }

  // ── Classify each venue: sync vs skip ──────────────────────
  const results = [];
  for (const v of venues.values()) {
    const dayKeys = Object.keys(v.days);
    const validDayCount = dayKeys.length;
    const missingDays = [];
    for (let d = 0; d <= 6; d++) if (!v.days[String(d)]) missingDays.push(`${d}=${DAY_NAMES[d]}`);

    let venueMax = 0;
    for (const k of dayKeys) venueMax = Math.max(venueMax, ...v.days[k]);

    const dbVenue = slugToVenue.get(v.slug.toLowerCase()) || null;

    const skipReasons = [];
    if (!dbVenue) skipReasons.push('NO MATCH in venues table');
    if (validDayCount === 0) skipReasons.push('no usable day-rows (all N/A or invalid)');
    else if (venueMax === 0) skipReasons.push('all days empty/zero (data gap)');

    results.push({
      slug: v.slug,
      name: v.name,
      venueId: dbVenue ? dbVenue.id : null,
      city: dbVenue ? dbVenue.city : null,
      validDayCount,
      missingDays,
      dupDays: [...new Set(v.dupDays)],
      dayIssues: v.dayIssues,
      curve: v.days,
      willSync: skipReasons.length === 0,
      skipReasons,
    });
  }

  results.sort((a, b) => a.slug.localeCompare(b.slug));

  // ── REPORT ─────────────────────────────────────────────────
  console.log('HANDLING: blank/N/A→0 within a valid row · all-N/A day skipped ·');
  console.log('          out-of-range clamped to 0-100 · 0 usable rows / all-zero / NO MATCH → venue skipped\n');

  console.log('─── PER-VENUE ───────────────────────────────────────────');
  for (const v of results) {
    const id = v.venueId ? v.venueId : 'NO MATCH';
    const tag = v.willSync ? 'SYNC ' : 'SKIP ';
    console.log(`${tag}${v.slug}  ->  ${id}   validDays ${v.validDayCount}/7` +
      (v.willSync ? '' : `   [${v.skipReasons.join('; ')}]`));
    if (v.missingDays.length && v.validDayCount > 0)
      console.log(`        missing day-rows: ${v.missingDays.join(', ')}`);
    if (v.dupDays.length)
      console.log(`        duplicate day_int (last wins): ${v.dupDays.map(d => `${d}=${DAY_NAMES[d]}`).join(', ')}`);
    for (const issue of v.dayIssues) console.log(`        ⚠ ${issue}`);
  }

  if (globalErrors.length) {
    console.log('\n─── ROW-LEVEL ERRORS (collected, non-fatal) ─────────────');
    for (const e of globalErrors) console.log('  ✗ ' + e);
  }

  const toSync = results.filter(v => v.willSync);
  const toSkip = results.filter(v => !v.willSync);

  console.log('\n─── SUMMARY ─────────────────────────────────────────────');
  console.log(`  venues parsed in CSV:   ${results.length}`);
  console.log(`  would sync (valid):     ${toSync.length}`);
  console.log(`  skipped:                ${toSkip.length}`);
  if (toSkip.length) {
    const byReason = {};
    for (const v of toSkip) for (const r of v.skipReasons) byReason[r] = (byReason[r] || 0) + 1;
    for (const r of Object.keys(byReason)) console.log(`      - ${r}: ${byReason[r]}`);
  }

  // Sanity print of one assembled curve so the JSONB shape is eyeballable
  if (toSync.length) {
    const sample = toSync[0];
    console.log(`\n  sample learned_curve for "${sample.slug}" (keys: ${Object.keys(sample.curve).join(',')}):`);
    for (const k of Object.keys(sample.curve).sort()) {
      const a = sample.curve[k];
      console.log(`    "${k}" (${DAY_NAMES[k]}) len=${a.length}: [${a.join(',')}]`);
    }
  }

  // ── WRITE (sync mode only) ─────────────────────────────────
  if (!isSync) {
    console.log('\nDRY-RUN complete. No data written. Re-run with --sync to write the ' +
      toSync.length + ' valid venue(s).');
    return;
  }

  console.log('\n─── WRITING (--sync) ────────────────────────────────────');
  let wrote = 0;
  const writeErrors = [];
  for (const v of toSync) {
    const { error } = await supabase
      .from('venue_baselines')
      .upsert(
        {
          venue_id: v.venueId,
          learned_curve: v.curve,
          last_learned_update_at: new Date().toISOString(),
        },
        { onConflict: 'venue_id' }
      );
    if (error) {
      writeErrors.push(`${v.slug}: ${error.message}`);
      console.log(`  ✗ ${v.slug} — ${error.message}`);
    } else {
      wrote++;
      console.log(`  ✓ ${v.slug} (${v.validDayCount} day-rows)`);
    }
  }
  console.log(`\nSYNC complete. Wrote ${wrote}/${toSync.length} venue(s) to learned_curve.`);
  if (writeErrors.length) {
    console.log(`${writeErrors.length} write error(s):`);
    for (const e of writeErrors) console.log('  ✗ ' + e);
    process.exitCode = 1;
  }
  console.log('Next fusion tick (≤60s) will pick up the new curves.');
})().catch(e => {
  console.error('FATAL: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
