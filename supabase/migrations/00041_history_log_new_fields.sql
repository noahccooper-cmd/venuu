BEGIN;

CREATE OR REPLACE FUNCTION public.headcount_estimates_log_to_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.headcount_estimates_history (
    venue_id,
    estimate, estimate_low, estimate_high,
    confidence, confidence_pct,
    capacity_pct,
    state_label, trend, trend_rate,
    baseline_component, signal_component,
    override_active, override_expires_at,
    dominant_signal_source, active_signal_count,
    last_signal_at,
    source_breakdown,
    computed_at,
    last_calculated_at, updated_at,
    delta_pct, expected_pct
  ) VALUES (
    NEW.venue_id,
    NEW.estimate, NEW.estimate_low, NEW.estimate_high,
    NEW.confidence, NEW.confidence_pct,
    NEW.capacity_pct,
    NEW.state_label, NEW.trend, NEW.trend_rate,
    NEW.baseline_component, NEW.signal_component,
    NEW.override_active, NEW.override_expires_at,
    NEW.dominant_signal_source, NEW.active_signal_count,
    NEW.last_signal_at,
    NEW.source_breakdown,
    NEW.computed_at,
    NEW.last_calculated_at, NEW.updated_at,
    NEW.delta_pct, NEW.expected_pct
  );
  RETURN NEW;
END;
$function$;

COMMIT;
