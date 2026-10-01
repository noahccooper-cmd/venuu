/**
 * Social tab theming.
 *
 * One flag picks the theme: VITE_SOCIAL_THEME (build-time, defaults off).
 *   - unset / anything else → VENUU_THEME: neutral, category tabs, no brand names
 *   - 'suncruiser'          → SUNCRUISER_THEME: partner tabs, the sun, "Presented by"
 *
 * Brand assets are for a private, flag-gated demo build only. Never ship
 * brand theming to the App Store without a signed deal — keep the flag in
 * .env.local only.
 *
 * Applied ONLY as CSS variables on the Social root element (see
 * socialThemeVars), never on :root, so nothing bleeds into Tonight.
 * Later: load partners/presentedBy from the `brands` table and fall back
 * to these static configs.
 */

import type { CityKey } from './constants';
import type { SocialCategory, SocialEvent } from './socialTypes';
import { SUN_BRAND_SLUG, type Brand } from './brands';
import { SOCIAL_CITY_GEO } from './socialGeo';

export interface SocialPartner {
  key: string;
  label: string;
  /** Hex — used by Mapbox paint expressions, so no CSS vars here. */
  color: string;
  /** Brand secondary — the center dot of this partner's map pins. */
  secondary?: string;
  /** Official logo file URL, or null → text wordmark. */
  logo: string | null;
  about: string;
  schedule: string | null;
  links: {
    website?: string;
    /** Full profile URL; null/absent hides the link. */
    instagram?: string | null;
    finder?: { url: string; label: string };
  };
  /** Shown on the About card, e.g. "21+ · Please drink responsibly". */
  disclaimer?: string;
  /** Replaces the place line when locations aren't fixed, and hides Directions. */
  locationNote?: string;
  /** "Fueled by <partner>" — a partner key; shown only if that partner's
   *  logo file exists in src/assets/social/. */
  fueledBy?: { key: string; name: string };
  /** Partner photos (event detail / partner page hero). */
  photos?: string[];
  /** Where this partner's medallion is pinned on the globe (e.g. a run
   *  club's meeting area). Partners without one don't appear on the globe. */
  home?: [number, number];
  /** Tapping this partner's medallion opens its own page (e.g. a run
   *  club) instead of filtering the city list. */
  hasPage?: boolean;
  /** Which events belong to this partner. */
  match: { brand?: string; category?: SocialCategory };
}

export interface SocialTheme {
  id: 'venuu' | 'suncruiser';
  presentedBy: { name: string; logo: string | null; partnerKey: string } | null;
  partners: SocialPartner[];
  /** CSS color values (may be var(...)) — header, box border, city label glow. */
  cityAccents: Record<CityKey, string>;
  /** Hex per category — card accent line + map pins for unbranded events. */
  categoryColors: Record<SocialCategory, string>;
  globe: { space: string; fog: string; highColor: string };
  /** The sun behind the globe (presenting partner only). Null → neutral space. */
  sun: { core: string; mid: string; corona: string } | null;
}

// ── Assets ────────────────────────────────────────────────────────
// Official files live in src/assets/social/ — either <key>.<ext> or
// <key>/logo.<ext>. Missing file → the brand name renders as a text
// wordmark. Never draw or recreate a logo.
// The @social-brand-assets alias (vite.config.ts) resolves to the real
// folder only when VITE_SOCIAL_THEME=suncruiser, so a flag-off build
// contains no brand files at all.
const BRAND_THEME = import.meta.env.VITE_SOCIAL_THEME === 'suncruiser';
const ASSET_FILES = import.meta.glob('@social-brand-assets/**/*.{svg,png,webp,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function asset(relPath: string): string | null {
  const hit = Object.entries(ASSET_FILES).find(([key]) => key.endsWith(`/${relPath}`));
  return hit ? hit[1] : null;
}

function logoFor(key: string): string | null {
  for (const ext of ['svg', 'png', 'webp']) {
    const hit = asset(`${key}/logo.${ext}`) ?? asset(`${key}.${ext}`);
    if (hit) return hit;
  }
  return null;
}

/** A partner logo file exists for this key (e.g. the "Fueled by" slot). */
export function hasPartnerLogo(key: string): boolean {
  return logoFor(key) !== null;
}
export function partnerLogo(key: string): string | null {
  return logoFor(key);
}

