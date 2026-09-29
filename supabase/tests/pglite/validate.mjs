// Local validation of 00077 → 00078 → 00079 against the prod snapshot
// (+ 00070–00076) in PGlite. Prints one PASS/FAIL line per test.
import { buildBase } from './chain.mjs';
import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const M = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations') + '/';
const sql = (f) => fs.readFileSync(M + f, 'utf8');
const results = [];
let dbRef;
const test = async (name, fn) => {
  try { const r = await fn(); const ok = r === true || r === undefined; results.push([ok, name, ok ? '' : String(r)]); }
  catch (e) { results.push([false, name, e.message]); }
  // Never leave a failed transaction (or a SET ROLE) behind for the next test.
  try { await dbRef.exec('ROLLBACK'); } catch { /* no open transaction */ }
  try { await dbRef.exec('RESET ROLE'); } catch { /* fine */ }
  try { await dbRef.query(`select set_config('request.jwt.claims', '', false)`); } catch { /* fine */ }
};
const expectError = async (fn, code) => {
  try { await fn(); return `expected error "${code}", got success`; }
  catch (e) { return e.message.includes(code) ? true : `expected "${code}", got "${e.message}"`; }
};

const { db } = await buildBase({ quiet: true });
dbRef = db;
process.on('unhandledRejection', (e) => { console.log('HARNESS ERROR:', e.message); printResults(); process.exit(1); });
const q = async (s, p) => (await db.query(s, p)).rows;

// ── Identities ──────────────────────────────────────────────────────
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const people = {
  a:   { auth: U(1), prof: P(1), email: 'a@example.com',   username: 'alice',   display: 'Alice' },
  b:   { auth: U(2), prof: P(2), email: 'b@example.com',   username: 'bob',     display: 'Bob' },
  host:{ auth: U(3), prof: P(3), email: 'h@example.com',   username: 'hostie',  display: 'Host' },
  mike:{ auth: U(4), prof: P(4), email: 'mike@example.com', username: 'mikev',  display: 'Mr. Venuu' },
  noah:{ auth: U(5), prof: P(5), email: 'noahccooper@colaii.tech', username: 'noah', display: 'Noah' },
  ban: { auth: U(6), prof: P(6), email: 'ban@example.com', username: 'banned',  display: 'Banned' },
  fan: { auth: U(7), prof: P(7), email: 'fan@example.com', username: 'venuufan', display: 'Venuu Fan' },
};
for (const p of Object.values(people)) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [p.auth, p.email]);
  await q(`insert into public.profiles (id, auth_id, email, username, display_name, city, profile_share_token)
           values ($1, $2, $3, $4, $5, 'tampa', $6)`, [p.prof, p.auth, p.email, p.username, p.display, 'tok-' + p.username]);
}

// Run a callback as an app user (JWT role + sub), like PostgREST does.
async function as(who, fn) {
  const role = who ? 'authenticated' : 'anon';
  const claims = who ? { sub: people[who].auth, role } : { role };
  await db.exec(`SET ROLE ${role}`);
  await q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  try { return await fn(); }
  finally { await db.exec('RESET ROLE'); await q(`select set_config('request.jwt.claims', '', false)`); }
}

// ── Pre-existing Tonight data (exists in prod before 00077) ─────────
// Schema-only snapshot: lookup tables are empty, so skip FK checks for
// fixture rows only (superuser), then restore them for everything tested.
await db.exec(`SET session_replication_role = replica`);
await q(`insert into public.venues (id, name, slug, city, lat, lng) values
  ('22222222-0000-4000-8000-000000000001', 'Test Bar', 'test-bar', 'tampa', 27.95, -82.45)`);
