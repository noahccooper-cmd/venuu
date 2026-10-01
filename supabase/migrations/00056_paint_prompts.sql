-- =====================================================================
-- 00056_paint_prompts.sql — Phase D: Rate-on-Exit infrastructure
--
-- Adds:
--   1. paint_prompts table to track push-prompt lifecycle
--      (queued / pushed / opened / painted / dismissed / expired)
--   2. Realtime publication on vibe_ratings so Phase D.5 canvas
--      can listen for live paint events
--   3. compute_paint_prompt_due() function: given a confirmed
--      user_visits row, decides if a paint prompt should fire
--      (paint doesn't already exist + visit duration >= 20 min)
--   4. expire_stale_paint_prompts() function: marks unfired prompts
--      older than 3 hours as expired (run by cron)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.paint_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_visit_id uuid REFERENCES public.user_visits(id) ON DELETE SET NULL,

  -- visit context (snapshot at prompt-creation time)
  visit_first_seen_at timestamptz NOT NULL,
  visit_last_seen_at timestamptz NOT NULL,
  visit_duration_min integer NOT NULL,

  -- lifecycle
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','pushed','opened','painted','dismissed','expired')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  pushed_at timestamptz,
  opened_at timestamptz,
  painted_at timestamptz,
  dismissed_at timestamptz,
  expired_at timestamptz,

  -- the deferral guard: don't fire until at least this time
  -- (5 min after exit, longer if user re-entered another geofence)
  fire_not_before timestamptz NOT NULL,

  -- result tracking
  vibe_rating_id uuid REFERENCES public.vibe_ratings(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paint_prompts_user_visit
  ON public.paint_prompts (user_id, venue_id, visit_first_seen_at);

CREATE INDEX IF NOT EXISTS idx_paint_prompts_queued
  ON public.paint_prompts (fire_not_before)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_paint_prompts_user_status
  ON public.paint_prompts (user_id, status, created_at DESC);

ALTER TABLE public.paint_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY paint_prompts_owner_select ON public.paint_prompts
  FOR SELECT USING (auth.uid() IN (
    SELECT auth_id FROM public.profiles WHERE id = paint_prompts.user_id
  ));

-- Inserts/updates happen ONLY via service_role (edge functions)
-- No client policies for INSERT/UPDATE/DELETE.

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_paint_prompts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_paint_prompts_touch ON public.paint_prompts;
CREATE TRIGGER trg_paint_prompts_touch
  BEFORE UPDATE ON public.paint_prompts
  FOR EACH ROW EXECUTE FUNCTION public.touch_paint_prompts_updated_at();

-- =====================================================================
-- Realtime publication: vibe_ratings INSERT goes live so the canvas
-- (Phase D.5) and other clients can react to fresh paints.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'vibe_ratings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vibe_ratings;
  END IF;
END $$;

-- Also publish paint_prompts so user can see live status changes on their
-- pending paints (Phase E1 will use this for the "pending paints" tray
-- if we add it later — harmless to publish now)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'paint_prompts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.paint_prompts;
  END IF;
END $$;

-- =====================================================================
-- compute_paint_prompt_due(user_visit_id uuid) → uuid | null
--
-- Given a user_visits row, decides if a paint prompt should be queued.
-- Returns the new paint_prompts.id on success, NULL if not eligible.
--
-- Eligibility:
--   - visit duration >= 20 min
--   - user has not already painted this venue (UNIQUE on vibe_ratings)
--   - no existing paint_prompts row for (user, venue, visit_first_seen)
--
-- Fire-not-before is set to last_seen_at + 5 min (the deferral guard).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.compute_paint_prompt_due(p_user_visit_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_visit public.user_visits%ROWTYPE;
  v_paint_exists boolean;
  v_prompt_id uuid;
  v_duration_min integer;
BEGIN
  SELECT * INTO v_visit FROM public.user_visits WHERE id = p_user_visit_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Duration check: 20+ min
  v_duration_min := COALESCE(
    v_visit.duration_min,
    EXTRACT(EPOCH FROM (v_visit.last_seen_at - v_visit.first_seen_at))::int / 60
  );

  IF v_duration_min < 20 THEN RETURN NULL; END IF;

  -- Already painted? (permanent first paint = no re-prompt)
  SELECT EXISTS (
    SELECT 1 FROM public.vibe_ratings
    WHERE user_id = v_visit.user_id AND venue_id = v_visit.venue_id
  ) INTO v_paint_exists;

  IF v_paint_exists THEN RETURN NULL; END IF;

  -- Insert (or no-op if already queued for this visit)
  INSERT INTO public.paint_prompts (
    user_id, venue_id, user_visit_id,
    visit_first_seen_at, visit_last_seen_at, visit_duration_min,
    fire_not_before
  ) VALUES (
    v_visit.user_id, v_visit.venue_id, v_visit.id,
    v_visit.first_seen_at, v_visit.last_seen_at, v_duration_min,
    v_visit.last_seen_at + interval '5 minutes'
  )
  ON CONFLICT (user_id, venue_id, visit_first_seen_at) DO NOTHING
  RETURNING id INTO v_prompt_id;

  RETURN v_prompt_id;
END $$;

-- =====================================================================
-- expire_stale_paint_prompts() — cron sweep
--
-- Marks queued prompts older than 3 hours as expired (the moment passed).
-- Marks pushed prompts unopened after 24h as expired.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.expire_stale_paint_prompts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_count integer := 0;
BEGIN
  UPDATE public.paint_prompts
  SET status = 'expired', expired_at = now()
  WHERE status = 'queued' AND queued_at < now() - interval '3 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.paint_prompts
  SET status = 'expired', expired_at = now()
  WHERE status = 'pushed' AND pushed_at < now() - interval '24 hours';

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.compute_paint_prompt_due TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_paint_prompts TO service_role;

-- COMMENT ON migration
COMMENT ON TABLE public.paint_prompts IS
  'Phase D rate-on-exit: lifecycle tracking for paint prompts. Service-role writes only.';
