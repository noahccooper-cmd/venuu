-- ═══════════════════════════════════════════════════════════════
-- 00031_share_and_public.sql
--
-- Viral profile share infrastructure + the server-side cron promoter
-- for passive presence data (Risk 3 from Session A).
--
--   • profile_share_views — analytics on /u/{token} renders.
--   • public_profile_view — read-only projection of the share-safe
--     fields, gated on the row's own privacy toggles.
--   • find_dangling_enters — RPC the promote-presence edge function
--     uses to discover ENTERs whose users walked off without an
--     EXIT (app killed, GPS lost, etc.).
--   • cron schedule — calls the promote-presence function every
--     5 minutes via the existing pg_cron + pg_net + system_config
--     infrastructure (added in migration 00013).
--
-- Idempotent. Wrapped in BEGIN/COMMIT. Re-running is safe.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- A) Re-assert profile_share_token (00029 owns it; double-cover
--    here in case anyone ever runs this migration on a project
--    where 00029 partial-applied).
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_share_token TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'profiles_share_token_unique'
       AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_share_token_unique UNIQUE (profile_share_token);
  END IF;
END $$;

UPDATE public.profiles
   SET profile_share_token = encode(gen_random_bytes(8), 'hex')
 WHERE profile_share_token IS NULL;

-- ───────────────────────────────────────────────────────────────
-- B) profile_share_views — analytics + rate-limit anchor
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_share_views (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Nullable: an anonymous viewer (no auth session) still gets logged.
  viewer_user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  viewer_ip_hash  text,
  user_agent      text,
  referrer        text,
  viewed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_share_views_profile_viewed
  ON public.profile_share_views (profile_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_share_views_viewer
  ON public.profile_share_views (viewer_user_id)
  WHERE viewer_user_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────
-- C) RLS — owner SELECT + public INSERT (writes never read other rows)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.profile_share_views ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='profile_share_views'
       AND policyname='view_owner_select'
  ) THEN
    CREATE POLICY "view_owner_select"
      ON public.profile_share_views
      FOR SELECT TO authenticated
      USING (
        profile_id IN (
          SELECT id FROM public.profiles WHERE auth_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='profile_share_views'
       AND policyname='public_view_insert'
  ) THEN
    CREATE POLICY "public_view_insert"
      ON public.profile_share_views
      FOR INSERT TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- D) public_profile_view — read-only projection for /u/{token}.
--    Only exposes rows that have opted in to SOME public surface
--    (show_recaps_publicly OR show_visits_publicly). Token itself
--    is the only secret check — if you have the link, you have
--    read access to these fields.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.public_profile_view AS
SELECT
  p.profile_share_token,
  p.username,
  p.display_name,
  p.bio,
  p.tagline,
  p.avatar_color,
  p.city                              AS home_city,
  p.created_at                        AS member_since,
  COALESCE(uas.nights_out, 0)         AS nights_out,
  COALESCE(uas.venues_discovered, 0)  AS venues_discovered,
  COALESCE(uas.total_recaps, 0)       AS total_recaps,
  COALESCE(uas.taste_accuracy_pct, 0) AS taste_accuracy_pct,
  COALESCE(uas.plans_completed, 0)    AS plans_completed
FROM public.profiles p
LEFT JOIN public.user_account_stats uas ON uas.profile_id = p.id
WHERE p.show_recaps_publicly = true
   OR p.show_visits_publicly = true;