// ── Colors ────────────────────────────────────────────────────────
// Sun Cruiser — sampled from their official logo.svg
// (drinksuncruiser.com/wp-content/uploads/2024/02/logo.svg, <style> block):
//   .st0 #00A0AF  teal        → primary (their only blue; 8 paths)
//   .st5 #5FD0DF  light teal  → secondary
//   .st3 #FFDD00  sun yellow  → sun core (16 paths)
//   .st4 #FDB913  sun gold    → sun corona (14 paths)
export const SUNCRUISER_TEAL = '#00A0AF';
export const SUNCRUISER_SKY = '#5FD0DF';
export const SUNCRUISER_SUN_YELLOW = '#FFDD00';
export const SUNCRUISER_SUN_GOLD = '#FDB913';

// Blue/teal belongs to Sun Cruiser alone. Green = run club / fitness /
// community, red = nightlife, warm ivory = unbranded pop-ups.
const RUN_GREEN = '#2FBF71';
const POPUP_IVORY = '#EDE6D6';
const NIGHT_RED = '#E5484D';
const COMMUNITY_GRAY = '#9A9AA2';

// City accents never use green, blue or red (those are partner signal).
const CITY_ACCENTS: Record<CityKey, string> = {
  knoxville: 'var(--brand-orange)',
  tampa: '#FFD24A',
  st_petersburg: '#9B5EFF',
};

const NEUTRAL_GLOBE = {
  space: '#050507',
  fog: 'rgba(40, 40, 52, 0.55)',
  highColor: 'rgba(28, 28, 46, 0.9)',
};

// Presenting-partner globe: transparent space so the DOM sun behind the
// canvas shows through. Neutral atmosphere — no glow ring around the whole
// limb; the light comes only from the offset sunrise.
const SUN_GLOBE = {
  space: 'rgba(0, 0, 0, 0)',
  fog: 'rgba(40, 40, 52, 0.55)',
  highColor: 'rgba(0, 0, 0, 0)',
};

// ── Themes ────────────────────────────────────────────────────────
export const VENUU_THEME: SocialTheme = {
  id: 'venuu',
  presentedBy: null,
  partners: [
    {
      key: 'run_club', label: 'Run Clubs', color: RUN_GREEN, logo: null,
      about: 'Group runs open to anyone.', schedule: null, links: {},
      match: { category: 'run_club' },
    },
    {
      key: 'pop_up', label: 'Pop-Ups', color: POPUP_IVORY, logo: null,
      about: 'Short-run brand and maker pop-ups.', schedule: null, links: {},
      match: { category: 'pop_up' },
    },
    {
      key: 'nightlife', label: 'Nightlife', color: NIGHT_RED, logo: null,
      about: 'Late-night events picked by Venuu.', schedule: null, links: {},
      match: { category: 'nightlife' },
    },
  ],
  cityAccents: CITY_ACCENTS,
  categoryColors: { run_club: RUN_GREEN, pop_up: POPUP_IVORY, nightlife: NIGHT_RED, other: COMMUNITY_GRAY },
  globe: NEUTRAL_GLOBE,
  sun: null,
};

export const SUNCRUISER_THEME: SocialTheme = {
  id: 'suncruiser',
  presentedBy: { name: 'Sun Cruiser', logo: logoFor('suncruiser'), partnerKey: 'sun_cruiser' },
  partners: [
    {
      key: 'pinellas_run_club', label: 'Pinellas Run Club', color: RUN_GREEN,
      logo: logoFor('pinellas_run_club'),
      about: 'Community runs in St. Pete, twice a week.',
      schedule: 'Thursdays 6:30 PM · Saturdays 7:00 AM',
      links: {
        instagram: null,             // TODO(instagram): set the club's profile URL — link stays hidden until then
      },
      locationNote: 'Location posted on Instagram',
      fueledBy: { key: 'oasis', name: 'Oasis' },
      hasPage: true,   // renders once src/assets/social/oasis/logo.* exists
      home: [-82.6268, 27.7812],     // TODO(location): approximate downtown St. Pete area for the globe medallion
      match: { brand: 'pinellas_run_club' },
    },
    {
      key: 'sun_cruiser', label: 'Sun Cruiser', color: SUNCRUISER_TEAL, secondary: SUNCRUISER_SKY,
      logo: logoFor('suncruiser'),
      about: 'Pop-ups with Venuu across Tampa Bay and Knoxville.',
      schedule: null,
      links: {
        website: 'https://www.drinksuncruiser.com',
        instagram: 'https://www.instagram.com/drinksuncruiser',
        finder: { url: 'https://www.drinksuncruiser.com/find', label: 'Find Sun Cruiser near you' },
      },
      hasPage: true,   // → Sun Cruiser World
      disclaimer: '21+ · Please drink responsibly',
      match: { brand: 'sun_cruiser' },
    },
    {
      key: 'nightlife', label: 'Nightlife', color: NIGHT_RED, logo: null,
      about: 'Late-night events picked by Venuu.', schedule: null, links: {},
      match: { category: 'nightlife' },
    },
  ],
  cityAccents: CITY_ACCENTS,
  categoryColors: { run_club: RUN_GREEN, pop_up: POPUP_IVORY, nightlife: NIGHT_RED, other: COMMUNITY_GRAY },
  globe: SUN_GLOBE,
  sun: { core: SUNCRUISER_SUN_YELLOW, mid: SUNCRUISER_SUN_GOLD, corona: 'rgba(253, 185, 19, 0.28)' },
};