const T = (n) => `33333333-0000-4000-8000-${String(n).padStart(12, '0')}`;
await q(`insert into public.events (id, venue_id, city, title, event_type, host_name, start_time, latitude, longitude, created_by, is_active, expires_at, curated, description) values
  ($1, '22222222-0000-4000-8000-000000000001', 'tampa', 'Tonight live curated', 'party', 'Test Bar', now() + interval '1 day', 27.95, -82.45, 'portal:x', true,  now() + interval '2 days', true, null),
  ($2, '22222222-0000-4000-8000-000000000001', 'tampa', 'Tonight inactive',     'party', 'Test Bar', now() + interval '1 day', 27.95, -82.45, 'portal:x', false, now() + interval '2 days', true, null),
  ($3, '22222222-0000-4000-8000-000000000001', 'tampa', 'Tonight expired',      'party', 'Test Bar', now() - interval '3 days', 27.95, -82.45, 'portal:x', true,  now() - interval '1 day',  true, null),
  ($4, '22222222-0000-4000-8000-000000000001', 'tampa', 'Tonight long desc',    'party', 'Test Bar', now() + interval '1 day', 27.95, -82.45, 'portal:x', true,  now() + interval '2 days', false, repeat('x', 400))`,
  [T(1), T(2), T(3), T(4)]);
await db.exec(`SET session_replication_role = origin`);

// Baseline: the leak exists before 00079 (proves the tests can see it).
await test('baseline (before 00079): signed-out CAN read emails — the leak exists', async () => {
  const r = await as(null, () => q(`select email from public.profiles`));
  return r.length === Object.keys(people).length || `anon read ${r.length} emails`;
});
// Baseline: old RSVP policy compares profile id to auth.uid() — broken.
await test('baseline (before 00077): RSVP insert with profile id is rejected (the bug being fixed)', async () =>
  expectError(() => as('a', () => q(`insert into public.event_rsvps (user_id, event_id) values ($1, $2)`, [people.a.prof, T(1)])), 'row-level security'));

// ═════════════════════════ 00077 ═════════════════════════════════
await test('00077 applies (1st run)', async () => { await db.exec(sql('00077_social_production.sql')); });
if (!results.at(-1)[0]) { console.log('00077 FAILED:', results.at(-1)[2]); printResults(); process.exit(1); }
const snap = async () => q(`select
  (select count(*) from public.events where created_by = 'seed:00077')::int seeds,
  (select count(*) from public.brands)::int brands,
  (select count(*) from pg_policies where schemaname in ('public','storage'))::int policies,
  (select count(*) from storage.buckets)::int buckets`);
const first = (await snap())[0];
await test('00077 applies again (2nd run) with no changes (seeds/brands/policies/buckets identical)', async () => {
  await db.exec(sql('00077_social_production.sql'));
  const second = (await snap())[0];
  return JSON.stringify(first) === JSON.stringify(second) || `${JSON.stringify(first)} vs ${JSON.stringify(second)}`;
});
await test('seeds: 8 date-TBA pop-ups (6 Sun Cruiser: 2/city, 2 Venuu), all verified', async () => {
  const r = await q(`select city, count(*)::int n, bool_and(date_tba) tba, bool_and(verification='verified') v,
    count(*) filter (where brand_id is not null)::int branded from public.events where created_by='seed:00077' group by city order by city`);
  const ok = r.length === 3 && r.every(x => x.tba && x.v) &&
    r.find(x => x.city === 'knoxville').n === 2 && r.find(x => x.city === 'tampa').n === 3 && r.find(x => x.city === 'st_petersburg').n === 3;
  return ok || JSON.stringify(r);
});
await test('brands seeded: sun_cruiser (age gate, 3 cities) + pinellas_run_club (tagline, email)', async () => {
  const r = await q(`select slug, age_gate, cities, tagline, email, about from public.brands order by slug`);
  return (r.length === 2 && r[1].slug === 'sun_cruiser' && r[1].age_gate && r[1].cities.length === 3
    && r[0].tagline === 'The space for your pace.' && r[0].email === 'pinellasrunclub@gmail.com') || JSON.stringify(r);
});
await test('existing rows became surface=tonight; 400-char Tonight description survived', async () => {
  const r = await q(`select count(*) filter (where surface='tonight')::int t, count(*)::int n,
    max(char_length(description)) filter (where id=$1) len from public.events where created_by='portal:x'`, [T(4)]);
  return (r[0].t === 4 && r[0].len === 400) || JSON.stringify(r);
});
await test('events is in the supabase_realtime publication', async () =>
  (await q(`select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='events'`)).length === 1);

// Read policy
await test('signed-out read: live rows visible; inactive + expired hidden', async () => {
  const r = await as(null, () => q(`select id from public.events where created_by='portal:x'`));
  const ids = r.map(x => x.id);
  return (ids.includes(T(1)) && ids.includes(T(4)) && !ids.includes(T(2)) && !ids.includes(T(3))) || JSON.stringify(ids);
});

