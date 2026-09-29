/**
 * Social tab theming.
 *
 * One flag picks the theme: VITE_SOCIAL_THEME (build-time, defaults off).
 *   - unset / anything else → VENUU_THEME: neutral, category tabs, no brand names
 *   - 'suncruiser'          → SUNCRUISER_THEME: partner tabs + "Presented by"
 *
 * Never ship brand theming to the App Store without a signed deal — keep
 * the flag in .env.local only.
 *
 * Applied ONLY as CSS variables on the Social root element (see
 * socialThemeVars), never on :root, so nothing bleeds into Tonight.
 * Later: load partners/presentedBy from the `brands` table and fall back
 * to these static configs.
 */

import type { CityKey } from './constants';
import type { SocialCategory, SocialEvent } from './socialTypes';

export interface SocialPartner {
  key: string;
  label: string;
  /** Hex — used by Mapbox paint expressions, so no CSS vars here. */
  color: string;
  /** Resolved asset URL when a file exists in src/assets/social/, else null → text wordmark. */
  logo: string | null;
  about: string;
  schedule: string | null;
  instagram: string | null;
  /** Cities where this partner's tab is shown. */
  cities: CityKey[];
  /** Which events belong to this partner. */
  match: { brand?: string; category?: SocialCategory };
}

export interface SocialTheme {
  id: 'venuu' | 'suncruiser';
  presentedBy: { name: string; logo: string | null } | null;
  partners: SocialPartner[];
  /** CSS color values (may be var(...)) — header, box border, city button glow. */
  cityAccents: Record<CityKey, string>;
  /** Hex per category — card color bar + map pins. */
  categoryColors: Record<SocialCategory, string>;
  globe: { space: string; fog: string; highColor: string };
}

