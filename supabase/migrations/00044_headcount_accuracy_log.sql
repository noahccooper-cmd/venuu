BEGIN;

CREATE TABLE IF NOT EXISTS public.headcount_accuracy_log (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                    uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  recorded_at                 timestamptz NOT NULL DEFAULT now(),

  -- The bouncer signal that triggered this log row
  bouncer_signal_id           uuid REFERENCES public.headcount_signals(id) ON DELETE SET NULL,
  bouncer_count               integer NOT NULL,         -- actual count from staff
  effective_capacity_at_truth integer,                  -- snapshot of capacity used

  -- What the engine was predicting in the 10 minutes prior
  predicted_estimate          integer,                  -- the engine's headcount number
  predicted_state             text,                     -- engine's state_label
  predicted_delta_pct         numeric,                  -- engine's delta_pct
  predicted_confidence_pct    integer,                  -- how confident the engine was
  predicted_baseline_source   text,                     -- besttime_live / forecast / manual / etc.
  prediction_age_seconds      integer,                  -- how stale the prediction was

  -- Ground truth derived from bouncer count
  true_state                  text,                     -- Packed/Busy/Lively/Quiet derived from count
  true_capacity_pct           numeric,                  -- count / effective_capacity

  -- The comparison
  match_score                 numeric,                  -- 1.0 exact, 0.5 one-step, 0.0 worse
  match_kind                  text,                     -- 'exact' | 'one_step' | 'miss' | 'unmeasurable'
  state_distance              integer,                  -- 0/1/2/3 -- distance between predicted and true

  -- Metadata for debugging tuning
  signals_active_count        integer,
  signals_breakdown           jsonb,
  notes                       text
);

CREATE INDEX IF NOT EXISTS idx_accuracy_log_venue_at
  ON public.headcount_accuracy_log(venue_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_accuracy_log_recorded_at
  ON public.headcount_accuracy_log(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_accuracy_log_match_kind
  ON public.headcount_accuracy_log(match_kind);

COMMENT ON TABLE public.headcount_accuracy_log IS
  'Predicted-vs-actual paired observations. Every bouncer signal triggers one row capturing what the engine predicted in the 10 min prior. Source of truth for engine accuracy metric.';

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'headcount_accuracy_log table created';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
