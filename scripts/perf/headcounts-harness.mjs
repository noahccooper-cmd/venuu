#!/usr/bin/env node
/**
 * Tonight-map headcount timing harness.
 *
 * Serves a production build (dist dir) and drives it in Chromium with
 * Playwright. Supabase and Mapbox are mocked at the network layer so a
 * run needs no credentials and performs no writes:
 *
 *   • REST  GET /rest/v1/venues returns 92 venues across 3 cities with
 *     the headcount_estimates embed in PostgREST's one-to-one shape
 *     (object | null, because venue_id is the table's PK). Every other
 *     read returns []. Any non-GET request is aborted and counted.
 *   • Realtime: a Phoenix-protocol WebSocket mock that acks channel
 *     joins and, like pg_cron's '* 21-23,0-6 * * *' fuse-estimates job,
 *     emits a burst of headcount_estimates UPDATEs at each wall-clock
 *     minute boundary (+FUSION_RUNTIME_MS).
 *   • Mapbox: a minimal dark style; tiles, glyphs and telemetry stubbed.
 *
 * Latency is injected on REST (REST_LATENCY_MS) and the CPU is
 * throttled (CPU_THROTTLE×) to approximate a phone.
 *
 * Usage:
 *   node scripts/perf/headcounts-harness.mjs --dist dist --runs 3 [--label after]
 *        [--screenshot out.png --at 2026-10-01T18:00:00Z] [--video dir]
 *        [--dev http://localhost:5173]   # count [BEACON]/[IGNITE] logs on a dev server
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));

const DIST = args.dist ? path.resolve(args.dist) : null;
const DEV_URL = args.dev ?? null;
const RUNS = Number(args.runs ?? 3);
const LABEL = args.label ?? path.basename(DIST ?? 'dev');
const REST_LATENCY_MS = Number(args.latency ?? 300);
const CPU_THROTTLE = Number(args.cpu ?? 4);
const FUSION_RUNTIME_MS = 3000;
// Night by default (22:30 EDT): inside the fusion window.
const FIXED_TIME = args.at ?? '2026-10-02T02:30:00Z';
const TIMEOUT_MS = Number(args.timeout ?? 75_000);
const SUPABASE = 'https://tyouvhtgzwcbqpylcssk.supabase.co';
const MAPBOX_CSS = fs.readFileSync(new URL('../../node_modules/mapbox-gl/dist/mapbox-gl.css', import.meta.url), 'utf8');

// ── Fixture ─────────────────────────────────────────────────────
const CENTERS = {
  knoxville: { lat: 35.9570, lng: -83.9275, n: 30 },
  tampa: { lat: 27.9506, lng: -82.4572, n: 36 },
  st_petersburg: { lat: 27.7706, lng: -82.6398, n: 26 },
};
const STATES = ['Quiet', 'Lively', 'Busy', 'Packed', 'Surging'];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function buildFixture(nowIso) {
  const r = rng(42);
  const venues = [];
  let sort = 0;
  for (const [city, c] of Object.entries(CENTERS)) {
    for (let i = 0; i < c.n; i++) {
      const id = `00000000-0000-4000-8000-${String(venues.length + 1).padStart(12, '0')}`;
      const hasEst = i % 8 !== 7; // ~88% have algorithm data
      const state = STATES[Math.floor(r() * STATES.length)];
      const estimate = Math.round(20 + r() * 260);
      venues.push({
        id, created_at: nowIso, name: `${city} venue ${i + 1}`, slug: `${city}-${i + 1}`, city,
        category: 'bar', address: '', lat: c.lat + (r() - 0.5) * 0.04, lng: c.lng + (r() - 0.5) * 0.03,
        image_url: null, deals: null, hours: null, instagram: null, vibe_tagline: null,
        has_live_cam: false, live_cam_url: null, cam_coming_soon: false, is_active: true, sort_order: sort++,
        capacity: 300, is_clicker_live: false, staff_code: null, phone: null, website: null, description: null,
        rating: null, review_count: null, tonight_special: null, special_updated_at: null,
        cover_charge: i % 3 === 0 ? '$5' : (i % 3 === 1 ? 'FREE' : null), featured: false, featured_label: null,
        loyalty_active: false, nfc_tag_id: null, nfc_required: false, vibe_hue_baseline: null,
        is_hub: false, hub_subtitle: null, tenant_of: null,
        // PostgREST one-to-one embed: an object or null — NOT an array.
        headcount_estimates: hasEst ? {
          estimate, estimate_low: estimate - 15, estimate_high: estimate + 15,
          confidence_pct: Math.round(45 + r() * 45), capacity_pct: Math.round(r() * 110) / 100,
          state_label: state, trend: 'flat', trend_rate: 0, computed_at: nowIso,
          source_breakdown: { baseline_source: 'besttime_live' }, delta_pct: 0, expected_pct: 0.5,
        } : null,
      });
    }
  }
  return venues;
}

// ── Static server for the build ─────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function serve(dir) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(dir, u);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'max-age=31536000' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Page instrumentation (runs before app code) ─────────────────
const INIT = ({ expected, fixedTime, storage }) => {
  for (const [k, v] of Object.entries(storage)) {
    if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }
  const marks = {};
  const mark = (k) => { if (!(k in marks)) marks[k] = Math.round(performance.now()); };
  window.__perf = { marks, expected, fixedTime };
  const tick = () => {
    const markers = document.querySelectorAll('.venue-marker');
    if (markers.length) mark('markersInDom');
    let dotsVisible = 0, numsVisible = 0, numsInDom = 0, liveFrom = 0;
    for (const m of markers) {
      const hasNum = !!m.querySelector('.lvb-count');
      if (hasNum) numsInDom++;
      if (m.textContent.includes('Live from')) liveFrom++;
      if (parseFloat(getComputedStyle(m).opacity) > 0.5) {
        dotsVisible++;
        if (hasNum) numsVisible++;
      }
    }
    if (dotsVisible > 0) mark('dotsVisible');
    if (markers.length && dotsVisible >= markers.length * 0.9) mark('allDotsVisible');
    if (numsInDom >= expected * 0.9) mark('numbersInDom');
    if (numsVisible >= expected * 0.9) mark('numbersVisible');
    window.__perf.state = { markers: markers.length, dotsVisible, numsVisible, numsInDom, liveFrom };
    window.__perf.rafCount = (window.__perf.rafCount ?? 0) + 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function runOnce(browser, ctx, url, fixture, opts) {
  const page = await ctx.newPage();
  const consoleCounts = { BEACON: 0, IGNITE: 0 };
  page.on('console', m => {
    const t = m.text();
    if (t.startsWith('[BEACON]')) consoleCounts.BEACON++;
    if (t.startsWith('[IGNITE] effect ran')) consoleCounts.IGNITE++;
  });
  const blockedWrites = [];
  const sentTicks = [];

  await page.clock.setFixedTime(new Date(opts.fixedTime));

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  // Supabase REST / auth / functions
  await page.route(`${SUPABASE}/**`, async route => {
    const req = route.request();
    const u = new URL(req.url());
    const isRpc = u.pathname.startsWith('/rest/v1/rpc/');
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && !isRpc && req.method() !== 'OPTIONS') {
      blockedWrites.push(`${req.method()} ${u.pathname}`);
      return route.abort();
    }
    await sleep(REST_LATENCY_MS);
    if (u.pathname === '/rest/v1/venues' && u.searchParams.get('select')?.includes('headcount_estimates')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    }
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) {
      return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Third-party fonts / Stripe: fail fast (identical for before and after).
  await page.route(/https:\/\/(api\.fontshare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|js\.stripe\.com)\/.*/, route => route.abort());

  // Mapbox
  await page.route(/https:\/\/(api|events|[a-z]\.tiles)\.mapbox\.com\/.*/, route => {
    const u = route.request().url();
    if (u.endsWith('mapbox-gl.css')) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: MAPBOX_CSS });
    }
    if (u.includes('/styles/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        version: 8, name: 'perf-dark', sources: {},
        glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0b0b10' } }],
      }) });
    }
    if (u.includes('/directions/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"routes":[]}' });
    return route.fulfill({ status: 204, body: '' });
  });

  // Realtime (Phoenix v2 array frames)
  const subs = []; // { ws, topic, id, table }
  let nextId = 1000;
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, ws => {
    ws.onMessage(raw => {
      if (typeof raw !== 'string') return;
      const [joinRef, ref, topic, event, payload] = JSON.parse(raw);
      if (event === 'heartbeat') return ws.send(JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]));
      if (event === 'phx_join') {
        const pcs = (payload?.config?.postgres_changes ?? []).map(f => ({ ...f, id: nextId++ }));
        pcs.forEach(p => subs.push({ ws, topic, id: p.id, table: p.table }));
        return ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: pcs } }]));
      }
      if (event === 'phx_leave') return ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
    });
  });

  // pg_cron-style fusion ticks at wall-clock minute boundaries.
  const startedAt = Date.now();
  let tickNo = 0;
  const scheduleTick = () => {
    const next = Math.ceil((Date.now() + 1) / 60_000) * 60_000 + FUSION_RUNTIME_MS;
    return setTimeout(() => {
      tickNo++;
      const t = Date.now() - startedAt;
      let n = 0;
      for (const v of fixture) {
        if (!v.headcount_estimates) continue;
        const est = { ...v.headcount_estimates, venue_id: v.id, estimate: v.headcount_estimates.estimate + (n % 4 === 0 ? tickNo * 3 : 0) };
        for (const s of subs.filter(s => s.table === 'headcount_estimates')) {
          try {
            s.ws.send(JSON.stringify([null, null, s.topic, 'postgres_changes', { ids: [s.id], data: {
              type: 'UPDATE', schema: 'public', table: 'headcount_estimates', commit_timestamp: opts.fixedTime,
              columns: [], record: est, old_record: { venue_id: v.id }, errors: null,
            } }]));
          } catch { /* closed */ }
        }
        n++;
      }
      sentTicks.push({ atMs: t, rows: n });
      tickTimer = scheduleTick();
    }, next - Date.now());
  };
  let tickTimer = scheduleTick();

  await page.addInitScript(INIT, { expected: fixture.filter(v => v.headcount_estimates).length, fixedTime: opts.fixedTime, storage: opts.storage });

  const navStart = Date.now();
  if (args.probe) {
    const rel = () => `${Date.now() - navStart}ms`;
    page.on('request', r => { if (r.url().startsWith(url)) console.error(`[probe ${opts.tag}] ${rel()} request ${r.url().replace(url, '/')}`); });
    page.on('requestfinished', r => { if (r.url().startsWith(url)) console.error(`[probe ${opts.tag}] ${rel()} finished ${r.url().replace(url, '/')}`); });
    page.on('domcontentloaded', () => console.error(`[probe ${opts.tag}] ${rel()} domcontentloaded`));
    page.on('load', () => console.error(`[probe ${opts.tag}] ${rel()} load`));
  }
  await page.goto(url, { waitUntil: 'commit' });
  if (args.probe) console.error(`[probe ${opts.tag}] ${Date.now() - navStart}ms goto committed`);
  let perf;
  const deadline = navStart + TIMEOUT_MS;
  const probe = [];
  while (Date.now() < deadline) {
    perf = await page.evaluate(() => window.__perf).catch(() => null);
    if (args.probe) {
      const p = await page.evaluate(() => ({ m: document.querySelectorAll('.venue-marker').length, vis: document.visibilityState, raf: window.__perf?.rafCount ?? 0, now: Math.round(performance.now()) })).catch(() => null);
      if (p) probe.push(p);
    }
    if (perf?.marks?.numbersVisible !== undefined && Date.now() - navStart > (opts.minRunMs ?? 0)) break;
    await sleep(200);
  }
  clearTimeout(tickTimer);
  if (args.probe) {
    const nt = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const r = performance.getEntriesByType('resource').filter(e => /\/assets\//.test(e.name))
        .map(e => `${e.name.split('/').pop()} start=${Math.round(e.startTime)} end=${Math.round(e.responseEnd)} xfer=${e.transferSize}`);
      return { nav: n && { fetchStart: Math.round(n.fetchStart), reqStart: Math.round(n.requestStart), respStart: Math.round(n.responseStart), respEnd: Math.round(n.responseEnd), domInteractive: Math.round(n.domInteractive), type: n.type }, r };
    }).catch(e => String(e));
    console.error(`[probe ${opts.tag ?? ''}] timing ${JSON.stringify(nt)}`);
    const firstM = probe.find(p => p.m > 0);
    console.error(`[probe ${opts.tag ?? ''}] first markers (node poll) at ${firstM?.now}ms; rAF samples: ${probe.filter((_, i) => i % 10 === 0).map(p => `${p.now}:${p.raf}:${p.vis}`).join(' ')}`);
  }
  const result = { ...perf, ticks: sentTicks, blockedWrites, consoleCounts, page };
  return result;
}