export const SOCIAL_THEME: SocialTheme = BRAND_THEME ? SUNCRUISER_THEME : VENUU_THEME;

// ── Helpers ───────────────────────────────────────────────────────

/** Social's own city labels. st_petersburg's city screen still frames all
 *  of Pinellas county (see socialGeo). */
export const SOCIAL_CITY_LABEL: Record<CityKey, string> = {
  knoxville: 'Knoxville',
  tampa: 'Tampa',
  st_petersburg: 'St. Pete',
};

/** Partners with ≥1 upcoming event in the given set (a city's events,
 *  or every city's for the world screen). No events → no tile. */
export function partnersWithEvents(theme: SocialTheme, events: SocialEvent[]): SocialPartner[] {
  return theme.partners.filter(p => events.some(ev => partnerMatches(p, ev)));
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

/** An event's signal color: its themed brand's color when branded
 *  (so teal only ever means Sun Cruiser), else its category color. */
export function eventColor(theme: SocialTheme, ev: SocialEvent): string {
  return brandPartnerFor(theme, ev)?.color ?? theme.categoryColors[ev.category];
}

/** CSS variables scoped to the Social root element. */
export function socialThemeVars(theme: SocialTheme, city: CityKey | null): Record<string, string> {
  const vars: Record<string, string> = {
    '--social-accent-knoxville': theme.cityAccents.knoxville,
    '--social-accent-tampa': theme.cityAccents.tampa,
    '--social-accent-st_petersburg': theme.cityAccents.st_petersburg,
    // Near-black with a slight warm tint; hairlines are white at ~10%.
    '--social-bg': '#0B0A09',
    '--social-surface': '#141210',
    '--social-surface-raised': '#1B1815',
    '--social-hairline': 'rgba(255, 255, 255, 0.10)',
    '--social-run': theme.categoryColors.run_club,
    '--social-popup': theme.categoryColors.pop_up,
    '--social-night': theme.categoryColors.nightlife,
  };
  if (city) vars['--social-accent'] = theme.cityAccents[city];
  return vars;
}

/**
 * The live theme: partners, the globe sun and the presenter all come from
 * the active brand rows. The sun appears only while the sun_cruiser row is
 * active (and has its two accent colors); otherwise the globe is neutral.
 * Venuu's own category partners (Run Clubs, Pop-Ups, Nightlife) stay.
 */
export function themeFromBrands(base: SocialTheme, brands: Brand[]): SocialTheme {
  const sunRow = brands.find(b => b.slug === SUN_BRAND_SLUG && b.accent_hexes.length >= 2) ?? null;
  const brandPartners: SocialPartner[] = brands.map(b => ({
    key: b.slug,
    label: b.name,
    color: b.primary_hex ?? POPUP_IVORY,
    secondary: b.secondary_hex ?? undefined,
    logo: b.logo_url,
    about: b.about ?? '',
    schedule: null,
    links: {
      website: b.website_url ?? undefined,
      instagram: b.instagram_url,
      finder: b.finder_url ? { url: b.finder_url, label: `Find ${b.name} near you` } : undefined,
    },
    disclaimer: b.age_gate ? '21+ · Please drink responsibly' : undefined,
    // Single-city partners get a medallion on the globe; multi-city ones
    // (the sun's partner) are reached through the sun and their ring.
    home: b.cities.length === 1 ? SOCIAL_CITY_GEO[b.cities[0]].center : undefined,
    hasPage: true,
    match: { brand: b.slug },
  }));
  const categoryPartners = base.partners.filter(p => !p.match.brand && p.match.category);
  return {
    ...base,
    partners: [...brandPartners, ...categoryPartners],
    presentedBy: sunRow ? { name: sunRow.name, logo: sunRow.logo_url, partnerKey: sunRow.slug } : null,
    globe: sunRow ? SUN_GLOBE : NEUTRAL_GLOBE,
    sun: sunRow ? { core: sunRow.accent_hexes[0], mid: sunRow.accent_hexes[1], corona: `${sunRow.accent_hexes[1]}47` } : null,
  };
}
