/** Map visual effects: street-following particles with human realism, night phase. */

import { getWalkingRoute } from './directions';

/* ── Night Phase System ── */

export interface NightPhase {
  speedMultiplier: number;
  glowMultiplier: number;
  particleCount: number;
  ridesharePercent: number;
  label: string;
}

export function getNightPhase(): NightPhase {
  const hour = new Date().getHours();
  if (hour >= 20 && hour < 21) return { speedMultiplier: 0.7, glowMultiplier: 0.8, particleCount: 8,  ridesharePercent: 0.03, label: 'early' };
  if (hour >= 21 && hour < 23) return { speedMultiplier: 1.0, glowMultiplier: 1.0, particleCount: 15, ridesharePercent: 0.05, label: 'prime' };
  if (hour >= 23 || hour < 1)  return { speedMultiplier: 1.3, glowMultiplier: 1.2, particleCount: 20, ridesharePercent: 0.05, label: 'peak' };
  if (hour >= 1 && hour < 2)   return { speedMultiplier: 0.9, glowMultiplier: 0.9, particleCount: 12, ridesharePercent: 0.15, label: 'late' };
  return { speedMultiplier: 0.5, glowMultiplier: 0.6, particleCount: 5, ridesharePercent: 0.20, label: 'quiet' };
}

/* ── Particle System ── */

type ParticleType = 'single' | 'pair' | 'group' | 'rideshare';

export interface Particle {
  routeCoords: [number, number][];
  progress: number;
  speed: number;
  type: ParticleType;
  wobbleFreq: number;       // Hz — unique per particle
  wobblePhase: number;      // offset so wobbles aren't synced
  lingerTimer: number;      // frames remaining to linger at destination (0 = not lingering)
  isRideshare: boolean;
}

export interface RouteCache {
  routes: [number, number][][];
  lastFetchTime: number;
}

// Speed constants: progress per frame at 30fps
// ~45s (fast walker) to ~75s (slow group) on screen
const SPEED_SINGLE = 0.00037;  // ~45s
const SPEED_PAIR   = 0.00033;  // ~50s
const SPEED_GROUP  = 0.00028;  // ~60s
const SPEED_RIDE   = 0.0012;   // ~14s (3-4x walker speed)

/** Fetch and cache walking routes. Max 10 API calls, 5-minute cache. */
export async function fetchRoutesForParticles(
  activeVenues: { id: string; lng: number; lat: number }[],
  token: string,
  existingCache: RouteCache | null,
): Promise<RouteCache> {
  if (existingCache && Date.now() - existingCache.lastFetchTime < 300_000 && existingCache.routes.length > 0) {
    return existingCache;
  }
  if (activeVenues.length < 2) return { routes: [], lastFetchTime: Date.now() };

  const pairs: [number, number][] = [];
  const maxPairs = Math.min(10, Math.floor(activeVenues.length * (activeVenues.length - 1) / 2));
  const tried = new Set<string>();

  for (let attempt = 0; attempt < 50 && pairs.length < maxPairs; attempt++) {
    const a = Math.floor(Math.random() * activeVenues.length);
    let b = Math.floor(Math.random() * (activeVenues.length - 1));
    if (b >= a) b++;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (tried.has(key)) continue;
    tried.add(key);
    pairs.push([a, b]);
  }

  const routes: [number, number][][] = [];
  const results = await Promise.allSettled(
    pairs.map(([a, b]) =>
      getWalkingRoute(
        [activeVenues[a].lng, activeVenues[a].lat],
        [activeVenues[b].lng, activeVenues[b].lat],
        token,
      )
    )
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      const coords = r.value.geometry.coordinates as [number, number][];
      if (coords.length >= 2) routes.push(coords);
    }
  }

  return { routes, lastFetchTime: Date.now() };
}

/** Spawn a particle on a random cached route with human-realistic properties. */
export function spawnParticle(cache: RouteCache, phase: NightPhase): Particle | null {
  if (cache.routes.length === 0) return null;
  const idx = Math.floor(Math.random() * cache.routes.length);
  const reversed = Math.random() > 0.5;
  const coords = reversed ? [...cache.routes[idx]].reverse() : cache.routes[idx];

  // Determine particle type
  const isRideshare = Math.random() < phase.ridesharePercent;
  let type: ParticleType;
  let speed: number;

  if (isRideshare) {
    type = 'rideshare';
    speed = SPEED_RIDE * (0.85 + Math.random() * 0.3);
  } else {
    const roll = Math.random();
    if (roll < 0.5) {
      type = 'single';
      speed = SPEED_SINGLE * (0.85 + Math.random() * 0.3);
    } else if (roll < 0.8) {
      type = 'pair';
      speed = SPEED_PAIR * (0.85 + Math.random() * 0.3);
    } else {
      type = 'group';
      speed = SPEED_GROUP * (0.85 + Math.random() * 0.3);
    }
  }

  // Stagger start: random initial progress within first 15%
  const startProgress = Math.random() * 0.15;

  // 20% of walkers will linger at destination
  const willLinger = !isRideshare && Math.random() < 0.2;

  return {
    routeCoords: coords,
    progress: startProgress,
    speed,
    type,
    wobbleFreq: 0.5 + Math.random() * 1.0,
    wobblePhase: Math.random() * Math.PI * 2,
    lingerTimer: willLinger ? Math.floor(90 + Math.random() * 60) : 0, // 3-5 seconds at 30fps
    isRideshare,
  };
}

/** Tick a particle. Returns position + done status + color hint. O(1) per call. */
export function tickParticle(p: Particle, now: number): { pos: [number, number]; done: boolean; color: string } {
  // If lingering at destination, count down
  if (p.progress >= 1 && p.lingerTimer > 0) {
    p.lingerTimer--;
    const lastCoord = p.routeCoords[p.routeCoords.length - 1];
    return { pos: lastCoord, done: false, color: p.isRideshare ? '#FFE0A0' : '#FFFFFF' };
  }

  p.progress += p.speed;
  if (p.progress >= 1 && p.lingerTimer <= 0) {
    return { pos: p.routeCoords[p.routeCoords.length - 1], done: true, color: '#FFFFFF' };
  }

  const t = Math.min(p.progress, 1);
  const totalPoints = p.routeCoords.length - 1;
  const exactIdx = t * totalPoints;
  const idx = Math.floor(exactIdx);
  const frac = exactIdx - idx;
  const next = Math.min(idx + 1, totalPoints);

  // Base position via linear interpolation
  let lng = p.routeCoords[idx][0] + (p.routeCoords[next][0] - p.routeCoords[idx][0]) * frac;
  let lat = p.routeCoords[idx][1] + (p.routeCoords[next][1] - p.routeCoords[idx][1]) * frac;

  // Walking wobble (skip for rideshares — cars don't wobble)
  if (!p.isRideshare) {
    const dx = p.routeCoords[next][0] - p.routeCoords[idx][0];
    const dy = p.routeCoords[next][1] - p.routeCoords[idx][1];
    const wobble = Math.sin(now * p.wobbleFreq * 0.001 + p.wobblePhase) * 0.000012;
    lng += -dy * wobble;
    lat += dx * wobble;
  }

  const color = p.isRideshare ? '#FFE0A0' : '#FFFFFF';
  return { pos: [lng, lat], done: false, color };
}

/** Build GeoJSON with per-feature color property. */
export function particlesToGeoJSON(
  positions: [number, number][],
  colors: string[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: positions.map((pos, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: pos },
      properties: { color: colors[i] ?? '#FFFFFF' },
    })),
  };
}
