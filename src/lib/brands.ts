/**
 * Partner brands — one `public.brands` row per partner (00077 + 00080).
 * Everything a Partner World shows comes from its row, so a new partner
 * is a new row, not an app change.
 *
 * Demo builds (VITE_SOCIAL_THEME=suncruiser) read DEMO_BRANDS below —
 * the same rows 00077/00080 seed, with image URLs pointing at the
 * flag-gated local brand files instead of the brand-assets bucket.
 */

import type { CityKey } from './constants';
import type { SocialEvent } from './socialTypes';

export interface BrandProduct {
  name: string;
  image_url: string | null;
}

export interface Brand {
  id: string;
  slug: string;
  name: string;
  primary_hex: string | null;
  secondary_hex: string | null;
  accent_hexes: string[];
  logo_url: string | null;
  product_image_url: string | null;
  tagline: string | null;
  about: string | null;
  website_url: string | null;
  instagram_url: string | null;
  finder_url: string | null;
  email: string | null;
  cities: CityKey[];
  age_gate: boolean;
  is_active: boolean;
  products: BrandProduct[];
}

/** The brand whose sun rises behind the Social globe (docs/social-tab-spec.md §1). */
export const SUN_BRAND_SLUG = 'sun_cruiser';

const FALLBACK_COLOR = '#EDE6D6';

export function brandColor(b: Brand): string {
  return b.primary_hex ?? FALLBACK_COLOR;
}

export function brandEvents(b: Brand, events: SocialEvent[]): SocialEvent[] {
  return events.filter(e => e.brand === b.slug);
}

/** Normalize a row from PostgREST (jsonb/array columns may be null on old rows). */
export function toBrand(row: Record<string, unknown>): Brand {
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    ...(row as unknown as Brand),
    accent_hexes: arr<string>(row.accent_hexes),
    cities: arr<CityKey>(row.cities),
    products: arr<BrandProduct>(row.products).filter(p => p && typeof p.name === 'string'),
  };
}

// ── Demo rows ─────────────────────────────────────────────────────
// Mirrors the 00077 seed + 00080 products. Local brand files resolve
// only in the flag-gated demo build (see vite.config.ts alias).
const DEMO = import.meta.env.VITE_SOCIAL_THEME === 'suncruiser';
const DEMO_FILES = import.meta.glob('@social-brand-assets/**/*.{svg,png,webp,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const demoFile = (rel: string): string | null =>
  Object.entries(DEMO_FILES).find(([k]) => k.endsWith(`/${rel}`))?.[1] ?? null;

export const DEMO_BRANDS: Brand[] = DEMO ? [
  {
    id: 'demo-brand-sun-cruiser', slug: 'sun_cruiser', name: 'Sun Cruiser',
    primary_hex: '#00A0AF', secondary_hex: '#5FD0DF', accent_hexes: ['#FFDD00', '#FDB913'],
    logo_url: demoFile('suncruiser/logo.svg'), product_image_url: null,
    tagline: null, about: 'Pop-ups with Venuu across Tampa Bay and Knoxville.',
    website_url: 'https://www.drinksuncruiser.com', instagram_url: 'https://www.instagram.com/drinksuncruiser',
    finder_url: 'https://www.drinksuncruiser.com/find', email: null,
    cities: ['tampa', 'st_petersburg', 'knoxville'], age_gate: true, is_active: true,
    products: [
      { name: 'Classic Iced Tea', image_url: demoFile('suncruiser/can-classic-iced-tea.webp') },
      { name: 'Classic Lemonade', image_url: demoFile('suncruiser/can-classic-lemonade.webp') },
      { name: 'Half & Half', image_url: demoFile('suncruiser/can-half-and-half.webp') },
    ],
  },
  {
    id: 'demo-brand-prc', slug: 'pinellas_run_club', name: 'Pinellas Run Club',
    primary_hex: '#2FBF71', secondary_hex: null, accent_hexes: [],
    logo_url: demoFile('pinellas_run_club/logo.svg') ?? demoFile('pinellas_run_club/logo.png'), product_image_url: null,
    tagline: 'The space for your pace.', about: 'Thursday evenings · Saturday mornings',
    website_url: 'https://www.pinellasrunclub.com', instagram_url: 'https://www.instagram.com/pinellasrunclub',
    finder_url: null, email: 'pinellasrunclub@gmail.com',
    cities: ['st_petersburg'], age_gate: false, is_active: true,
    products: [],
  },
] : [];

export const BRANDS_FROM_DEMO = DEMO;
