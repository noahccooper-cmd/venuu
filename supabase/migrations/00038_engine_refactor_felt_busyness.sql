BEGIN;

-- Add delta_pct: signed percentage of performance vs expected curve.
-- Range realistically -100 (dead empty when expected busy) to +200
-- (3x normal). NULL when confidence too low or no curve available.
ALTER TABLE public.headcount_estimates
  ADD COLUMN IF NOT EXISTS delta_pct numeric;

ALTER TABLE public.headcount_estimates_history
  ADD COLUMN IF NOT EXISTS delta_pct numeric;

-- Add trend_rate: how fast the estimate is changing.
-- Computed as (current_estimate - prior_estimate) / minutes_elapsed
-- Useful for UI to show "rising fast" vs "rising slowly".
ALTER TABLE public.headcount_estimates
  ADD COLUMN IF NOT EXISTS trend_rate numeric;

ALTER TABLE public.headcount_estimates_history
  ADD COLUMN IF NOT EXISTS trend_rate numeric;

-- Add expected_pct: what the baseline curve says this venue
-- SHOULD be doing right now. Stored for transparency + UI tooltips.
ALTER TABLE public.headcount_estimates
  ADD COLUMN IF NOT EXISTS expected_pct numeric;

ALTER TABLE public.headcount_estimates_history
  ADD COLUMN IF NOT EXISTS expected_pct numeric;

COMMENT ON COLUMN public.headcount_estimates.delta_pct IS
  'Signed % performance vs expected curve. live / expected - 1, expressed as percent. NULL when low confidence or no curve. THE hero number for the market UX.';

COMMENT ON COLUMN public.headcount_estimates.trend_rate IS
  'Rate of change in estimate units per minute. Positive = rising, negative = falling. Magnitude conveys speed.';

COMMENT ON COLUMN public.headcount_estimates.expected_pct IS
  'What the baseline curve says this venue should be at right now. The reference price.';

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'Migration 00038: delta_pct, trend_rate, expected_pct';
  RAISE NOTICE 'Added to headcount_estimates + history';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
