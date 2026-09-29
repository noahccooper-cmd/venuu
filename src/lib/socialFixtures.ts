// ═══════════════════════════════════════════════════════════════════
// DEMO DATA — not real events. Local fixtures for the Social tab demo.
// Places and coordinates are real public locations; events, times and
// hosts are invented. Replace with the Supabase query in
// useSocialEvents once the migration lands.
//
// Dates are computed relative to "now" so the demo always has events
// today, this week and upcoming. Titles never contain brand names —
// brand lockups come from the theme, so the neutral theme stays clean.
// ═══════════════════════════════════════════════════════════════════

import type { CityKey } from './constants';
import type { SocialCategory, SocialEvent } from './socialTypes';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Local time `dayOffset` days from today at h:m. */
function at(now: Date, dayOffset: number, h: number, m = 0): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Nightlife later today: the preferred hour if still ahead, otherwise the
 *  next half hour at least an hour out — so "today" always has events. */
function laterToday(now: Date, h: number, m = 0): Date {
  const preferred = at(now, 0, h, m);
  if (preferred.getTime() - now.getTime() > HOUR) return preferred;
  const next = new Date(now.getTime() + HOUR);
  next.setMinutes(next.getMinutes() < 30 ? 30 : 60, 0, 0);
  return next;
}

/** Daytime events: today at h:m if still over an hour away, else
 *  tomorrow at the same hour — never pushed into the late night. */
function nextAt(now: Date, h: number, m = 0): Date {
  const today = at(now, 0, h, m);
  return today.getTime() - now.getTime() > HOUR ? today : at(now, 1, h, m);
}

/** Next occurrence of a weekday (0=Sun) at h:m, from today onward. */
function nextWeekday(now: Date, weekday: number, h: number, m = 0): Date {
  const diff = (weekday - now.getDay() + 7) % 7;
  const d = at(now, diff, h, m);
  return d.getTime() > now.getTime() ? d : new Date(d.getTime() + 7 * DAY);
}

interface Seed {
  id: string;
  city: CityKey;
  category: SocialCategory;
  brand: string | null;
  title: string;
  host_name: string;
  place: string;
  address: string;
  lat: number;
  lng: number;
  start: Date;
  hours: number;
  series_id?: string;
}

function row(s: Seed): SocialEvent {
  const end = new Date(s.start.getTime() + s.hours * HOUR);
  return {
    id: s.id,
    city: s.city,
    surface: 'social',
    category: s.category,
    brand: s.brand,
    title: s.title,
    host_name: s.host_name,
    external_venue_name: s.place,
    address: s.address,
    latitude: s.lat,
    longitude: s.lng,
    start_time: s.start.toISOString(),
    end_time: end.toISOString(),
    expires_at: end.toISOString(),
    series_id: s.series_id ?? null,
  };
}

// TODO(schedule): placeholder run club day/time — Thursdays 6:30 PM.
// Confirm with Pinellas Run Club and update here + socialTheme.ts.
const RUN_CLUB_WEEKDAY = 4;
const RUN_CLUB_HOUR = 18;
const RUN_CLUB_MINUTE = 30;
const RUN_CLUB_SERIES = 'demo-series-pinellas-run-club';