// Posting rules
const post = (who, extra = {}) => as(who, () => q(
  `insert into public.events (surface, category, title, city, latitude, longitude, start_time, host_profile_id, verification, date_tba, brand_id, host_name, description)
   values ('social', $1, $2, $3, 27.95, -82.45, now() + interval '2 days', $4, $5, $6, $7, $8, $9) returning id, host_profile_id, verification, host_name, event_type, expires_at, created_by`,
  [extra.category ?? 'pop_up', extra.title ?? 'Test post', extra.city ?? 'tampa', extra.host_profile_id ?? people[who].prof,
   extra.verification ?? 'community', extra.date_tba ?? false, extra.brand_id ?? null, extra.host_name ?? null, extra.description ?? null]));

await test('post before accepting terms → terms_required', async () => expectError(() => post('a'), 'terms_required'));
for (const w of ['a', 'b', 'host', 'ban', 'fan']) {
  await as(w, () => q(`update public.profiles set accepted_posting_terms_at = now() where auth_id = auth.uid()`));
}
await q(`update public.profiles set role='host' where id=$1`, [people.host.prof]);
await q(`update public.profiles set posting_banned=true where id=$1`, [people.ban.prof]);

let aPost;
await test('user post → live as Community; server sets host, name, type, expiry (spoofed "Sun Cruiser"/verified ignored)', async () => {
  const r = await post('a', { host_name: 'Sun Cruiser', verification: 'verified', host_profile_id: people.b.prof });
  aPost = r[0];
  return (r[0].verification === 'community' && r[0].host_profile_id === people.a.prof && r[0].host_name === 'Alice'
    && r[0].event_type === 'brand' && r[0].created_by === 'profile:' + people.a.prof && !!r[0].expires_at) || JSON.stringify(r[0]);
});
await test('Community post is readable by signed-out users', async () =>
  (await as(null, () => q(`select id from public.events where id=$1`, [aPost.id]))).length === 1);
await test('user cannot set Date TBA → date_tba_hosts_only', async () => expectError(() => post('a', { date_tba: true }), 'date_tba_hosts_only'));
const scBrand = (await q(`select id from public.brands where slug='sun_cruiser'`))[0].id;
await test('user cannot attach a partner brand → partner_fields_hosts_only', async () => expectError(() => post('a', { brand_id: scBrand }), 'partner_fields_hosts_only'));
await test('word filter blocks objectionable title → objectionable_content', async () => expectError(() => post('b', { title: 'total bullshit party' }), 'objectionable_content'));
await test('unsupported city → unsupported_city', async () => expectError(() => post('b', { city: 'miami' }), 'unsupported_city'));
await test('description over 280 chars rejected', async () => expectError(() => post('b', { description: 'y'.repeat(281) }), 'events_social_description_len'));
await test('user cannot insert a Tonight row → RLS', async () => expectError(() => as('a', () => q(
  `insert into public.events (surface, title, city, latitude, longitude, start_time, event_type, host_name, created_by, expires_at)
   values ('tonight', 'x', 'tampa', 1, 1, now(), 'party', 'x', 'x', now() + interval '1 day')`)), 'row-level security'));
await test('rate limit: 2 more posts OK, the 4th in 24h → rate_limited', async () => {
  await post('a', { title: 'second' }); await post('a', { title: 'third' });
  return expectError(() => post('a', { title: 'fourth' }), 'rate_limited');
});
await test('banned user → posting_banned', async () => expectError(() => post('ban'), 'posting_banned'));
await test('host: Date TBA + partner brand + series allowed; still Community (only admins verify)', async () => {
  const r = await as('host', () => q(`insert into public.events (surface, category, title, city, latitude, longitude, start_time, expires_at, brand_id, series_id, date_tba, verification, host_name)
    values ('social', 'run_club', 'Host run', 'st_petersburg', 27.77, -82.63, now() + interval '300 days', now() + interval '1 year', $1, gen_random_uuid(), true, 'verified', 'Pinellas Run Club') returning verification, host_name`, [scBrand]));
  return (r[0].verification === 'community' && r[0].host_name === 'Pinellas Run Club') || JSON.stringify(r[0]);
});
await test('host is not rate-limited (5 posts in a row)', async () => {
  for (let i = 0; i < 5; i++) await post('host', { title: 'host post ' + i });
});

