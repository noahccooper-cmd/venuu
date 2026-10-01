-- ═══════════════════════════════════════════════════════════════
-- 00076_capture_events_prod_schema.sql
--
-- Captures hand-built prod state from 2026-08-16 snapshot. Not yet applied.
--
-- Source: docs/prod-schema-snapshot.sql. public.events and
-- public.event_rsvps were built by hand in the SQL editor (the only
-- repo DDL was supabase/create-events-table.sql + add-event-tickets.sql,
-- outside migrations/). This file brings them under migration control.
--
-- Written to be a NO-OP on prod: every statement is guarded
-- (IF NOT EXISTS / pg_constraint / pg_policies checks) or re-asserts
-- the identical definition (function body, trigger, grants).
-- It deliberately does NOT change anything — including the
-- permissive emergency_read_events policy. Fixes belong in later
-- migrations.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- public.events
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  venue_id uuid,
  city text NOT NULL,
  title text NOT NULL,
  description text,
  event_type text NOT NULL,
  host_name text NOT NULL,
  start_time timestamptz NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  image_url text,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  expires_at timestamptz NOT NULL,
  end_time timestamptz,
  name text,
  has_tickets boolean DEFAULT false,
  ticket_price integer,
  total_tickets integer,
  tickets_sold integer DEFAULT 0,
  sale_ends_at timestamptz,
  sale_starts_at timestamptz,
  ticket_url text,
  featured_partner text,
  recurring_pattern text,
  vibe_tags text[] DEFAULT '{}'::text[],
  featured_until timestamptz,
  external_venue_name text,
  hero_image_url text,
  going_count integer DEFAULT 0,
  price_tier text,
  curated boolean DEFAULT false,
  marquee boolean DEFAULT false
);

-- Columns added by hand after the original create-events-table.sql.
-- Guarded so an older-shape table converges on the prod shape.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS end_time timestamptz,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS has_tickets boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_price integer,
  ADD COLUMN IF NOT EXISTS total_tickets integer,
  ADD COLUMN IF NOT EXISTS tickets_sold integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS sale_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ticket_url text,
  ADD COLUMN IF NOT EXISTS featured_partner text,
  ADD COLUMN IF NOT EXISTS recurring_pattern text,
  ADD COLUMN IF NOT EXISTS vibe_tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS featured_until timestamptz,
  ADD COLUMN IF NOT EXISTS external_venue_name text,
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS going_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_tier text,
  ADD COLUMN IF NOT EXISTS curated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS marquee boolean DEFAULT false;

COMMENT ON COLUMN public.events.ticket_url IS 'External ticket purchase URL (e.g., LineLeap, Eventbrite). When set, EventCard renders a "Buy Tickets" button that opens this URL.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_pkey'
                 AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_event_type_check'
                 AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_event_type_check CHECK (event_type = ANY (ARRAY[
      'party', 'brand', 'greek', 'launch', 'special',
      'concert', 'cruise', 'fitness', 'tasting', 'community'
    ]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_price_tier_check'
                 AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_price_tier_check CHECK (
      price_tier = ANY (ARRAY['free', 'low', 'mid', 'premium']) OR price_tier IS NULL
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expires_after_start'
                 AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT expires_after_start CHECK (expires_at > start_time);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_venue_id_fkey'
                 AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_venue_id_fkey
      FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS events_city_start_idx ON public.events USING btree (city, start_time) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS events_partner_idx    ON public.events USING btree (featured_partner) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS events_start_time_idx ON public.events USING btree (start_time) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_events_active     ON public.events USING btree (is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_events_city       ON public.events USING btree (city);
CREATE INDEX IF NOT EXISTS idx_events_start_time ON public.events USING btree (start_time);
CREATE INDEX IF NOT EXISTS idx_events_venue      ON public.events USING btree (venue_id);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Current prod policies, verbatim. NOTE: emergency_read_events exposes
-- inactive + expired rows to anon; captured as-is, not endorsed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'Authenticated users can create events') THEN
    CREATE POLICY "Authenticated users can create events" ON public.events
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'Service role can create events') THEN
    CREATE POLICY "Service role can create events" ON public.events
      FOR INSERT TO service_role WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'Service role can update events') THEN
    CREATE POLICY "Service role can update events" ON public.events
      FOR UPDATE TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'emergency_read_events') THEN
    CREATE POLICY "emergency_read_events" ON public.events
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'service_role can delete events') THEN
    CREATE POLICY "service_role can delete events" ON public.events
      FOR DELETE TO service_role USING (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.events TO anon;
GRANT ALL ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;

-- ───────────────────────────────────────────────────────────────
-- public.event_rsvps
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_rsvps (
  user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_rsvps_pkey'
                 AND conrelid = 'public.event_rsvps'::regclass) THEN
    ALTER TABLE public.event_rsvps ADD CONSTRAINT event_rsvps_pkey PRIMARY KEY (user_id, event_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_rsvps_event_id_fkey'
                 AND conrelid = 'public.event_rsvps'::regclass) THEN
    ALTER TABLE public.event_rsvps ADD CONSTRAINT event_rsvps_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
  END IF;

  -- NOTE: FK targets profiles.id while the RLS below checks auth.uid().
  -- These only agree when profiles.id = profiles.auth_id. Captured as-is.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_rsvps_user_id_fkey'
                 AND conrelid = 'public.event_rsvps'::regclass) THEN
    ALTER TABLE public.event_rsvps ADD CONSTRAINT event_rsvps_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_rsvps_event_id_idx ON public.event_rsvps USING btree (event_id);
CREATE INDEX IF NOT EXISTS event_rsvps_user_id_idx  ON public.event_rsvps USING btree (user_id);

ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_rsvps'
                 AND policyname = 'rsvps delete own') THEN
    CREATE POLICY "rsvps delete own" ON public.event_rsvps
      FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_rsvps'
                 AND policyname = 'rsvps insert own') THEN
    CREATE POLICY "rsvps insert own" ON public.event_rsvps
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_rsvps'
                 AND policyname = 'rsvps read all') THEN
    CREATE POLICY "rsvps read all" ON public.event_rsvps
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.event_rsvps TO anon;
GRANT ALL ON TABLE public.event_rsvps TO authenticated;
GRANT ALL ON TABLE public.event_rsvps TO service_role;

-- ───────────────────────────────────────────────────────────────
-- going_count trigger (identical body to prod)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_event_going_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events SET going_count = going_count + 1 WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events SET going_count = GREATEST(0, going_count - 1) WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END; $$;

GRANT ALL ON FUNCTION public.bump_event_going_count() TO anon;
GRANT ALL ON FUNCTION public.bump_event_going_count() TO authenticated;
GRANT ALL ON FUNCTION public.bump_event_going_count() TO service_role;

CREATE OR REPLACE TRIGGER event_rsvps_count_trigger
  AFTER INSERT OR DELETE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.bump_event_going_count();

COMMIT;
