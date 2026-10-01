/**
 * Display helpers for events: vibe → color mapping, relative time
 * formatting, price tier glyphs.
 */

import type { LineupEvent } from '../hooks/useEventsLineup';

/**
 * Color palette for event vibe_tags. The first matching tag drives
 * the event's color across the map orb, card stripe, and detail sheet.
 */
const VIBE_COLORS: Record<string, string> = {
  // EDM family — gold
  edm: '#FFB800',
  bass: '#FFA500',
  dubstep: '#FF8C00',
  house: '#FFD700',
  tech_house: '#FFD700',
  // Concerts — white
  concert: '#F0F0F5',
  indie: '#E8E8F0',
  folk: '#F5E6D3',
  // Hip-hop/rap — magenta
  hip_hop: '#EC4899',
  // R&B — purple
  rnb: '#9F7AEA',
  // Boat/waterfront — cyan
  boat: '#22D3EE',
  waterfront: '#22D3EE',
  // Country — copper
  country: '#D97706',
  // Rock/classic_rock — crimson
  rock: '#DC2626',
  classic_rock: '#B91C1C',
  // Social — warm white
  social: '#FEF3C7',
  // Throwback — magenta-pink
  throwback: '#F472B6',
  // Reggaeton — orange-red
  reggaeton: '#F97316',
  // Launch (venuu only) — venuu orange
  launch: '#FF8200',
  // Tasting/wine — plum
  tasting: '#A855F7',
  // Fitness/yoga — sage
  fitness: '#84CC16',
  yoga: '#84CC16',
  // Trivia/game — blue
  trivia: '#3B82F6',
  // Brunch — peach
  brunch: '#FB923C',
  // Fallback
  default: '#FFFFFF',
};

export function vibeColor(vibe_tags?: string[] | null): string {
  if (!vibe_tags || vibe_tags.length === 0) return VIBE_COLORS.default;
  for (const tag of vibe_tags) {
    if (VIBE_COLORS[tag]) return VIBE_COLORS[tag];
  }
  return VIBE_COLORS.default;
}

/**
 * Compact relative time: "TONIGHT 8pm", "TOMORROW 10pm", "SAT 8pm",
 * "JUN 26", "JUL 9".
 */
export function relativeTime(startISO: string, now: Date = new Date()): string {
  const start = new Date(startISO);
  const diffHours = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
  const diffDays = Math.floor(diffHours / 24);

  const time = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).replace(':00 ', '').replace(' ', '').toLowerCase();

  if (diffHours < 24 && start.getDate() === now.getDate()) {
    return `TONIGHT ${time}`;
  }
  if (diffDays >= 0 && diffDays < 2) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (start.getDate() === tomorrow.getDate()) {
      return `TOMORROW ${time}`;
    }
  }
  if (diffDays < 7) {
    const dow = start.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    return `${dow} ${time}`;
  }
  // Beyond a week: MON DD
  const mon = start.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return `${mon} ${start.getDate()}`;
}

/**
 * Price tier display: $, $$, $$$, $$$$ or 'free'
 */
export function priceTierGlyph(priceTier: string | null | undefined): string {
  if (priceTier === 'free' || !priceTier) return 'FREE';
  if (priceTier === 'low') return '$';
  if (priceTier === 'mid') return '$$';
  if (priceTier === 'premium') return '$$$';
  return '';
}

/**
 * For the rotating pill text: "↑ {title} · {time}"
 */
export function pillRotationText(evt: LineupEvent, now: Date = new Date()): string {
  return `↑ ${evt.title} · ${relativeTime(evt.start_time, now)}`;
}