// Update / delete
await test("another user can't update or delete my post (0 rows affected)", async () => {
  const u = await as('b', () => db.query(`update public.events set title='hacked' where id=$1`, [aPost.id]));
  const d = await as('b', () => db.query(`delete from public.events where id=$1`, [aPost.id]));
  return (u.affectedRows === 0 && d.affectedRows === 0) || `updated ${u.affectedRows}, deleted ${d.affectedRows}`;
});
await test('owner can edit their title', async () => {
  const u = await as('a', () => db.query(`update public.events set title='Edited title' where id=$1`, [aPost.id]));
  return u.affectedRows === 1 || `updated ${u.affectedRows}`;
});
await test('owner cannot verify their own post → verification_admins_only', async () =>
  expectError(() => as('a', () => q(`update public.events set verification='verified' where id=$1`, [aPost.id])), 'verification_admins_only'));
await test('owner cannot rename host to a brand → partner_fields_hosts_only', async () =>
  expectError(() => as('a', () => q(`update public.events set host_name='Sun Cruiser' where id=$1`, [aPost.id])), 'partner_fields_hosts_only'));

// Roles
await test('user cannot make themselves admin → role_change_forbidden', async () =>
  expectError(() => as('a', () => q(`update public.profiles set role='admin' where auth_id=auth.uid()`)), 'role_change_forbidden'));
await test('user cannot lift their own ban → role_change_forbidden', async () =>
  expectError(() => as('ban', () => q(`update public.profiles set posting_banned=false where auth_id=auth.uid()`)), 'role_change_forbidden'));
await test('new profile created by the app is always role=user (requested admin ignored)', async () => {
  await q(`insert into auth.users (id, email) values ($1, 'new@example.com')`, [U(9)]);
  await db.exec(`SET ROLE authenticated`);
  await q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U(9), role: 'authenticated' })]);
  try { await q(`insert into public.profiles (auth_id, email, username, role) values ($1, 'new@example.com', 'newbie', 'admin')`, [U(9)]); }
  finally { await db.exec('RESET ROLE'); await q(`select set_config('request.jwt.claims', '', false)`); }
  const r = await q(`select role from public.profiles where auth_id=$1`, [U(9)]);
  return r[0].role === 'user' || r[0].role;
});

// ═════════════════════════ 00078 ═════════════════════════════════
await test('00078 applies; grants exactly "Mr. Venuu" + Noah (by auth email), nobody else', async () => {
  await db.exec(sql('00078_admins.sql'));
  const r = await q(`select username from public.profiles where role='admin' order by username`);
  return JSON.stringify(r.map(x => x.username)) === JSON.stringify(['mikev', 'noah']) || JSON.stringify(r);
});
await test('00078 re-run is a no-op', async () => {
  await db.exec(sql('00078_admins.sql'));
  return (await q(`select count(*)::int n from public.profiles where role='admin'`))[0].n === 2;
});

// Admin powers (Mike = admin now)
await test('admin verifies a Community post', async () => {
  const u = await as('mike', () => db.query(`update public.events set verification='verified' where id=$1`, [aPost.id]));
  return u.affectedRows === 1 || `updated ${u.affectedRows}`;
});
await test('admin denies it → hidden from the public, still visible to its owner (for the notice)', async () => {
  await as('mike', () => q(`update public.events set verification='denied' where id=$1`, [aPost.id]));
  const pub = await as(null, () => q(`select id from public.events where id=$1`, [aPost.id]));
  const other = await as('b', () => q(`select id from public.events where id=$1`, [aPost.id]));
  const own = await as('a', () => q(`select id, verification from public.events where id=$1`, [aPost.id]));
  return (pub.length === 0 && other.length === 0 && own.length === 1 && own[0].verification === 'denied') || JSON.stringify({ pub, other, own });
});
await test('owner marks the deny notice seen (denial_seen_at)', async () => {
  const u = await as('a', () => db.query(`update public.events set denial_seen_at=now() where id=$1`, [aPost.id]));
  return u.affectedRows === 1 || `updated ${u.affectedRows}`;
});
await as('mike', () => q(`update public.profiles set accepted_posting_terms_at = now() where auth_id = auth.uid()`));
await test('admin bans a poster; admin post can be Verified directly', async () => {
  const u = await as('mike', () => db.query(`update public.profiles set posting_banned=true where id=$1`, [people.b.prof]));
  const r = await as('mike', () => q(`insert into public.events (surface, category, title, city, latitude, longitude, start_time, verification)
    values ('social', 'nightlife', 'Admin event', 'tampa', 27.95, -82.45, now() + interval '1 day', 'verified') returning verification`));
  return (u.affectedRows === 1 && r[0].verification === 'verified') || JSON.stringify({ u: u.affectedRows, r });
});