export function buildSocialFixtures(now: Date = new Date()): SocialEvent[] {
  const seeds: Seed[] = [];

  // ── Pinellas (st_petersburg) ────────────────────────────────────
  // Weekly run club series — next 4 occurrences (the + Add flow will
  // create 8; 4 keeps the demo list readable).
  const firstRun = nextWeekday(now, RUN_CLUB_WEEKDAY, RUN_CLUB_HOUR, RUN_CLUB_MINUTE);
  for (let i = 0; i < 4; i++) {
    seeds.push({
      id: `demo-pin-run-${i + 1}`, city: 'st_petersburg', category: 'run_club',
      brand: 'pinellas_run_club', title: 'Weekly Social Run', host_name: 'Pinellas Run Club',
      place: 'Vinoy Park', address: '701 Bayshore Dr NE, St. Petersburg, FL 33701',
      lat: 27.7812, lng: -82.6268, start: new Date(firstRun.getTime() + i * 7 * DAY), hours: 1.5,
      series_id: RUN_CLUB_SERIES,
    });
  }
  seeds.push(
    {
      id: 'demo-pin-popup-pier', city: 'st_petersburg', category: 'pop_up', brand: 'suncruiser',
      title: 'Pier Pop-Up', host_name: 'Venuu',
      place: 'St. Pete Pier', address: '600 2nd Ave NE, St. Petersburg, FL 33701',
      lat: 27.7733, lng: -82.6235, start: nextAt(now, 16), hours: 4,
    },
    {
      id: 'demo-pin-popup-beach', city: 'st_petersburg', category: 'pop_up', brand: 'suncruiser',
      title: 'Beach Day Pop-Up', host_name: 'Venuu',
      place: 'Pier 60', address: '1 Causeway Blvd, Clearwater Beach, FL 33767',
      lat: 27.9776, lng: -82.8290, start: at(now, 9, 12), hours: 5,
    },
    {
      id: 'demo-pin-night-jannus', city: 'st_petersburg', category: 'nightlife', brand: null,
      title: 'Late Show on Central', host_name: 'Venuu',
      place: 'Jannus Live', address: '200 1st Ave N, St. Petersburg, FL 33701',
      lat: 27.7717, lng: -82.6361, start: laterToday(now, 21), hours: 4,
    },
    {
      id: 'demo-pin-night-dunedin', city: 'st_petersburg', category: 'nightlife', brand: null,
      title: 'Marina Night Market', host_name: 'Venuu',
      place: 'Dunedin Marina', address: '51 Main St, Dunedin, FL 34698',
      lat: 28.0118, lng: -82.7925, start: at(now, 3, 19), hours: 4,
    },
    {
      id: 'demo-pin-night-beach', city: 'st_petersburg', category: 'nightlife', brand: null,
      title: 'Sunset Session', host_name: 'Venuu',
      place: 'St. Pete Beach', address: '6300 Gulf Blvd, St. Pete Beach, FL 33706',
      lat: 27.7253, lng: -82.7412, start: at(now, 16, 19, 30), hours: 3,
    },
  );

  // ── Tampa ───────────────────────────────────────────────────────
  seeds.push(
    {
      id: 'demo-tpa-run-bayshore', city: 'tampa', category: 'run_club', brand: null,
      title: 'Bayshore Sunrise 5K', host_name: 'Venuu',
      place: 'Bayshore Blvd', address: 'Bayshore Blvd & W Rome Ave, Tampa, FL 33606',
      lat: 27.9281, lng: -82.4702, start: at(now, 2, 6, 30), hours: 1,
    },
    {
      id: 'demo-tpa-run-curtis', city: 'tampa', category: 'run_club', brand: null,
      title: 'Riverwalk Evening Run', host_name: 'Venuu',
      place: 'Curtis Hixon Park', address: '600 N Ashley Dr, Tampa, FL 33602',
      lat: 27.9497, lng: -82.4623, start: nextAt(now, 18), hours: 1,
    },
    {
      id: 'demo-tpa-popup-sparkman', city: 'tampa', category: 'pop_up', brand: 'suncruiser',
      title: 'Wharf Pop-Up', host_name: 'Venuu',
      place: 'Sparkman Wharf', address: '615 Channelside Dr, Tampa, FL 33602',
      lat: 27.9437, lng: -82.4487, start: at(now, 4, 15), hours: 5,
    },
    {
      id: 'demo-tpa-popup-hyde', city: 'tampa', category: 'pop_up', brand: null,
      title: 'Makers Market', host_name: 'Venuu',
      place: 'Hyde Park Village', address: '1602 W Snow Ave, Tampa, FL 33606',
      lat: 27.9372, lng: -82.4747, start: at(now, 12, 11), hours: 5,
    },
    {
      id: 'demo-tpa-night-armature', city: 'tampa', category: 'nightlife', brand: null,
      title: 'Rooftop Session', host_name: 'Venuu',
      place: 'Armature Works', address: '1910 N Ola Ave, Tampa, FL 33602',
      lat: 27.9608, lng: -82.4633, start: laterToday(now, 21), hours: 4,
    },
    {
      id: 'demo-tpa-night-ybor', city: 'tampa', category: 'nightlife', brand: null,
      title: 'Seventh Ave Crawl', host_name: 'Venuu',
      place: 'Ybor City', address: '1600 E 7th Ave, Tampa, FL 33605',
      lat: 27.9601, lng: -82.4371, start: at(now, 5, 21), hours: 5,
    },
    {
      id: 'demo-tpa-night-channel', city: 'tampa', category: 'nightlife', brand: null,
      title: 'Channelside Late Set', host_name: 'Venuu',
      place: 'Channelside', address: '615 Channelside Dr, Tampa, FL 33602',
      lat: 27.9426, lng: -82.4502, start: at(now, 20, 22), hours: 4,
    },
  );

  // ── Knoxville ───────────────────────────────────────────────────
  seeds.push(
    {
      id: 'demo-knx-run-greenway', city: 'knoxville', category: 'run_club', brand: null,
      title: 'Greenway Social Run', host_name: 'Venuu',
      place: 'Neyland Greenway', address: 'Neyland Dr, Knoxville, TN 37916',
      lat: 35.9555, lng: -83.9225, start: at(now, 1, 18), hours: 1,
    },
    {
      id: 'demo-knx-run-worldsfair', city: 'knoxville', category: 'run_club', brand: null,
      title: 'Saturday Park Loop', host_name: 'Venuu',
      place: "World's Fair Park", address: '963 World Fair Park Dr, Knoxville, TN 37916',
      lat: 35.9616, lng: -83.9240, start: at(now, 10, 8), hours: 1,
    },
    {
      id: 'demo-knx-popup-market', city: 'knoxville', category: 'pop_up', brand: null,
      title: 'Market Square Pop-Up', host_name: 'Venuu',
      place: 'Market Square', address: 'Market Square, Knoxville, TN 37902',
      lat: 35.9651, lng: -83.9192, start: nextAt(now, 17), hours: 4,
    },
    {
      id: 'demo-knx-night-oldcity', city: 'knoxville', category: 'nightlife', brand: null,
      title: 'Old City After Dark', host_name: 'Venuu',
      place: 'Old City', address: 'Jackson Ave, Knoxville, TN 37915',
      lat: 35.9702, lng: -83.9176, start: laterToday(now, 22), hours: 4,
    },
    {
      id: 'demo-knx-night-strip', city: 'knoxville', category: 'nightlife', brand: null,
      title: 'Strip Night', host_name: 'Venuu',
      place: 'Cumberland Ave', address: '1800 Cumberland Ave, Knoxville, TN 37916',
      lat: 35.9557, lng: -83.9290, start: at(now, 3, 22), hours: 4,
    },
    {
      id: 'demo-knx-night-gay', city: 'knoxville', category: 'nightlife', brand: null,
      title: 'Gay Street Late Set', host_name: 'Venuu',
      place: 'Gay Street', address: '500 S Gay St, Knoxville, TN 37902',
      lat: 35.9637, lng: -83.9173, start: at(now, 15, 21), hours: 4,
    },
  );

  return seeds.map(row);
}
