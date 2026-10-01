-- ═══════════════════════════════════════════════════════════════
-- 00006_prediction_engine_schema.sql
-- venuu prediction engine foundation
-- All columns verified against production schema (May 9, 2026).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ───────────────────────────────────────────────────────────────
-- signal_weights
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signal_weights (
  signal_type text PRIMARY KEY,
  weight numeric NOT NULL DEFAULT 1.0,
  ttl_seconds integer NOT NULL DEFAULT 3600,
  description text,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.signal_weights (signal_type, weight, ttl_seconds, description) VALUES
  ('nfc_tap',              1.00, 5400,  'User tapped a venuu NFC pod inside the venue.'),
  ('cover_purchase',       0.95, 5400,  'User paid for cover via Stripe.'),
  ('loyalty_visit',        0.90, 5400,  'Verified loyalty check-in.'),
  ('event_purchase',       0.85, 7200,  'User bought an event ticket via venuu (future).'),
  ('loyalty_redemption',   1.00, 3600,  'User redeemed a reward inside the venue.'),
  ('drink_order',          1.00, 3600,  'User ordered a drink through venuu (future).'),
  ('app_open_in_geofence', 0.40, 1800,  'App opened while inside venue geofence.'),
  ('background_presence',  0.55, 2700,  'Background location reported user inside geofence.'),
  ('direction_request',    0.20, 3600,  'User requested directions to this venue.'),
  ('card_view',            0.05, 1200,  'User opened venue card in-app.'),
  ('recap_post',           0.30, 14400, 'User posted a recap.'),
  ('bouncer_headcount',    1.00, 900,   'Bouncer-clicked snapshot — ground truth for 15 min.'),
  ('manager_override',     1.00, 3600,  'Manager-set explicit count or capacity flag.')
ON CONFLICT (signal_type) DO NOTHING;

ALTER TABLE public.signal_weights ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='signal_weights' AND policyname='signal_weights_read_all') THEN
    CREATE POLICY "signal_weights_read_all" ON public.signal_weights FOR SELECT USING (true);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- headcount_signals
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.headcount_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  signal_type text NOT NULL REFERENCES public.signal_weights(signal_type),
  signal_value numeric DEFAULT 1.0,
  confidence numeric NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  source_table text,
  source_row_id uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_headcount_signals_venue_active
  ON public.headcount_signals (venue_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_headcount_signals_venue_recorded
  ON public.headcount_signals (venue_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_headcount_signals_user_venue
  ON public.headcount_signals (user_id, venue_id, recorded_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_headcount_signals_dedup
  ON public.headcount_signals (source_table, source_row_id)
  WHERE source_table IS NOT NULL AND source_row_id IS NOT NULL;

ALTER TABLE public.headcount_signals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='headcount_signals' AND policyname='headcount_signals_no_public_access') THEN
    CREATE POLICY "headcount_signals_no_public_access"
      ON public.headcount_signals FOR SELECT USING (false);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- venue_baselines
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_baselines (
  venue_id uuid PRIMARY KEY REFERENCES public.venues(id) ON DELETE CASCADE,
  popular_times_curve jsonb,
  learned_curve jsonb,
  last_google_pull_at timestamptz,
  last_learned_update_at timestamptz,
  data_quality text DEFAULT 'cold' CHECK (data_quality IN ('cold', 'priors_only', 'warm', 'mature')),
  notes text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.venue_baselines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='venue_baselines' AND policyname='venue_baselines_read_all') THEN
    CREATE POLICY "venue_baselines_read_all" ON public.venue_baselines FOR SELECT USING (true);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- headcount_estimates
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.headcount_estimates (
  venue_id uuid PRIMARY KEY REFERENCES public.venues(id) ON DELETE CASCADE,
  estimate integer NOT NULL DEFAULT 0,
  estimate_low integer NOT NULL DEFAULT 0,
  estimate_high integer NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  capacity_pct numeric,
  state_label text NOT NULL DEFAULT 'quiet',
  trend text NOT NULL DEFAULT 'flat' CHECK (trend IN ('rising', 'falling', 'flat', 'surging')),
  baseline_component integer DEFAULT 0,
  signal_component integer DEFAULT 0,
  override_active boolean DEFAULT false,
  override_expires_at timestamptz,
  dominant_signal_source text,
  active_signal_count integer DEFAULT 0,
  last_calculated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_headcount_estimates_calc_time
  ON public.headcount_estimates (last_calculated_at DESC);

ALTER TABLE public.headcount_estimates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='headcount_estimates' AND policyname='headcount_estimates_read_all') THEN
    CREATE POLICY "headcount_estimates_read_all" ON public.headcount_estimates FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='headcount_estimates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.headcount_estimates;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- BACKFILL — verified columns
-- ───────────────────────────────────────────────────────────────

INSERT INTO public.headcount_signals (
  venue_id, user_id, signal_type, signal_value, confidence,
  recorded_at, expires_at, source_table, source_row_id
)
SELECT
  lv.venue_id, lv.user_id, 'loyalty_visit', 1.0, 0.90,
  lv.verified_at, lv.verified_at + interval '90 minutes',
  'loyalty_visits', lv.id
FROM public.loyalty_visits lv
WHERE lv.venue_id IS NOT NULL AND lv.verified_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.headcount_signals s
    WHERE s.source_table = 'loyalty_visits' AND s.source_row_id = lv.id
  );

INSERT INTO public.headcount_signals (
  venue_id, user_id, signal_type, signal_value, confidence,
  recorded_at, expires_at, source_table, source_row_id
)
SELECT
  cp.venue_id, cp.user_id, 'cover_purchase', 1.0, 0.95,
  cp.purchased_at, cp.purchased_at + interval '90 minutes',
  'cover_purchases', cp.id
FROM public.cover_purchases cp
WHERE cp.venue_id IS NOT NULL AND cp.purchased_at IS NOT NULL
  AND cp.status IN ('completed', 'paid', 'succeeded', 'redeemed', 'used')
  AND NOT EXISTS (
    SELECT 1 FROM public.headcount_signals s
    WHERE s.source_table = 'cover_purchases' AND s.source_row_id = cp.id
  );

INSERT INTO public.headcount_signals (
  venue_id, user_id, signal_type, signal_value, confidence,
  recorded_at, expires_at, source_table, source_row_id
)
SELECT
  nt.venue_id, nt.user_id, 'nfc_tap', 1.0, 1.00,
  nt.tapped_at, nt.tapped_at + interval '90 minutes',
  'nfc_taps', nt.id
FROM public.nfc_taps nt
WHERE nt.venue_id IS NOT NULL AND nt.tapped_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.headcount_signals s
    WHERE s.source_table = 'nfc_taps' AND s.source_row_id = nt.id
  );