// Reports & blocks
await test('reports: user files one; duplicate rejected; user cannot read reports; admin can', async () => {
  await as('fan', () => q(`insert into public.event_reports (event_id, reporter_profile_id, reason) values ($1, $2, 'spam')`, [T(1), people.fan.prof]));
  const dup = await expectError(() => as('fan', () => q(`insert into public.event_reports (event_id, reporter_profile_id, reason) values ($1, $2, 'other')`, [T(1), people.fan.prof])), 'duplicate key');
  const userRead = await as('fan', () => q(`select * from public.event_reports`));
  const adminRead = await as('mike', () => q(`select * from public.event_reports`));
  return (dup === true && userRead.length === 0 && adminRead.length === 1) || JSON.stringify({ dup, userRead: userRead.length, adminRead: adminRead.length });
});
await test("reports: can't file a report as someone else", async () =>
  expectError(() => as('fan', () => q(`insert into public.event_reports (event_id, reporter_profile_id, reason) values ($1, $2, 'spam')`, [T(4), people.a.prof])), 'row-level security'));
await test('blocks: own rows only', async () => {
  await as('fan', () => q(`insert into public.user_blocks (blocker_profile_id, blocked_profile_id) values ($1, $2)`, [people.fan.prof, people.a.prof]));
  const otherSees = await as('a', () => q(`select * from public.user_blocks`));
  const forged = await expectError(() => as('a', () => q(`insert into public.user_blocks (blocker_profile_id, blocked_profile_id) values ($1, $2)`, [people.fan.prof, people.b.prof])), 'row-level security');
  return (otherSees.length === 0 && forged === true) || JSON.stringify({ otherSees: otherSees.length, forged });
});

// RSVP
await test('RSVP (fixed): insert + delete with own profile id works', async () => {
  await as('a', () => q(`insert into public.event_rsvps (user_id, event_id) values ($1, $2)`, [people.a.prof, T(1)]));
  const d = await as('a', () => db.query(`delete from public.event_rsvps where user_id=$1 and event_id=$2`, [people.a.prof, T(1)]));
  return d.affectedRows === 1 || `deleted ${d.affectedRows}`;
});
await test("RSVP: can't RSVP as someone else", async () =>
  expectError(() => as('a', () => q(`insert into public.event_rsvps (user_id, event_id) values ($1, $2)`, [people.b.prof, T(1)])), 'row-level security'));

