BEGIN;

CREATE OR REPLACE FUNCTION public.headcount_signals_evaluate_bouncer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.signal_type = 'bouncer_headcount' THEN
    -- Fire-and-forget: failure shouldn't break the signal insert
    BEGIN
      PERFORM public.evaluate_bouncer_truth_signal(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'bouncer evaluator trigger failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evaluate_bouncer ON public.headcount_signals;
CREATE TRIGGER trg_evaluate_bouncer
  AFTER INSERT ON public.headcount_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.headcount_signals_evaluate_bouncer();

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'trg_evaluate_bouncer trigger active';
  RAISE NOTICE 'Every new bouncer_headcount -> accuracy log';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
