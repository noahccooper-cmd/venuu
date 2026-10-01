BEGIN;

INSERT INTO public.signal_weights (signal_type, weight, ttl_seconds, description)
VALUES (
  'plan_intent',
  0.35,
  10800,  -- 3 hours
  'User-composed Venny plan named this venue for tonight. Forward-looking intent signal — they''re planning to be here but not there yet.'
)
ON CONFLICT (signal_type) DO UPDATE SET
  weight = EXCLUDED.weight,
  ttl_seconds = EXCLUDED.ttl_seconds,
  description = EXCLUDED.description,
  updated_at = now();

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'plan_intent signal type added';
  RAISE NOTICE 'weight=0.35 ttl=3h';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