// Storage
await test('storage: photo upload into own folder OK; into another user\'s folder rejected', async () => {
  await as('a', () => q(`insert into storage.objects (bucket_id, name) values ('event-photos', $1)`, [people.a.prof + '/p.jpg']));
  return expectError(() => as('a', () => q(`insert into storage.objects (bucket_id, name) values ('event-photos', $1)`, [people.b.prof + '/p.jpg'])), 'row-level security');
});
await test('storage: brand-assets writable by admins only', async () => {
  await as('mike', () => q(`insert into storage.objects (bucket_id, name) values ('brand-assets', 'sun_cruiser/logo.png')`));
  return expectError(() => as('a', () => q(`insert into storage.objects (bucket_id, name) values ('brand-assets', 'x.png')`)), 'row-level security');
});
await test('storage: buckets configured (event-photos 5 MB, images only; both public)', async () => {
  const r = await q(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`);
  const ep = r.find(x => x.id === 'event-photos');
  return (r.length === 2 && r.every(x => x.public) && Number(ep.file_size_limit) === 5242880 && ep.allowed_mime_types.every(m => m.startsWith('image/'))) || JSON.stringify(r);
});

// Tonight never sees Social (the useEvents query, exactly as the app sends it)
const tonightQuery = (city) => q(`select id, surface from public.events
  where city = $1 and surface = 'tonight' and is_active = true and expires_at > now() order by start_time`, [city]);
await test('Tonight query (useEvents) returns Tonight rows only — no Social post ever reaches it', async () => {
  const social = (await q(`select count(*)::int n from public.events where surface='social' and city='tampa'`))[0].n;
  const anonRows = await as(null, () => tonightQuery('tampa'));
  const userRows = await as('a', () => tonightQuery('tampa'));
  const adminRows = await as('mike', () => tonightQuery('tampa'));
  const leak = [...anonRows, ...userRows, ...adminRows].some(r => r.surface !== 'tonight');
  return (social > 0 && !leak && anonRows.length === 2) || JSON.stringify({ social, anon: anonRows.length, leak });
});

// ═════════════════════════ 00079 ═════════════════════════════════
await test('00079 applies (1st run)', async () => { await db.exec(sql('00079_profiles_privacy.sql')); });
await test('00079 applies again (2nd run)', async () => { await db.exec(sql('00079_profiles_privacy.sql')); });

await test('signed-out user cannot read any email (profiles, public_profiles, every leaderboard view)', async () => {
  const p = await as(null, () => q(`select email from public.profiles`));
  const hasEmailCol = (await q(`select 1 from information_schema.columns where table_schema='public' and column_name='email'
    and table_name in ('public_profiles','user_venuu_rank','user_account_stats','venue_leaderboard','city_leaderboard','public_profile_view')`)).length;
  return (p.length === 0 && hasEmailCol === 0) || JSON.stringify({ profileRows: p.length, viewsWithEmail: hasEmailCol });
});
await test('signed-out user cannot read any auth_id (user_account_stats + user_venuu_rank masked)', async () => {
  const s = await as(null, () => q(`select count(*) filter (where auth_id is not null)::int n from public.user_account_stats`));
  const r = await as(null, () => q(`select count(*) filter (where auth_id is not null)::int n from public.user_venuu_rank`));
  return (s[0].n === 0 && r[0].n === 0) || JSON.stringify({ stats: s[0].n, rank: r[0].n });
});
await test("a user cannot read another user's email or auth_id", async () => {
  const p = await as('a', () => q(`select email from public.profiles where id=$1`, [people.b.prof]));
  const s = await as('a', () => q(`select auth_id from public.user_account_stats where profile_id=$1`, [people.b.prof]));
  return (p.length === 0 && s[0].auth_id === null) || JSON.stringify({ p, s });
});
await test('own profile still loads in full (useAuth select * by auth_id) and own stats keep auth_id', async () => {
  const p = await as('a', () => q(`select * from public.profiles where auth_id = $1`, [people.a.auth]));
  const s = await as('a', () => q(`select auth_id from public.user_account_stats where profile_id=$1`, [people.a.prof]));
  return (p.length === 1 && p[0].email === people.a.email && s[0].auth_id === people.a.auth) || JSON.stringify({ p: p.length, s });
});
await test('own profile still updates (EditProfileSheet)', async () => {
  const u = await as('a', () => db.query(`update public.profiles set display_name='Alice B' where id=$1`, [people.a.prof]));
  return u.affectedRows === 1 || `updated ${u.affectedRows}`;
});
await test('admins read every profile including email', async () => {
  const r = await as('mike', () => q(`select email from public.profiles`));
  return r.length >= Object.keys(people).length || `admin saw ${r.length}`;
});
await test('leaderboard queries (exact client column lists) still return rows signed-out', async () => {
  const rank = await as(null, () => q(`select profile_id,username,display_name,home_city,avatar_color,venuu_score,global_rank from public.user_venuu_rank order by global_rank limit 25`));
  const city = await as(null, () => q(`select * from public.city_leaderboard limit 25`));
  const venue = await as(null, () => q(`select * from public.venue_leaderboard limit 25`));
  const stats = await as('a', () => q(`select * from public.user_account_stats where profile_id=$1`, [people.a.prof]));
  return (rank.length > 0 && rank[0].username && stats.length === 1) || JSON.stringify({ rank: rank.length, city: city.length, venue: venue.length, stats: stats.length });
});
await test('public profile page: view by share token + token → id RPC work signed-out', async () => {
  const v = await as(null, () => q(`select username from public.public_profile_view where profile_share_token='tok-alice'`));
  const id = await as(null, () => q(`select public.profile_id_for_share_token('tok-alice') id`));
  return (v.length === 1 && id[0].id === people.a.prof) || JSON.stringify({ v, id });
});
await test('username availability via public_profiles works signed-out and signed-in', async () => {
  const taken = await as(null, () => q(`select id from public.public_profiles where username='bob'`));
  const free = await as('a', () => q(`select id from public.public_profiles where username='nobody_here'`));
  const cols = (await q(`select column_name from information_schema.columns where table_name='public_profiles' order by ordinal_position`)).map(r => r.column_name);
  return (taken.length === 1 && free.length === 0 && JSON.stringify(cols) === JSON.stringify(['id','username','display_name','avatar_url','avatar_color','home_city'])) || JSON.stringify({ taken: taken.length, free: free.length, cols });
});
await test('event cards still get the host name (denormalized on events) signed-out', async () => {
  const r = await as(null, () => q(`select title, host_name from public.events where surface='social' and host_name is not null limit 5`));
  return r.length > 0 || 'no social rows with host_name';
});
await test('policies on other tables that look up profiles still work (user_visits: own rows only)', async () => {
  await q(`insert into public.user_visits (user_id, venue_id, night_of, first_seen_at, last_seen_at, source) values
    ($1, '22222222-0000-4000-8000-000000000001', current_date, now(), now(), 'nfc'),
    ($2, '22222222-0000-4000-8000-000000000001', current_date, now(), now(), 'nfc')`, [people.a.prof, people.b.prof]);
  const mine = await as('a', () => q(`select user_id from public.user_visits`));
  const deps = (await q(`select count(*)::int n from pg_policies where schemaname='public' and tablename<>'profiles'
    and (qual ilike '%profiles%' or with_check ilike '%profiles%')`))[0].n;
  return (mine.length === 1 && mine[0].user_id === people.a.prof) || JSON.stringify({ mine, deps });
});
await test('00077 RSVP policy still works after 00079 (profile lookup inside the policy)', async () => {
  await as('a', () => q(`insert into public.event_rsvps (user_id, event_id) values ($1, $2)`, [people.a.prof, T(4)]));
});
await test('00077 posting still works after 00079 (host posts)', async () => { await post('host', { title: 'after 79' }); });

// 00079 guard refuses an unexpected view definition
await test('00079 guard: refuses to run if user_account_stats drifted from the validated definition', async () => {
  const { db: d2 } = await buildBase({ quiet: true });
  await d2.exec(sql('00077_social_production.sql'));
  await d2.exec(`CREATE OR REPLACE VIEW public.user_account_stats AS ` +
    (await d2.query(`select pg_get_viewdef('public.user_account_stats'::regclass, true) d`)).rows[0].d.replace(/;\s*$/, '') + ` WHERE true`);
  try { await d2.exec(sql('00079_profiles_privacy.sql')); return 'expected refusal'; }
  catch (e) { return e.message.includes('differs from the validated definition') || e.message; }
});

// 00078 ambiguity: never guesses
await test('00078 with two "Mr. Venuu" matches and no email match grants NOBODY', async () => {
  const { db: d3 } = await buildBase({ quiet: true });
  await d3.exec(sql('00077_social_production.sql'));
  await d3.query(`insert into public.profiles (auth_id, email, username, display_name) values
    (gen_random_uuid(), 'x1@e.com', 'mr_venuu', 'Mr Venuu'), (gen_random_uuid(), 'x2@e.com', 'mrvenuu2', 'Mr. Venuu')`);
  await d3.exec(sql('00078_admins.sql'));
  const n = (await d3.query(`select count(*)::int n from public.profiles where role='admin'`)).rows[0].n;
  return n === 0 || `${n} admins granted`;
});

// Counts for the report
const dep = await q(`select tablename, count(*)::int n from pg_policies where schemaname='public' and tablename<>'profiles'
  and (qual ilike '%profiles%' or with_check ilike '%profiles%') group by 1 order by 1`);

// ── Report ──────────────────────────────────────────────────────────
function printResults() {
  let pass = 0;
  for (const [ok, name, why] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${why ? '  — ' + why : ''}`); if (ok) pass++; }
  console.log(`\n${pass}/${results.length} passed`);
}
printResults();
console.log('profiles-dependent policies on other tables:', JSON.stringify(dep));
