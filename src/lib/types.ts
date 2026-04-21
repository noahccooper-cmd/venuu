export interface Profile {
  id: string;
  created_at: string;
  updated_at: string;
  auth_id: string | null;
  email: string;
  username: string;
  display_name: string | null;
  class_year: number | null;
  city: string;
  avatar_url: string | null;
  total_checkins: number;
  is_active: boolean;
}

export interface Venue {
  id: string;
  created_at: string;
  name: string;
  slug: string;
  city: string;
  category: string;
  address: string | null;
  lat: number;
  lng: number;
  image_url: string | null;
  deals: string | null;
  hours: string | null;
  instagram: string | null;
  vibe: string | null;
  has_live_cam: boolean;
  live_cam_url: string | null;
  cam_coming_soon: boolean;
  is_active: boolean;
  sort_order: number;
  capacity: number | null;
  is_clicker_live: boolean;
  staff_code: string | null;
  phone: string | null;
  website: string | null;
  description: string | null;
  rating: number | null;
  review_count: number | null;
  tonight_special: string | null;
  special_updated_at: string | null;
  cover_charge: string | null;
  featured: boolean;
  featured_label: string | null;
  loyalty_active: boolean;
  nfc_tag_id: string | null;
  nfc_required: boolean;
}

export interface Checkin {
  id: string;
  created_at: string;
  user_id: string;
  venue_id: string;
  night_of: string;
  city: string;
}

export interface ChatMessage {
  id: string;
  created_at: string;
  user_id: string;
  username: string;
  city: string;
  body: string;
  night_of: string;
}

export interface VenueCount {
  venue_id: string;
  count: number;
}

export interface CheckinHistory extends Checkin {
  venues: { name: string } | null;
}

export interface Headcount {
  id: string;
  created_at: string;
  updated_at: string;
  venue_id: string;
  city: string;
  night_of: string;
  current_count: number;
  peak_count: number;
  last_updated_by: string | null;
  is_live: boolean;
}

export interface VenueStaff {
  id: string;
  created_at: string;
  venue_id: string;
  user_id: string;
  role: string;
  pin_code: string | null;
  is_active: boolean;
}

export interface VenueComment {
  id: string;
  created_at: string;
  venue_id: string;
  user_id: string | null;
  username: string;
  body: string;
  day_of: string;
}

export interface VenueRecap {
  id: string;
  created_at: string;
  venue_id: string;
  username: string;
  body: string;
  stars: number;
  day_of: string;
}

export interface ClickerLog {
  id: string;
  created_at: string;
  venue_id: string;
  staff_id: string | null;
  action: 'enter' | 'exit';
  night_of: string;
  count_after: number;
}

export interface VenueEvent {
  id: string;
  venue_id: string | null;
  city: string;
  title: string;
  description: string | null;
  event_type: 'party' | 'brand' | 'greek' | 'launch' | 'special';
  host_name: string;
  start_time: string;
  end_time: string | null;
  latitude: number;
  longitude: number;
  image_url: string | null;
  created_by: string;
  created_at: string;
  is_active: boolean;
  expires_at: string;
  // Ticket fields
  has_tickets: boolean;
  ticket_price: number | null;    // cents
  total_tickets: number | null;
  tickets_sold: number;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
}

export type EventTicketStatus = 'completed' | 'used' | 'refunded';

export interface EventTicket {
  id: string;
  event_id: string;
  venue_id: string | null;
  user_id: string;
  price_paid: number;          // cents
  platform_fee: number;        // cents
  stripe_payment_intent_id: string | null;
  qr_code: string;
  status: EventTicketStatus;
  purchased_at: string;
  used_at: string | null;
}

/* ── Dynamic Cover Pricing ── */

export interface CoverConfig {
  id: string;
  venue_id: string;
  night_of: string;
  base_price: number;       // cents
  cap_price: number;        // cents
  capacity: number;
  open_time: string;
  close_time: string;
  current_price: number;    // cents — live price
  covers_sold: number;
  is_active: boolean;
  security_fee_percent: number;
  platform_fee_percent: number;
  created_at: string;
  updated_at: string;
}

export type CoverPurchaseStatus = 'pending' | 'completed' | 'refunded' | 'used';

export interface CoverPurchase {
  id: string;
  cover_config_id: string;
  venue_id: string;
  user_id: string;
  price_paid: number;       // cents
  platform_fee: number;     // cents (8% venuu cut)
  venue_payout: number;     // cents (venue cut after fees)
  security_fee: number;     // cents (security org cut, 0 if no org)
  stripe_payment_intent_id: string;
  stripe_transfer_id: string | null;
  status: CoverPurchaseStatus;
  qr_code: string;
  purchased_at: string;
  used_at: string | null;
}

export interface CoverPriceHistory {
  id: string;
  cover_config_id: string;
  price: number;            // cents
  covers_sold_at_tick: number;
  recorded_at: string;
}

export interface VenueStripeAccount {
  id: string;
  venue_id: string;
  stripe_account_id: string;
  is_verified: boolean;
  created_at: string;
}

/* ── Security Organizations ── */

export interface SecurityOrganization {
  id: string;
  name: string;
  org_code: string;
  city: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  created_at: string;
  is_active: boolean;
}
