import type { CityKey } from './constants';

export type SocialCategory = 'run_club' | 'pop_up' | 'nightlife';

/**
 * One Social event, shaped like the planned `public.events` row
 * (see the draft migration: surface / category / brand / series_id /
 * address on top of the existing columns). `brand` is the brand slug —
 * with a DB join it comes from `brands(slug)` via events.brand_id.
 */
export interface SocialEvent {
  id: string;
  city: CityKey;
  surface: 'social';
  category: SocialCategory;
  brand: string | null;
  title: string;
  host_name: string;
  /** Place name (existing events.external_venue_name column). */
  external_venue_name: string | null;
  address: string;
  latitude: number;
  longitude: number;
  start_time: string;
  end_time: string | null;
  /** Existing NOT NULL column; queries filter expires_at > now(). */
  expires_at: string;
  series_id: string | null;
}
