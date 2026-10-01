-- ════════════════════════════════════════════════════════════════
-- 00035_morning_push_cron.sql
-- ────────────────────────────────────────────────────────────────
-- Schedule the daily "rate last night" morning nudge.
--
-- Runs at 15:00 UTC every day (10am ET / 7am PT). Hits the
-- `morning-rating-push` edge function, which finds every night_plan
-- with rating_status = 'pending_morning' completed in the last 24h
-- and pushes the owning user a deep-link to rate it.
--
-- Reuses the existing pg_cron + pg_net + system_config pattern
-- established in 00013_besttime_cron_setup.sql / 00031. cron_secret
-- already lives in system_config — we only add the URL row and
-- schedule the job.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1. Register the function URL in system_config so the cron job
--    can resolve it. cron_secret was inserted by 00013 already.
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.system_config (key, value) VALUES
  ('morning_rating_push_url',
   'https://tyouvhtgzwcbqpylcssk.supabase.co/functions/v1/morning-rating-push')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ────────────────────────────────────────────────────────────────
-- 2. Drop any existing morning rating cron so re-running this
--    migration replaces the job rather than erroring on duplicate.
-- ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-rating-push-cron') THEN
    PERFORM cron.unschedule('morning-rating-push-cron');
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────
-- 3. Schedule for 15:00 UTC daily (10am ET / 7am PT).
--    Header `X-Cron-Secret` matches the project's convention; the
--    edge function also accepts `Authorization: Bearer <secret>`
--    for manual invocations.
-- ────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'morning-rating-push-cron',
  '0 15 * * *',
  $cmd$
    SELECT net.http_post(
      url := (SELECT value FROM public.system_config WHERE key = 'morning_rating_push_url'),
      headers := jsonb_build_object(
        'Content-Type',   'application/json',
        'X-Cron-Secret',  (SELECT value FROM public.system_config WHERE key = 'cron_secret')
      ),
      body := jsonb_build_object('source', 'cron')
    ) AS request_id;
  $cmd$
);

-- ────────────────────────────────────────────────────────────────
-- Verify
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  url_ok  boolean;
  job_ok  boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.system_config WHERE key='morning_rating_push_url')
    INTO url_ok;
  SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname='morning-rating-push-cron')
    INTO job_ok;

  RAISE NOTICE '─────────────────────────────────────';
  RAISE NOTICE 'Migration 00035 — morning-rating-push cron';
  RAISE NOTICE '  function URL row:        %', CASE WHEN url_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  morning-rating-push-cron: %', CASE WHEN job_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  Runs daily at 15:00 UTC (10am ET / 7am PT)';
  RAISE NOTICE '  NOTE: deploy the `morning-rating-push` edge function';
  RAISE NOTICE '        and ensure cron_secret in system_config matches the';
  RAISE NOTICE '        function''s CRON_SECRET env var.';
  RAISE NOTICE '─────────────────────────────────────';
END $$;

COMMIT;
