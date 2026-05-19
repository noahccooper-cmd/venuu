BEGIN;

-- Phase 4.5 market-aware Venny — stamp every assistant turn with
-- whether it cited live market data (drives the pulse-dot UI in chat).
ALTER TABLE public.venny_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN public.venny_messages.metadata IS
  'Per-message metadata. Currently used by Phase 4.5 market-aware Venny: { used_live_data: bool, market_snapshot_at: timestamptz }. Never sent back to Anthropic; client-only.';

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'venny_messages.metadata column added';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