// ── Logos ─────────────────────────────────────────────────────────
// Drop official files into src/assets/social/<key>.(svg|png|webp).
// Missing file → the brand name renders as a text wordmark. Never
// draw or recreate a logo.
const LOGO_FILES = import.meta.glob('../assets/social/*.{svg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function logoFor(key: string): string | null {
  const hit = Object.entries(LOGO_FILES).find(([path]) =>
    path.replace(/^.*\//, '').replace(/\.[^.]+$/, '') === key,
  );
  return hit ? hit[1] : null;
}

// ── Colors ────────────────────────────────────────────────────────
// TODO(brand): replace with official hex from Sun Cruiser's brand guide.
export const SUNCRUISER_BLUE_TODO = '#2F7FE0';

const RUN_GREEN = '#2FBF71';
const POPUP_BLUE = '#3B82F6';
const NIGHT_RED = '#E5484D';

// City accents never use green, blue or red (those are partner signal).
const CITY_ACCENTS: Record<CityKey, string> = {
  knoxville: 'var(--brand-orange)',
  tampa: '#FFD24A',
  st_petersburg: '#9B5EFF',
};

const GLOBE = {
  space: '#050507',
  fog: 'rgba(40, 40, 52, 0.55)',
  highColor: 'rgba(28, 28, 46, 0.9)',
};

const ALL_CITIES: CityKey[] = ['knoxville', 'tampa', 'st_petersburg'];

// ── Themes ────────────────────────────────────────────────────────
export const VENUU_THEME: SocialTheme = {
  id: 'venuu',
  presentedBy: null,
  partners: [
    {
      key: 'run_club', label: 'Run Clubs', color: RUN_GREEN, logo: null,
      about: 'Group runs open to anyone.', schedule: null, instagram: null,
      cities: ALL_CITIES, match: { category: 'run_club' },
    },
    {
      key: 'pop_up', label: 'Pop-Ups', color: POPUP_BLUE, logo: null,
      about: 'Short-run brand and maker pop-ups.', schedule: null, instagram: null,
      cities: ALL_CITIES, match: { category: 'pop_up' },
    },
    {
      key: 'nightlife', label: 'Nightlife', color: NIGHT_RED, logo: null,
      about: 'Late-night events picked by Venuu.', schedule: null, instagram: null,
      cities: ALL_CITIES, match: { category: 'nightlife' },
    },
  ],
  cityAccents: CITY_ACCENTS,
  categoryColors: { run_club: RUN_GREEN, pop_up: POPUP_BLUE, nightlife: NIGHT_RED },
  globe: GLOBE,
};

export const SUNCRUISER_THEME: SocialTheme = {
  id: 'suncruiser',
  presentedBy: { name: 'Sun Cruiser', logo: logoFor('suncruiser') },
  partners: [
    {
      key: 'pinellas_run_club', label: 'Pinellas Run Club', color: RUN_GREEN,
      logo: logoFor('pinellas_run_club'),
      about: 'Weekly community run in St. Pete.',
      schedule: 'Thursdays 6:30 PM', // TODO(schedule): confirm real day/time with the club
      instagram: null,               // TODO(instagram): confirm handle
      cities: ['st_petersburg'], match: { brand: 'pinellas_run_club' },
    },
    {
      key: 'suncruiser', label: 'Sun Cruiser', color: SUNCRUISER_BLUE_TODO,
      logo: logoFor('suncruiser'),
      about: 'Pop-ups with Venuu across Tampa Bay.',
      schedule: null,
      instagram: null,               // TODO(instagram): confirm handle
      cities: ALL_CITIES, match: { brand: 'suncruiser' },
    },
    {
      key: 'nightlife', label: 'Nightlife', color: NIGHT_RED, logo: null,
      about: 'Late-night events picked by Venuu.', schedule: null, instagram: null,
      cities: ALL_CITIES, match: { category: 'nightlife' },
    },
  ],
  cityAccents: CITY_ACCENTS,
  categoryColors: { run_club: RUN_GREEN, pop_up: SUNCRUISER_BLUE_TODO, nightlife: NIGHT_RED },
  globe: GLOBE,
};

export const SOCIAL_THEME: SocialTheme =
  import.meta.env.VITE_SOCIAL_THEME === 'suncruiser' ? SUNCRUISER_THEME : VENUU_THEME;

// ── Helpers ───────────────────────────────────────────────────────

/** Social's own city labels — st_petersburg reads as Pinellas here. */
export const SOCIAL_CITY_LABEL: Record<CityKey, string> = {
  knoxville: 'Knoxville',
  tampa: 'Tampa',
  st_petersburg: 'Pinellas',
};

export function partnersForCity(theme: SocialTheme, city: CityKey): SocialPartner[] {
  return theme.partners.filter(p => p.cities.includes(city));
}

export function partnerMatches(partner: SocialPartner, ev: SocialEvent): boolean {
  if (partner.match.brand) return ev.brand === partner.match.brand;
  if (partner.match.category) return ev.category === partner.match.category;
  return false;
}

/** The themed partner whose brand this event carries — for the card lockup.
 *  Null under the neutral theme, so no brand name ever shows with the flag off. */
export function brandPartnerFor(theme: SocialTheme, ev: SocialEvent): SocialPartner | null {
  if (!ev.brand) return null;
  return theme.partners.find(p => p.match.brand === ev.brand) ?? null;
}

/** CSS variables scoped to the Social root element. */
export function socialThemeVars(theme: SocialTheme, city: CityKey | null): Record<string, string> {
  const vars: Record<string, string> = {
    '--social-accent-knoxville': theme.cityAccents.knoxville,
    '--social-accent-tampa': theme.cityAccents.tampa,
    '--social-accent-st_petersburg': theme.cityAccents.st_petersburg,
    '--social-run': theme.categoryColors.run_club,
    '--social-popup': theme.categoryColors.pop_up,
    '--social-night': theme.categoryColors.nightlife,
  };
  if (city) vars['--social-accent'] = theme.cityAccents[city];
  return vars;
}
