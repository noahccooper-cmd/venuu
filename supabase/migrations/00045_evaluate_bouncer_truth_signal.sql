BEGIN;

-- Helper: map state_label to a comparable integer (for distance math)
CREATE OR REPLACE FUNCTION public.state_label_rank(p_state text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_state
    WHEN 'Quiet'   THEN 1
    WHEN 'Lively'  THEN 2
    WHEN 'Busy'    THEN 3
    WHEN 'Packed'  THEN 4
    WHEN 'Surging' THEN 5
    ELSE NULL
  END;
$$;

-- Helper: derive ground-truth state from a count + effective_capacity
CREATE OR REPLACE FUNCTION public.derive_true_state(
  p_count integer,
  p_effective_capacity integer
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_effective_capacity IS NULL OR p_effective_capacity <= 0 THEN NULL
    WHEN p_count::numeric / p_effective_capacity >= 0.85 THEN 'Packed'
    WHEN p_count::numeric / p_effective_capacity >= 0.60 THEN 'Busy'
    WHEN p_count::numeric / p_effective_capacity >= 0.30 THEN 'Lively'
    ELSE 'Quiet'
  END;
$$;

-- Main evaluator: called whenever a bouncer signal lands.
-- Joins back to headcount_estimates_history for the most recent prediction
-- within the 10-minute lookback window. Inserts one row into
-- headcount_accuracy_log.
CREATE OR REPLACE FUNCTION public.evaluate_bouncer_truth_signal(
  p_signal_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_signal_row record;
  v_venue_row record;
  v_pred record;
  v_log_id uuid;
  v_bouncer_count integer;
  v_effective_capacity integer;
  v_true_state text;
  v_true_capacity_pct numeric;
  v_predicted_state text;
  v_predicted_rank integer;
  v_true_rank integer;
  v_distance integer;
  v_match_score numeric;
  v_match_kind text;
  v_prediction_age_sec integer;
BEGIN
  -- 1. Load the bouncer signal
  SELECT venue_id, signal_value, recorded_at, metadata
  INTO v_signal_row
  FROM public.headcount_signals
  WHERE id = p_signal_id AND signal_type = 'bouncer_headcount';

  IF v_signal_row IS NULL THEN
    RAISE WARNING 'evaluate_bouncer_truth_signal: signal % not found or not a bouncer signal', p_signal_id;
    RETURN NULL;
  END IF;

  v_bouncer_count := v_signal_row.signal_value::integer;

  -- 2. Load venue + capacity. Skip if no capacity available.
  SELECT id, effective_capacity, capacity
  INTO v_venue_row
  FROM public.venues
  WHERE id = v_signal_row.venue_id;

  v_effective_capacity := COALESCE(v_venue_row.effective_capacity, v_venue_row.capacity);

  -- If no capacity, log as unmeasurable and return
  IF v_effective_capacity IS NULL OR v_effective_capacity <= 0 THEN
    INSERT INTO public.headcount_accuracy_log (
      venue_id, recorded_at, bouncer_signal_id, bouncer_count,
      match_kind, notes
    ) VALUES (
      v_signal_row.venue_id, v_signal_row.recorded_at, p_signal_id, v_bouncer_count,
      'unmeasurable', 'no effective_capacity -- cannot derive true state'
    )
    RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

  -- 3. Derive ground truth
  v_true_state := public.derive_true_state(v_bouncer_count, v_effective_capacity);
  v_true_capacity_pct := v_bouncer_count::numeric / v_effective_capacity;

  -- 4. Find the engine's most recent prediction within 10 minutes BEFORE
  --    the bouncer signal. Critically: must be BEFORE the bouncer signal,
  --    not after -- we're testing whether the engine predicted correctly,
  --    not whether it adjusted after the truth landed.
  --    Also: must not be a bouncer-override prediction (that's circular --
  --    the engine just echoed an earlier bouncer click).
  SELECT estimate, state_label, delta_pct, confidence_pct,
         source_breakdown->>'baseline_source' AS baseline_source,
         active_signal_count, source_breakdown,
         EXTRACT(EPOCH FROM (v_signal_row.recorded_at - computed_at))::integer AS age_sec
  INTO v_pred
  FROM public.headcount_estimates_history
  WHERE venue_id = v_signal_row.venue_id
    AND computed_at < v_signal_row.recorded_at
    AND computed_at >= v_signal_row.recorded_at - interval '10 minutes'
    AND override_active = false   -- don't measure against bouncer-driven predictions
  ORDER BY computed_at DESC
  LIMIT 1;

  -- If no prediction within window, log as unmeasurable
  IF v_pred IS NULL THEN
    INSERT INTO public.headcount_accuracy_log (
      venue_id, recorded_at, bouncer_signal_id, bouncer_count,
      effective_capacity_at_truth, true_state, true_capacity_pct,
      match_kind, notes
    ) VALUES (
      v_signal_row.venue_id, v_signal_row.recorded_at, p_signal_id, v_bouncer_count,
      v_effective_capacity, v_true_state, v_true_capacity_pct,
      'unmeasurable', 'no engine prediction within 10-min lookback'
    )
    RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

  v_predicted_state := v_pred.state_label;
  v_prediction_age_sec := v_pred.age_sec;

  -- 5. Score the match
  v_predicted_rank := public.state_label_rank(v_predicted_state);
  v_true_rank := public.state_label_rank(v_true_state);

  IF v_predicted_rank IS NULL OR v_true_rank IS NULL THEN
    -- One side is Unknown or unrecognized -- score as a miss
    v_distance := NULL;
    v_match_score := 0.0;
    v_match_kind := CASE
      WHEN v_predicted_state = 'Unknown' THEN 'unknown_prediction'
      ELSE 'miss'
    END;
  ELSE
    v_distance := ABS(v_predicted_rank - v_true_rank);
    v_match_score := CASE
      WHEN v_distance = 0 THEN 1.0
      WHEN v_distance = 1 THEN 0.5
      ELSE 0.0
    END;
    v_match_kind := CASE
      WHEN v_distance = 0 THEN 'exact'
      WHEN v_distance = 1 THEN 'one_step'
      ELSE 'miss'
    END;
  END IF;

  -- 6. Insert the log row
  INSERT INTO public.headcount_accuracy_log (
    venue_id, recorded_at, bouncer_signal_id, bouncer_count,
    effective_capacity_at_truth,
    predicted_estimate, predicted_state, predicted_delta_pct,
    predicted_confidence_pct, predicted_baseline_source,
    prediction_age_seconds,
    true_state, true_capacity_pct,
    match_score, match_kind, state_distance,
    signals_active_count, signals_breakdown
  ) VALUES (
    v_signal_row.venue_id, v_signal_row.recorded_at, p_signal_id, v_bouncer_count,
    v_effective_capacity,
    v_pred.estimate, v_predicted_state, v_pred.delta_pct,
    v_pred.confidence_pct, v_pred.baseline_source,
    v_prediction_age_sec,
    v_true_state, v_true_capacity_pct,
    v_match_score, v_match_kind, v_distance,
    v_pred.active_signal_count, v_pred.source_breakdown
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
EXCEPTION WHEN OTHERS THEN
  -- Never let evaluator failure break the parent transaction
  RAISE WARNING 'evaluate_bouncer_truth_signal failed: % %', SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'evaluate_bouncer_truth_signal deployed';
  RAISE NOTICE 'Helpers: state_label_rank, derive_true_state';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