async function main() {
  const fixture = buildFixture(new Date(new Date(FIXED_TIME).getTime() - 40_000).toISOString());
  if (args['dump-fixture']) { fs.writeFileSync(args['dump-fixture'], JSON.stringify(fixture)); return; }
  const srv = DIST ? await serve(DIST) : null;
  const url = DEV_URL ?? `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const storage = { venuu_onboarded: 'true', venue_city: args.city ?? 'tampa', venuu_intro_enabled: 'false' };
  const viewport = { width: 390, height: 844 };

  if (args.screenshot) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: args.reduced ? 'reduce' : 'no-preference' });
    const r = await runOnce(browser, ctx, url, fixture, { fixedTime: FIXED_TIME, storage, minRunMs: 0 });
    await sleep(Number(args.settle ?? 3000));
    await r.page.screenshot({ path: args.screenshot });
    console.log(JSON.stringify({ screenshot: args.screenshot, state: r.state, marks: r.marks }));
    await ctx.close();
  } else {
    const rows = [];
    for (let i = 0; i < RUNS; i++) {
      // Cold: fresh context (no cache, no localStorage). Warm: reload in the same context.
      const ctx = await browser.newContext({
        viewport,
        recordVideo: args.video ? { dir: args.video, size: viewport } : undefined,
      });
      const cold = await runOnce(browser, ctx, url, fixture, { fixedTime: FIXED_TIME, storage, minRunMs: args.dev ? 70_000 : 0, tag: 'cold' });
      await cold.page.close();
      const warm = await runOnce(browser, ctx, url, fixture, { fixedTime: FIXED_TIME, storage, minRunMs: args.dev ? 70_000 : 0, tag: 'warm' });
      await warm.page.close();
      await ctx.close();
      for (const [kind, r] of [['cold', cold], ['warm', warm]]) {
        rows.push({ label: LABEL, run: i + 1, kind, ...r.marks, ticks: r.ticks.map(t => t.atMs), blockedWrites: r.blockedWrites.length, BEACON: r.consoleCounts.BEACON, IGNITE: r.consoleCounts.IGNITE });
      }
      console.error(`[${LABEL}] run ${i + 1}: cold ${JSON.stringify(cold.marks)} warm ${JSON.stringify(warm.marks)}`);
    }
    console.log(JSON.stringify(rows));
  }
  await browser.close();
  srv?.close();
}

main().catch(e => { console.error(e); process.exit(1); });
