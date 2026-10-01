-- ═══════════════════════════════════════════════════════════════
-- 00015_fusion_cron.sql
--
-- Schedules the fuse-estimates edge function to run every minute
-- during nightlife hours (5pm–2am EDT == 21:00–06:00 UTC).
--
-- The fusion fn is SQL-only and finishes in seconds; running it
-- once a minute keeps headcount_estimates effectively real-time
-- against the underlying signals + BestTime live data.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- Register the edge URL + a placeholder anon key in system_config.
-- The deploy script prints the UPDATE statements for both.
-- ───────────────────────────────────────────────────────────────
INSERT INTO public.system_config (key, value) VALUES
  ('fuse_estimates_url', 'https://tyouvhtgzwcbqpylcssk.supabase.co/functions/v1/fuse-estimates'),
  ('supabase_anon_key',  'REPLACE_ME_WITH_ANON_KEY')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();

-- ───────────────────────────────────────────────────────────────
-- Idempotently re-register the cron job (unschedule first if exists)
-- ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fuse-estimates') THEN
    PERFORM cron.unschedule('fuse-estimates');
  END IF;
END $$;

-- Every minute, 21:00–23:59 UTC and 00:00–06:59 UTC
-- (== 5pm–2am EDT, our nightlife window during summer)
SELECT cron.schedule('fuse-estimates', '* 21-23,0-6 * * *', $cmd$
  SELECT net.http_post(
    url := (SELECT value FROM public.system_config WHERE key = 'fuse_estimates_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT value FROM public.system_config WHERE key = 'cron_secret'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.system_config WHERE key = 'supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
$cmd$);

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  job_exists boolean;
  anon_set boolean;
  secret_set boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fuse-estimates')
    INTO job_exists;
  SELECT (value <> 'REPLACE_ME_WITH_ANON_KEY') INTO anon_set
    FROM public.system_config WHERE key = 'supabase_anon_key';
  SELECT (value <> 'REPLACE_ME_WITH_CRON_SECRET') INTO secret_set
    FROM public.system_config WHERE key = 'cron_secret';

  RAISE NOTICE '═══ Migration 00015 complete ═══';
  RAISE NOTICE '  Cron job:     fuse-estimates registered = %', job_exists;
  RAISE NOTICE '  Schedule:     * 21-23,0-6 * * * UTC  (every minute, 5pm–2am EDT)';
  RAISE NOTICE '  Frequency:    60 invocations per nightlife hour';
  RAISE NOTICE '';
  IF NOT secret_set THEN
    RAISE NOTICE '  ⚠  cron_secret is still the placeholder — cron will return 401.';
  END IF;
  IF NOT anon_set THEN
    RAISE NOTICE '  ⚠  supabase_anon_key is still the placeholder — cron auth will fail.';
    RAISE NOTICE '     scripts/deploy-besttime-engine.sh prints the UPDATE statement to fix.';
  END IF;
END $$;

COMMIT;