INSERT INTO public.headcount_signals (
  venue_id, user_id, signal_type, signal_value, confidence,
  recorded_at, expires_at, source_table, source_row_id, metadata
)
SELECT
  vr.venue_id, NULL, 'recap_post', 1.0, 0.30,
  vr.created_at, vr.created_at + interval '4 hours',
  'venue_recaps', vr.id,
  jsonb_build_object('username', vr.username, 'stars', vr.stars)
FROM public.venue_recaps vr
WHERE vr.venue_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.headcount_signals s
    WHERE s.source_table = 'venue_recaps' AND s.source_row_id = vr.id
  );

INSERT INTO public.headcount_signals (
  venue_id, user_id, signal_type, signal_value, confidence,
  recorded_at, expires_at, source_table, source_row_id
)
SELECT
  lr.venue_id, lr.user_id, 'loyalty_redemption', 1.0, 1.00,
  lr.redeemed_at, lr.redeemed_at + interval '60 minutes',
  'loyalty_redemptions', lr.id
FROM public.loyalty_redemptions lr
WHERE lr.venue_id IS NOT NULL AND lr.redeemed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.headcount_signals s
    WHERE s.source_table = 'loyalty_redemptions' AND s.source_row_id = lr.id
  );

INSERT INTO public.headcount_signals (
  venue_id, user_id, signal_type, signal_value, confidence,
  recorded_at, expires_at, source_table, source_row_id, metadata
)
SELECT
  h.venue_id, NULL, 'bouncer_headcount', h.peak_count, 1.00,
  h.updated_at, h.updated_at + interval '15 minutes',
  'headcounts', h.id,
  jsonb_build_object(
    'peak_count', h.peak_count,
    'current_count', h.current_count,
    'night_of', h.night_of
  )
FROM public.headcounts h
WHERE h.venue_id IS NOT NULL AND h.peak_count > 0 AND h.updated_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.headcount_signals s
    WHERE s.source_table = 'headcounts' AND s.source_row_id = h.id
  );

-- ───────────────────────────────────────────────────────────────
-- seed venue_baselines
-- ───────────────────────────────────────────────────────────────
INSERT INTO public.venue_baselines (venue_id)
SELECT id FROM public.venues
ON CONFLICT (venue_id) DO NOTHING;
