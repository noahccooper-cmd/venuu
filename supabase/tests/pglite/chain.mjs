import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const MIG = path.join(REPO, 'supabase/migrations/');
export async function buildBase({ quiet = false } = {}) {
  const db = new PGlite();
  const run = async (label, file) => {
    try { await db.exec(fs.readFileSync(file, 'utf8')); if (!quiet) console.log('OK  ', label); }
    catch (e) { console.log('FAIL', label, '-', e.message); throw e; }
  };
  await run('supabase stubs', path.join(HERE, 'supabase_stubs.sql'));
  fs.writeFileSync(path.join(HERE, '.snapshot_clean.sql'), fs.readFileSync(path.join(REPO, 'docs/prod-schema-snapshot.sql'), 'utf8')
    .split('\n').filter(l => !/^\s*(CREATE EXTENSION|COMMENT ON EXTENSION|ALTER PUBLICATION "supabase_realtime" OWNER)/.test(l)).join('\n'));
  await run('prod snapshot (2026-08-16)', path.join(HERE, '.snapshot_clean.sql'));
  for (const f of ['00070_user_account_stats_drop_recap_plan_deps.sql','00072_leaderboard_drop_recap_plan_terms.sql','00073_drop_venue_recaps.sql','00074_drop_night_plans_family.sql','00075_venue_leaderboard_add_first_claimed_at.sql','00076_capture_events_prod_schema.sql']) {
    await run(f, MIG + f);
  }
  // The snapshot sets search_path to '' for its own session; restore Supabase's.
  // The snapshot sets search_path='' and row_security=off for its own
  // session; restore Supabase's defaults so RLS is actually evaluated.
  await db.exec("SET search_path TO public, extensions; SET row_security = on;");
  return { db, run };
}
if (import.meta.url === 'file://' + process.argv[1]) { await buildBase(); }
