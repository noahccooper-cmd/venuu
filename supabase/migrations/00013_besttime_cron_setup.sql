-- ═══════════════════════════════════════════════════════════════
-- 00013_besttime_cron_setup.sql
--   * Enables pg_cron + pg_net.
--   * Creates besttime_refresh_runs (per-cycle audit log).
--   * Creates system_config (key/value lookup the cron jobs
--     consult at trigger time so secrets/URLs aren't baked into
--     the cron definition).
--   * Schedules 5 cron jobs that fan out to the
--     refresh-besttime-live edge function — one per chunk per
--     hour, 5pm–2am ET (== 21:00–02:59 UTC + 03:00–06:59 UTC
--     during EDT, our current TZ as of this migration).
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- Extensions
-- ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ───────────────────────────────────────────────────────────────
-- besttime_refresh_runs: per-cycle audit log
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.besttime_refresh_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_started_at timestamptz NOT NULL,
  cycle_completed_at timestamptz,
  city text NOT NULL,
  chunk integer NOT NULL DEFAULT 0,
  venues_processed integer DEFAULT 0,
  snapshots_persisted integer DEFAULT 0,
  signals_emitted_total integer DEFAULT 0,
  errors_count integer DEFAULT 0,
  error_details jsonb,
  triggered_by text
);

CREATE INDEX IF NOT EXISTS idx_besttime_runs_started
  ON public.besttime_refresh_runs (cycle_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_besttime_runs_city_started
  ON public.besttime_refresh_runs (city, cycle_started_at DESC);

ALTER TABLE public.besttime_refresh_runs ENABLE ROW LEVEL SECURITY;
-- No policies → service_role only.

-- ───────────────────────────────────────────────────────────────
-- system_config: cron jobs read URL + secret from here at trigger
-- time so we never bake secrets into the cron job body.
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
-- No policies → service_role only.

INSERT INTO public.system_config (key, value) VALUES
  ('besttime_refresh_url', 'https://tyouvhtgzwcbqpylcssk.supabase.co/functions/v1/refresh-besttime-live'),
  ('cron_secret',          'REPLACE_ME_WITH_CRON_SECRET')
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────────────────────────────────────────
-- Cron jobs — unschedule first so re-running this migration replaces
-- the schedule with current definitions instead of erroring on
-- duplicate jobnames.
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  jobnames text[] := ARRAY[
    'besttime-knoxville',
    'besttime-tampa-a',
    'besttime-tampa-b',
    'besttime-stpete-a',
    'besttime-stpete-b'
  ];
  jn text;
BEGIN
  FOREACH jn IN ARRAY jobnames LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = jn) THEN
      PERFORM cron.unschedule(jn);
    END IF;
  END LOOP;
END $$;

-- Schedule 5 jobs. Cron expression '0 21-23,0-6 * * *' = top of every
-- hour from 21:00 UTC through 06:00 UTC, which covers 5pm–2am EDT
-- (10 invocations per chunk per night during EDT).
SELECT cron.schedule('besttime-knoxville', '0 21-23,0-6 * * *', $cmd$
  SELECT net.http_post(
    url := (SELECT value FROM public.system_config WHERE key = 'besttime_refresh_url') || '?city=knoxville&chunk=0',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT value FROM public.system_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$cmd$);

SELECT cron.schedule('besttime-tampa-a', '0 21-23,0-6 * * *', $cmd$
  SELECT net.http_post(
    url := (SELECT value FROM public.system_config WHERE key = 'besttime_refresh_url') || '?city=tampa&chunk=0',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT value FROM public.system_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$cmd$);

SELECT cron.schedule('besttime-tampa-b', '0 21-23,0-6 * * *', $cmd$
  SELECT net.http_post(
    url := (SELECT value FROM public.system_config WHERE key = 'besttime_refresh_url') || '?city=tampa&chunk=1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT value FROM public.system_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$cmd$);

SELECT cron.schedule('besttime-stpete-a', '0 21-23,0-6 * * *', $cmd$
  SELECT net.http_post(
    url := (SELECT value FROM public.system_config WHERE key = 'besttime_refresh_url') || '?city=st_petersburg&chunk=0',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT value FROM public.system_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$cmd$);

SELECT cron.schedule('besttime-stpete-b', '0 21-23,0-6 * * *', $cmd$
  SELECT net.http_post(
    url := (SELECT value FROM public.system_config WHERE key = 'besttime_refresh_url') || '?city=st_petersburg&chunk=1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT value FROM public.system_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$cmd$);

-- ───────────────────────────────────────────────────────────────
-- Verify + remind operator about manual steps
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  job_count int;
  cron_secret_val text;
BEGIN
  SELECT COUNT(*) INTO job_count FROM cron.job WHERE jobname LIKE 'besttime-%';
  SELECT value INTO cron_secret_val FROM public.system_config WHERE key = 'cron_secret';

  RAISE NOTICE '═══ Migration 00013 complete ═══';
  RAISE NOTICE '  Extensions:        pg_cron, pg_net enabled';
  RAISE NOTICE '  Tables created:    besttime_refresh_runs, system_config';
  RAISE NOTICE '  Cron jobs active:  % / 5 expected', job_count;
  RAISE NOTICE '  Schedule:          0 21-23,0-6 * * * UTC (= 5pm–2am EDT)';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS — manual:';
  RAISE NOTICE '  1. Run scripts/deploy-besttime-engine.sh to deploy edge functions and';
  RAISE NOTICE '     set BESTTIME_API_KEY_PRIVATE + CRON_SECRET on Supabase.';
  RAISE NOTICE '  2. The deploy script will print the generated CRON_SECRET. Copy it,';
  RAISE NOTICE '     then run in this SQL editor:';
  RAISE NOTICE '       UPDATE public.system_config SET value = ''<paste-secret>''';
  RAISE NOTICE '       WHERE key = ''cron_secret'';';
  IF cron_secret_val = 'REPLACE_ME_WITH_CRON_SECRET' THEN
    RAISE NOTICE '  ⚠  cron_secret is still the placeholder — cron will return 401 until updated.';
  END IF;
END $$;

COMMIT;