-- ───────────────────────────────────────────────────────────────
-- E) find_dangling_enters — discovers presence_event ENTERs that
--    never got a matching EXIT and whose most-recent still_present
--    is older than the staleness threshold. Used by the
--    promote-presence cron edge function to clean up sessions
--    where the app got killed mid-visit.
--
--    night_of computation mirrors the migration 00030 8am-cutoff
--    semantics so visits land on the right calendar row.
--
--    SECURITY DEFINER so the edge function can call it with the
--    service-role JWT regardless of RLS on presence_events.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_dangling_enters(
  p_cutoff    timestamptz,
  p_stalemark timestamptz
)
RETURNS TABLE (
  user_id      uuid,
  venue_id     uuid,
  entered_at   timestamptz,
  last_seen_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH enters AS (
    SELECT pe.user_id, pe.venue_id, MIN(pe.created_at) AS entered_at
      FROM public.presence_events pe
     WHERE pe.event_type = 'enter'
       AND pe.created_at < p_cutoff
       AND pe.created_at > p_cutoff - INTERVAL '12 hours'
     GROUP BY pe.user_id, pe.venue_id
  ),
  last_seens AS (
    SELECT pe.user_id, pe.venue_id, MAX(pe.created_at) AS last_seen_at
      FROM public.presence_events pe
     WHERE pe.created_at > p_cutoff - INTERVAL '12 hours'
       AND pe.event_type IN ('enter', 'still_present')
     GROUP BY pe.user_id, pe.venue_id
  ),
  exits AS (
    SELECT DISTINCT pe.user_id, pe.venue_id
      FROM public.presence_events pe
     WHERE pe.event_type = 'exit'
       AND pe.created_at > p_cutoff - INTERVAL '12 hours'
  )
  SELECT e.user_id, e.venue_id, e.entered_at, ls.last_seen_at
    FROM enters e
    JOIN last_seens ls
      ON ls.user_id = e.user_id AND ls.venue_id = e.venue_id
    LEFT JOIN exits ex
      ON ex.user_id = e.user_id AND ex.venue_id = e.venue_id
   WHERE ex.user_id IS NULL
     AND ls.last_seen_at < p_stalemark
     AND NOT EXISTS (
       SELECT 1 FROM public.user_visits uv
        WHERE uv.user_id = e.user_id
          AND uv.venue_id = e.venue_id
          AND uv.night_of = (
            CASE WHEN EXTRACT(HOUR FROM e.entered_at) < 8
                 THEN (e.entered_at - INTERVAL '1 day')::date
                 ELSE e.entered_at::date END
          )
     );
$$;

GRANT EXECUTE ON FUNCTION public.find_dangling_enters(timestamptz, timestamptz) TO service_role;

-- ───────────────────────────────────────────────────────────────
-- F) Grants — keep the public_profile_view + analytics readable
--    and writable in the right shapes.
-- ───────────────────────────────────────────────────────────────
GRANT SELECT ON public.public_profile_view TO anon, authenticated;
GRANT SELECT, INSERT ON public.profile_share_views TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────
-- G) Cron — promote-presence every 5 minutes.
--    Reuses the existing pg_cron + pg_net + system_config pattern
--    from 00013_besttime_cron_setup.sql. We add the URL row if it
--    doesn't already exist (cron_secret was inserted by 00013).
-- ───────────────────────────────────────────────────────────────
INSERT INTO public.system_config (key, value) VALUES
  ('promote_presence_url',
   'https://tyouvhtgzwcbqpylcssk.supabase.co/functions/v1/promote-presence')
ON CONFLICT (key) DO NOTHING;

-- Unschedule first so re-running this migration replaces the job
-- rather than erroring on a duplicate jobname.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promote-presence-cron') THEN
    PERFORM cron.unschedule('promote-presence-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'promote-presence-cron',
  '*/5 * * * *',
  $cmd$
    SELECT net.http_post(
      url := (SELECT value FROM public.system_config WHERE key = 'promote_presence_url'),
      headers := jsonb_build_object(
        'Content-Type',   'application/json',
        'X-Cron-Secret',  (SELECT value FROM public.system_config WHERE key = 'cron_secret')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $cmd$
);

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  views_ok    boolean;
  view_ok     boolean;
  rpc_ok      boolean;
  cron_ok     boolean;
  share_tok_n int;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='profile_share_views') INTO views_ok;
  SELECT EXISTS(SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='public_profile_view') INTO view_ok;
  SELECT EXISTS(SELECT 1 FROM pg_proc
    WHERE proname='find_dangling_enters') INTO rpc_ok;
  SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname='promote-presence-cron') INTO cron_ok;
  SELECT COUNT(*) FROM public.profiles
   WHERE profile_share_token IS NOT NULL INTO share_tok_n;

  RAISE NOTICE '═══ Migration 00031 complete ═══';
  RAISE NOTICE '  profile_share_views:           %', CASE WHEN views_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  public_profile_view:           %', CASE WHEN view_ok  THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  find_dangling_enters RPC:      %', CASE WHEN rpc_ok   THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  promote-presence-cron:         %', CASE WHEN cron_ok  THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  profiles with share_token:     %', share_tok_n;
  RAISE NOTICE '  NOTE: deploy `promote-presence` edge fn + ensure cron_secret in system_config is the live secret.';
END $$;

COMMIT;
