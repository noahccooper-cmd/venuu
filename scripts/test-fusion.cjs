#!/usr/bin/env node
/**
 * Local fusion test runner.
 *
 * Calls fuse_all_active_venues() directly via the service-role
 * Supabase client (bypassing the edge function and pg_cron) so you
 * can validate the SQL pipeline before deploying.
 *
 * Usage:
 *   node scripts/test-fusion.cjs
 *
 * Env required:
 *   SUPABASE_URL  (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function pad(s, n) {
  s = String(s ?? '');
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function fmtNum(n, width = 4) {
  return pad(n === null || n === undefined ? '-' : String(n), width);
}

async function main() {
  console.log('═══ Fusion test (direct RPC) ═══');

  const startedAt = Date.now();
  const { data, error } = await supabase.rpc('fuse_all_active_venues');
  const durationMs = Date.now() - startedAt;

  if (error) {
    console.error(`✗ fuse_all_active_venues failed in ${durationMs}ms:`);
    console.error(`  ${error.message}`);
    process.exit(1);
  }

  const venuesUpdated = typeof data === 'number' ? data : Number(data);
  console.log(`✓ fuse_all_active_venues returned ${venuesUpdated} in ${durationMs}ms`);
  console.log('');

  // Top-N by confidence + signal magnitude
  const { data: rows, error: qErr } = await supabase
    .from('headcount_estimates')
    .select(`
      estimate, confidence_pct, state_label, trend, capacity_pct,
      signal_component, baseline_component, override_active,
      source_breakdown, computed_at,
      venue:venues(name, city)
    `)
    .order('confidence_pct', { ascending: false })
    .limit(10);

  if (qErr) {
    console.error(`✗ headcount_estimates query failed: ${qErr.message}`);
    process.exit(1);
  }

  // Sort secondary by |signal_component| since the upstream order doesn't guarantee that
  const sorted = (rows || []).slice().sort((a, b) => {
    if (b.confidence_pct !== a.confidence_pct) return b.confidence_pct - a.confidence_pct;
    return Math.abs(b.signal_component || 0) - Math.abs(a.signal_component || 0);
  });

  console.log('Top 10 estimates (by confidence, then |signal_component|):');
  console.log('');
  console.log(
    pad('VENUE', 28),
    pad('CITY', 14),
    pad('EST', 5),
    pad('CONF%', 6),
    pad('STATE', 9),
    pad('TREND', 9),
    pad('CAP%', 6),
    pad('SIG', 5),
    pad('BASE', 5),
    'SOURCE',
  );
  console.log('─'.repeat(120));

  for (const r of sorted) {
    const venue = r.venue || {};
    const cap = r.capacity_pct === null || r.capacity_pct === undefined
      ? '-' : Math.round(r.capacity_pct * 100) + '';
    const baselineSrc = r.source_breakdown?.baseline_source ?? '?';
    const overrideTag = r.override_active ? ' [OVR]' : '';
    console.log(
      pad(venue.name, 28),
      pad(venue.city, 14),
      fmtNum(r.estimate, 5),
      fmtNum(r.confidence_pct, 6),
      pad(r.state_label, 9),
      pad(r.trend ?? '-', 9),
      pad(cap, 6),
      fmtNum(r.signal_component, 5),
      fmtNum(r.baseline_component, 5),
      baselineSrc + overrideTag,
    );
  }

  console.log('');
  console.log('Tip: pretty-print one venue\'s full source_breakdown:');
  console.log('  SELECT venue_id, source_breakdown FROM headcount_estimates');
  console.log('  ORDER BY confidence_pct DESC LIMIT 1;');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
