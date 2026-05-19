BEGIN;

DO $$
DECLARE
  v_signal_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_signal_id IN
    SELECT id FROM public.headcount_signals
    WHERE signal_type = 'bouncer_headcount'
    ORDER BY recorded_at ASC
  LOOP
    PERFORM public.evaluate_bouncer_truth_signal(v_signal_id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'Backfill complete: % bouncer signals processed', v_count;
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
