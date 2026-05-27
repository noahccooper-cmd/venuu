import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, supabaseProjectUrl, supabaseAnonPublicKey } from '../../lib/supabase';
import { hapticLight, hapticMedium, hapticSuccess } from '../../lib/haptics';
import { VenueResultCard, type VenueResult } from './VenueResultCard';
import { PlanCard, type Plan } from './PlanCard';
import type { CityKey } from '../../lib/constants';
import { getWelcomeMessage, getSuggestions } from '../../lib/vennyKnowledge';

/**
 * VennySheet — bottom sheet that wraps Venny's chat surface.
 *
 *   • Streams from supabase/functions/venny-chat over SSE.
 *   • Persists conversation_id in localStorage so the thread survives
 *     across opens within a session (one-per-user, server-side).
 *   • Inline tool-result rendering — search_venues hits inject
 *     <VenueResultCard> rows directly into the assistant message,
 *     and highlight_on_map results bubble up via onHighlight so the
 *     map underneath visibly reacts.
 *   • User-resizable height with 3 snap points (MINI 28vh, MID 62vh,
 *     FULL 92vh). Drag the handle to resize, tap it to cycle
 *     MID→FULL→MINI→MID. Last manual choice is persisted in
 *     localStorage so reopens remember the user's preference.
 *   • Drag past MINI down → dismiss (close sheet).
 *   • Tap-outside dismiss preserved via scrim onClick.
 */

type SheetSnap = 'mini' | 'mid' | 'full';
const SNAP_VH: Record<SheetSnap, number> = { mini: 28, mid: 62, full: 92 };
const SHEET_PREF_KEY = 'venuu_venny_sheet_pref';

function loadSnapPref(): SheetSnap {
  try {
    const v = localStorage.getItem(SHEET_PREF_KEY);
    if (v === 'mini' || v === 'mid' || v === 'full') return v;
  } catch { /* private mode */ }
  return 'mid';
}

type Role = 'user' | 'assistant';

interface MessageContentText { type: 'text'; text: string }
interface MessageContentVenues { type: 'venues'; venues: VenueResult[] }
interface MessageContentPlan { type: 'plan'; plan: Plan; planMsgId: string }
type MessageContent = MessageContentText | MessageContentVenues | MessageContentPlan;

interface VennyMessageMetadata {
  /** Phase 4.5 — true when the assistant cited live market data
   *  (city pulse, a delta_pct from the movers list, or a venue + a
   *  "tonight/right now/surging" framing). Drives the pulse dot. */
  used_live_data?: boolean;
  market_snapshot_at?: string;
}

interface VennyMessage {
  id: string;
  role: Role;
  blocks: MessageContent[];
  /** True while the assistant is still streaming this message. */
  streaming?: boolean;
  metadata?: VennyMessageMetadata;
}

/** Tracks per-rendered-plan local UI state (saving/saved) without
 *  having to mutate the message itself. Keyed on the block's planMsgId. */
type PlanSaveState = 'idle' | 'saving' | 'saved';

interface VennySheetProps {
  open: boolean;
  onClose: () => void;
  city: CityKey;
  userId: string | null;
  /** Currently selected venue, if any — fed to the agent so it can
   *  reference "this place" naturally. */
  focusedVenueName?: string | null;
  /** Called when the agent's highlight_on_map tool fires. Parent uses
   *  this to dim non-matching bubbles + flash a ring on matches. */
  onHighlight: (venueIds: string[]) => void;
  /** Called when the user taps a result card — parent closes the sheet
   *  and flies the map camera to (lng, lat). */
  onFlyToVenue: (venueId: string, lng: number, lat: number) => void;
  /** Called when compose_plan returns. Parent renders the orange
   *  route line + numbered stop markers on the map and (typically)
   *  collapses the sheet height so the route is visible. */
  onActivatePlan?: (plan: Plan | null) => void;
  /** When non-null, drives the auto-snap-to-MINI behavior on the
   *  transition to a fresh plan. Otherwise unused by the sheet's
   *  size logic (user controls size via drag handle). */
  activePlan?: Plan | null;
  /** Optional priming message — if set when the sheet opens, the
   *  sheet auto-sends it once history loads, then calls
   *  onInitialMessageHandled so the parent can clear it. */
  initialMessage?: string | null;
  onInitialMessageHandled?: () => void;
  /** Indices of stops in the currently rendered plan that the
   *  proximity detector has confirmed the user has entered. Passed
   *  to PlanCard so it can render a green checkmark next to each
   *  visited stop. */
  visitedStopIndices?: number[];
  /** Fires when save_plan succeeds — parent gets the new
   *  night_plans.id so it can persist per-stop visited_at later. */
  onPlanSaved?: (planId: string) => void;
}

const CONV_STORAGE_KEY = 'venuu_venny_conversation_id';

function newId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function VennySheetInner({
  open,
  onClose,
  city,
  userId,
  focusedVenueName,
  onHighlight,
  onFlyToVenue,
  onActivatePlan,
  activePlan,
  initialMessage,
  onInitialMessageHandled,
  visitedStopIndices,
  onPlanSaved,
}: VennySheetProps) {
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CONV_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const [messages, setMessages] = useState<VennyMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** Per-rendered-plan UI state — saving/saved indicators don't need
   *  to round-trip through the persisted message blocks. */
  const [planStates, setPlanStates] = useState<Record<string, PlanSaveState>>({});
  /** Track the planMsgId of any plan we're currently waiting on save_plan
   *  to confirm, so the next save_plan tool_result event can flip it. */
  const pendingSavePlanIdRef = useRef<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // ── User-resizable sheet (3 snap points: mini / mid / full) ──
  // `snapPoint` is the user's last committed choice. `dragVh` is a
  // transient override while the finger is on the handle; it falls
  // back to the snap-point height on release.
  const [snapPoint, setSnapPoint] = useState<SheetSnap>(loadSnapPref);
  const [dragVh, setDragVh] = useState<number | null>(null);
  const dragRef = useRef<{ startVh: number; startY: number; movedPx: number } | null>(null);
  /** Track activePlan transitions so we can auto-snap to MINI when a
   *  fresh plan lands — without overwriting the user's manual pref. */
  const planSnapRef = useRef<boolean>(activePlan != null);

  // ── Load history when the sheet opens (one shot per conversation) ──
  useEffect(() => {
    if (!open) return;
    if (historyLoaded) return;
    if (!conversationId) {
      setHistoryLoaded(true);
      return;
    }
    if (!supabase) {
      setHistoryLoaded(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data, error: histErr } = await supabase
          .from('venny_messages')
          .select('id, role, content, metadata, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });
        if (cancelled) return;
        if (histErr) {
          console.warn('[venny] history load failed:', histErr.message);
          setHistoryLoaded(true);
          return;
        }
        const restored = (data ?? []).flatMap(rowToMessages);
        setMessages(restored);
      } catch (err) {
        console.warn('[venny] history load threw:', err);
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [open, conversationId, historyLoaded]);

  // Scroll to bottom on new content
  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open]);

  // On every open, restore the user's last-committed snap pref. Drag
  // overrides are local to the gesture and don't survive a re-open.
  useEffect(() => {
    if (!open) return;
    setSnapPoint(loadSnapPref());
    setDragVh(null);
  }, [open]);

  // Auto-snap to MINI on the transition null → non-null activePlan
  // so the user immediately sees the route on the map. Don't write
  // this to the persisted pref — it's a one-time courtesy, not the
  // user's stated preference.
  useEffect(() => {
    const wasActive = planSnapRef.current;
    const isActive = activePlan != null;
    planSnapRef.current = isActive;
    if (!wasActive && isActive && open) {
      setSnapPoint('mini');
    }
  }, [activePlan, open]);

  // Cancel any in-flight stream on close
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  // ── Send message → SSE stream ────────────────────────────────────
  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);

    // Optimistic user bubble
    const userMsg: VennyMessage = {
      id: newId(),
      role: 'user',
      blocks: [{ type: 'text', text: trimmed }],
    };
    // Placeholder assistant bubble we'll stream into
    const asstId = newId();
    const asstMsg: VennyMessage = {
      id: asstId,
      role: 'assistant',
      blocks: [{ type: 'text', text: '' }],
      streaming: true,
    };
    setMessages(prev => [...prev, userMsg, asstMsg]);
    setInput('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Pull a fresh access token so the edge fn can identify the user.
      let accessToken: string | null = null;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        accessToken = data.session?.access_token ?? null;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonPublicKey,
      };
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
      else headers['Authorization'] = `Bearer ${supabaseAnonPublicKey}`;

      const res = await fetch(`${supabaseProjectUrl}/functions/v1/venny-chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: trimmed,
          city,
          userId,
          conversationId,
          focusedVenueName: focusedVenueName ?? null,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(`venny-chat failed: ${res.status} ${errText.slice(0, 200)}`);
      }

      await consumeSSE(res.body, (event) => {
        if (event.type === 'conversation') {
          if (event.id && event.id !== conversationId) {
            setConversationId(event.id);
            try { localStorage.setItem(CONV_STORAGE_KEY, event.id); } catch { /* swallow */ }
          }
        } else if (event.type === 'text') {
          setMessages(prev => appendTextToAssistant(prev, asstId, event.delta));
        } else if (event.type === 'tool_result') {
          const toolName = event.name as string | undefined;
          const output = event.output as Record<string, unknown> | undefined;
          if (toolName === 'search_venues' && Array.isArray(output?.results)) {
            setMessages(prev => appendVenuesToAssistant(prev, asstId, output!.results as VenueResult[]));
          } else if (toolName === 'highlight_on_map' && Array.isArray(output?.highlighted_venue_ids)) {
            onHighlight(output!.highlighted_venue_ids as string[]);
          } else if (toolName === 'compose_plan' && output?.plan && typeof output.plan === 'object') {
            // Inject the plan card inline + tell the parent to render
            // the route line on the map.
            const plan = output.plan as Plan;
            const planMsgId = newId();
            setMessages(prev => appendPlanToAssistant(prev, asstId, plan, planMsgId));
            setPlanStates(prev => ({ ...prev, [planMsgId]: 'idle' }));
            onActivatePlan?.(plan);
          } else if (toolName === 'save_plan') {
            // Flip the pending plan card to "saved" (or back to idle on
            // failure). pendingSavePlanIdRef is set when the user taps
            // "save" — the SSE event arrives a couple turns later.
            const out = output as Record<string, unknown> | undefined;
            const success = out?.success === true;
            const targetId = pendingSavePlanIdRef.current;
            if (targetId) {
              setPlanStates(prev => ({ ...prev, [targetId]: success ? 'saved' : 'idle' }));
              pendingSavePlanIdRef.current = null;
            }
            if (success) {
              hapticSuccess();
              setToast('plan saved ✓');
              window.setTimeout(() => setToast(null), 2400);
              // Surface the new night_plans.id so the parent can
              // persist per-stop visited_at as the proximity detector
              // marks stops visited.
              const planId = typeof out?.plan_id === 'string' ? out.plan_id : null;
              if (planId) onPlanSaved?.(planId);
            } else {
              const msg = out?.message as string | undefined;
              setToast(msg ?? 'save failed');
              window.setTimeout(() => setToast(null), 3000);
            }
          }
        } else if (event.type === 'metadata') {
          // Phase 4.5 — assistant declared whether it used live market
          // data. Stamp the streaming message so the pulse dot paints.
          const used = event.used_live_data === true;
          const snapAt = typeof event.market_snapshot_at === 'string'
            ? event.market_snapshot_at
            : undefined;
          setMessages(prev => prev.map(m => m.id === asstId
            ? { ...m, metadata: { ...m.metadata, used_live_data: used, market_snapshot_at: snapAt } }
            : m));
        } else if (event.type === 'done') {
          setMessages(prev => prev.map(m => m.id === asstId ? { ...m, streaming: false } : m));
        } else if (event.type === 'error') {
          setError(event.message ?? 'Venny had a problem.');
          setMessages(prev => prev.map(m => m.id === asstId ? { ...m, streaming: false } : m));
        }
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        // intentional cancel — leave messages as-is
      } else {
        const msg = err instanceof Error ? err.message : 'Network error';
        console.warn('[venny] send failed:', msg);
        setError(msg);
        setMessages(prev => prev.map(m => m.id === asstId ? { ...m, streaming: false } : m));
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [sending, city, userId, conversationId, focusedVenueName, onHighlight, onActivatePlan]);

  // ── Auto-send a priming message once history is loaded.
  // Used by the profile's "Tell Venny your taste" banner — opening
  // the sheet with a single tap that immediately kicks off the
  // taste-capture conversation. Cleared via the parent callback so
  // re-opens don't replay the message.
  const initialMessageSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (!initialMessage) return;
    if (!historyLoaded) return;
    if (sending) return;
    if (initialMessageSentRef.current === initialMessage) return;
    initialMessageSentRef.current = initialMessage;
    // Tiny delay so the sheet's open animation is visible before
    // Venny's "thinking..." dots appear.
    const t = window.setTimeout(() => {
      send(initialMessage);
      onInitialMessageHandled?.();
    }, 220);
    return () => window.clearTimeout(t);
  }, [open, initialMessage, historyLoaded, sending, send, onInitialMessageHandled]);

  // ── Suggested prompts (filter chips) ─────────────────────────────
  // City-specific suggestions from vennyKnowledge — Knoxville gets
  // "Where should freshmen go?" etc., other cities fall back to generic.
  const suggestions = useMemo(() => getSuggestions(city), [city]);

  // Welcome message — random selection per session per city. useMemo
  // keyed on city keeps the message stable across re-renders so it
  // doesn't reshuffle mid-empty-state.
  const welcomeMessage = useMemo(
    () => getWelcomeMessage(city, 'friend'),
    [city],
  );

  const handleSuggestionTap = useCallback((text: string) => {
    hapticLight();
    send(text);
  }, [send]);

  // ── Drag handle: pointer events for resize + tap cycle ──────────
  // Pointer events unify mouse + touch + pen, capture properly for
  // off-handle drags, and (with touch-action: none on the target)
  // suppress the browser's native scroll/back gestures during drag.
  const commitSnap = useCallback((next: SheetSnap) => {
    setSnapPoint(next);
    try { localStorage.setItem(SHEET_PREF_KEY, next); } catch { /* private mode */ }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* swallow */ }
    dragRef.current = {
      startVh: SNAP_VH[snapPoint],
      startY: e.clientY,
      movedPx: 0,
    };
  }, [snapPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dy) > dragRef.current.movedPx) {
      dragRef.current.movedPx = Math.abs(dy);
    }
    // Dragging the handle DOWN (positive dy) shrinks the sheet.
    const vh = window.innerHeight / 100;
    const next = dragRef.current.startVh - dy / vh;
    setDragVh(Math.max(0, Math.min(98, next)));
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* swallow */ }

    const wasTap = dragRef.current.movedPx < 6;
    const finalVh = dragVh ?? SNAP_VH[snapPoint];
    dragRef.current = null;
    setDragVh(null);

    if (wasTap) {
      // Cycle MID → FULL → MINI → MID.
      hapticLight();
      const next: SheetSnap = snapPoint === 'mid'
        ? 'full'
        : snapPoint === 'full'
          ? 'mini'
          : 'mid';
      commitSnap(next);
      return;
    }

    // Drag past MINI floor → dismiss.
    if (finalVh < 18) {
      hapticMedium();
      onClose();
      return;
    }

    // Snap to nearest of the three valid heights.
    const distMini = Math.abs(finalVh - SNAP_VH.mini);
    const distMid  = Math.abs(finalVh - SNAP_VH.mid);
    const distFull = Math.abs(finalVh - SNAP_VH.full);
    const minDist = Math.min(distMini, distMid, distFull);
    const snap: SheetSnap = minDist === distMini
      ? 'mini'
      : minDist === distMid
        ? 'mid'
        : 'full';
    hapticLight();
    commitSnap(snap);
  }, [dragVh, snapPoint, onClose, commitSnap]);

  // Submit on Enter (no shift)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }, [send, input]);

  // ── Plan card actions ────────────────────────────────────────────
  // Save: flip local state to 'saving', stash the plan id, then send
  // a confirmation message to Venny. The agent calls save_plan; we
  // flip to 'saved' (or back to 'idle') when the tool_result arrives.
  const handleSavePlan = useCallback((planMsgId: string, _plan: Plan) => {
    if (!userId) {
      setToast('sign in to save plans');
      window.setTimeout(() => setToast(null), 2400);
      return;
    }
    hapticLight();
    pendingSavePlanIdRef.current = planMsgId;
    setPlanStates(prev => ({ ...prev, [planMsgId]: 'saving' }));
    send('save this plan');
  }, [userId, send]);

  // Share: copy a plain-text summary to clipboard. Full snapshot share
  // is v1.3+; this is the minimum viable share button.
  const handleSharePlan = useCallback(async (plan: Plan) => {
    hapticLight();
    const lines: string[] = [];
    lines.push(plan.title);
    if (plan.summary) lines.push(plan.summary);
    lines.push('');
    plan.stops.forEach((s, i) => {
      const meta = [s.arrival_time, s.estimated_cost != null ? `~$${s.estimated_cost}` : null]
        .filter(Boolean)
        .join(' · ');
      lines.push(`${i + 1}. ${s.venue_name}${meta ? ` (${meta})` : ''}`);
      if (s.vibe_note) lines.push(`   ${s.vibe_note}`);
    });
    if (plan.total_estimated_cost != null) {
      lines.push('');
      lines.push(`total: ~$${plan.total_estimated_cost} / person`);
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setToast('plan copied');
    } catch {
      setToast('clipboard unavailable');
    }
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
              zIndex: 700,
            }}
          />

          {/* Toast — short-lived status messages (plan saved, copied, etc.) */}
          {toast && (
            <div
              style={{
                position: 'fixed',
                top: 'calc(80px + env(safe-area-inset-top, 0px) + 24px)',
                left: '50%',
                transform: 'translateX(-50%)',
                padding: '8px 16px',
                borderRadius: 18,
                background: 'rgba(10, 10, 14, 0.95)',
                border: '1px solid rgba(255, 130, 0, 0.45)',
                color: '#FFD9B8',
                fontFamily: 'Satoshi, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
                zIndex: 720,
                pointerEvents: 'none',
              }}
            >
              {toast}
            </div>
          )}

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              // User-controlled height: live override while dragging,
              // otherwise the committed snap point.
              height: `${dragVh ?? SNAP_VH[snapPoint]}vh`,
              // During drag: no transition so the handle follows the
              // finger 1:1. On release: spring animation to snap target.
              transition: dragVh != null
                ? 'none'
                : 'height 320ms cubic-bezier(0.2, 0.9, 0.3, 1)',
              background: 'linear-gradient(180deg, #0E0E14 0%, #0A0A10 100%)',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 -16px 48px rgba(0, 0, 0, 0.6)',
              zIndex: 701,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Drag handle — resize via pointer drag, cycle via tap. */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Resize Venny sheet"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                padding: '10px 0 4px',
                cursor: 'grab',
                flexShrink: 0,
                touchAction: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{
                width: 40, height: 4, borderRadius: 2,
                background: dragVh != null
                  ? 'var(--brand-orange-tint-strong, rgba(255, 130, 0, 0.25))'
                  : 'rgba(255, 255, 255, 0.25)',
                margin: '0 auto',
                transform: dragVh != null ? 'scale(1.2)' : 'scale(1)',
                transition: 'background 180ms ease, transform 180ms ease',
              }} />
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 20px 10px', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.2 L9.35 5.9 L14 7.25 L9.35 8.6 L8 13.3 L6.65 8.6 L2 7.25 L6.65 5.9 Z" fill="#FF8200" />
                </svg>
                <span style={{
                  fontFamily: 'Satoshi, sans-serif',
                  fontSize: 15, fontWeight: 700, color: 'white',
                  letterSpacing: '-0.01em',
                }}>
                  Venny
                </span>
              </div>
              <button
                type="button"
                onClick={() => { hapticLight(); onClose(); }}
                aria-label="Close Venny"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.55)',
                  fontSize: 22, lineHeight: 1,
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  padding: '4px 8px',
                }}
              >
                ×
              </button>
            </div>

            {/* Messages scroller */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                padding: '4px 16px 0',
              }}
            >
              {messages.length === 0 && !sending && (
                <div style={{
                  padding: '32px 4px 20px',
                  textAlign: 'center',
                  fontFamily: 'Satoshi, sans-serif',
                  fontSize: 14,
                  color: 'rgba(255,255,255,0.5)',
                  lineHeight: 1.5,
                }}>
                  {welcomeMessage}
                </div>
              )}

              {messages.map(msg => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onFlyToVenue={onFlyToVenue}
                  onClose={onClose}
                  planStates={planStates}
                  onSavePlan={handleSavePlan}
                  onSharePlan={handleSharePlan}
                  visitedStopIndices={visitedStopIndices}
                />
              ))}

              {error && (
                <div style={{
                  margin: '4px 0 8px',
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(255, 80, 60, 0.08)',
                  border: '1px solid rgba(255, 80, 60, 0.3)',
                  color: '#FFB8AC',
                  fontFamily: 'Satoshi, sans-serif',
                  fontSize: 13,
                }}>
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} style={{ height: 12 }} />
            </div>

            {/* Suggestion chips (only when empty AND not at MINI) */}
            {messages.length === 0 && snapPoint !== 'mini' && (
              <div style={{
                display: 'flex', gap: 8, overflowX: 'auto',
                padding: '4px 16px 8px', flexShrink: 0,
                WebkitOverflowScrolling: 'touch',
              }}>
                {suggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSuggestionTap(s)}
                    style={{
                      flexShrink: 0,
                      padding: '8px 14px',
                      borderRadius: 18,
                      background: 'rgba(255, 130, 0, 0.08)',
                      border: '1px solid rgba(255, 130, 0, 0.3)',
                      color: '#FFB888',
                      fontFamily: 'Satoshi, sans-serif',
                      fontSize: 13, fontWeight: 500,
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Composer */}
            <div style={{
              padding: '8px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              background: 'rgba(8, 8, 12, 0.92)',
              flexShrink: 0,
              display: 'flex', gap: 8, alignItems: 'flex-end',
            }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="ask Venny anything..."
                rows={1}
                style={{
                  flex: 1,
                  minHeight: 40,
                  maxHeight: 120,
                  padding: '10px 14px',
                  borderRadius: 20,
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: 'white',
                  fontFamily: 'Satoshi, sans-serif',
                  fontSize: 14,
                  outline: 'none',
                  resize: 'none',
                  WebkitAppearance: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => send(input)}
                disabled={!input.trim() || sending}
                aria-label="Send"
                style={{
                  width: 40, height: 40,
                  borderRadius: 20,
                  background: input.trim() && !sending ? '#FF8200' : 'rgba(255, 130, 0, 0.25)',
                  border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: input.trim() && !sending ? 'pointer' : 'default',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'background 160ms ease-out',
                  flexShrink: 0,
                }}
              >
                {sending ? (
                  <div style={{
                    width: 14, height: 14,
                    borderRadius: 7,
                    border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: 'white',
                    animation: 'venny-spin 0.8s linear infinite',
                  }} />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 8 L13 2 L9.5 8 L13 14 Z" fill="white" />
                  </svg>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Message rendering ─────────────────────────────────────────────

function MessageBubble({
  message,
  onFlyToVenue,
  onClose,
  planStates,
  onSavePlan,
  onSharePlan,
  visitedStopIndices,
}: {
  message: VennyMessage;
  onFlyToVenue: (venueId: string, lng: number, lat: number) => void;
  onClose: () => void;
  planStates: Record<string, PlanSaveState>;
  onSavePlan: (planMsgId: string, plan: Plan) => void;
  onSharePlan: (plan: Plan) => void;
  visitedStopIndices?: number[];
}) {
  const isUser = message.role === 'user';
  const showsLiveDot = !isUser && message.metadata?.used_live_data === true;
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: '88%',
        display: 'flex', flexDirection: 'column', gap: 8,
        alignItems: isUser ? 'flex-end' : 'flex-start',
      }}>
        {message.blocks.map((block, i) => {
          if (block.type === 'text') {
            if (!block.text && message.streaming) {
              return <TypingDots key={i} />;
            }
            if (!block.text) return null;
            // Pulse dot only on the FIRST visible text block — keeps
            // multi-block answers from showing duplicate indicators.
            const isFirstText = i === message.blocks.findIndex(b => b.type === 'text');
            const renderLiveDot = showsLiveDot && isFirstText;
            return (
              <div key={i} style={{
                padding: '10px 14px',
                borderRadius: 16,
                background: isUser
                  ? 'rgba(255, 130, 0, 0.18)'
                  : 'rgba(255, 255, 255, 0.06)',
                border: isUser
                  ? '1px solid rgba(255, 130, 0, 0.32)'
                  : '1px solid rgba(255, 255, 255, 0.06)',
                color: isUser ? '#FFD9B8' : 'rgba(255,255,255,0.92)',
                fontFamily: 'Satoshi, sans-serif',
                fontSize: 14,
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {block.text}
                {renderLiveDot && (
                  <span
                    className="venny-live-indicator"
                    aria-label="Venny is reading the market right now"
                    title="Live market data"
                  >
                    <span className="venny-live-indicator__dot" />
                  </span>
                )}
                {message.streaming && i === message.blocks.length - 1 && (
                  <span style={{
                    display: 'inline-block', width: 6, height: 14,
                    marginLeft: 2, verticalAlign: 'middle',
                    background: 'rgba(255,255,255,0.6)',
                    animation: 'venny-cursor 0.9s steps(2) infinite',
                  }} />
                )}
              </div>
            );
          }
          if (block.type === 'venues') {
            return (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                width: '100%',
              }}>
                {block.venues.map(v => (
                  <VenueResultCard
                    key={v.id}
                    venue={v}
                    onTap={() => {
                      hapticMedium();
                      if (typeof v.lng === 'number' && typeof v.lat === 'number') {
                        onFlyToVenue(v.id, v.lng, v.lat);
                      }
                      onClose();
                    }}
                  />
                ))}
              </div>
            );
          }
          if (block.type === 'plan') {
            const state = planStates[block.planMsgId] ?? 'idle';
            return (
              <div key={i} style={{ width: '100%' }}>
                <PlanCard
                  plan={block.plan}
                  onSave={() => onSavePlan(block.planMsgId, block.plan)}
                  onShare={() => onSharePlan(block.plan)}
                  saved={state === 'saved'}
                  saving={state === 'saving'}
                  visitedStopIndices={visitedStopIndices}
                />
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{
      padding: '10px 14px',
      borderRadius: 16,
      background: 'rgba(255, 255, 255, 0.06)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      display: 'inline-flex',
      gap: 4,
    }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 6, height: 6, borderRadius: 3,
            background: 'rgba(255,255,255,0.55)',
            animation: `venny-dot 1.1s ${i * 0.15}s infinite ease-in-out`,
          }}
        />
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

interface SSEEvent {
  type: string;
  id?: string;
  delta?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  message?: string;
  [k: string]: unknown;
}

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: SSEEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames separated by blank line. Handle both \n\n and \r\n\r\n.
    let sepIdx: number;
    while ((sepIdx = indexOfDoubleNewline(buffer)) !== -1) {
      const frame = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx).replace(/^(\r?\n){2}/, '');
      const parsed = parseSSEFrame(frame);
      if (parsed) onEvent(parsed);
    }
  }
  if (buffer.trim().length) {
    const parsed = parseSSEFrame(buffer);
    if (parsed) onEvent(parsed);
  }
}

function indexOfDoubleNewline(s: string): number {
  const a = s.indexOf('\n\n');
  const b = s.indexOf('\r\n\r\n');
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseSSEFrame(frame: string): SSEEvent | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  try {
    const parsed = JSON.parse(dataStr);
    if (event && !parsed.type) parsed.type = event;
    return parsed as SSEEvent;
  } catch {
    return event ? { type: event, raw: dataStr } : null;
  }
}

function appendTextToAssistant(
  prev: VennyMessage[],
  asstId: string,
  delta: string | undefined,
): VennyMessage[] {
  if (!delta) return prev;
  return prev.map(m => {
    if (m.id !== asstId) return m;
    const last = m.blocks[m.blocks.length - 1];
    if (last && last.type === 'text') {
      const updated = [...m.blocks];
      updated[updated.length - 1] = { type: 'text', text: last.text + delta };
      return { ...m, blocks: updated };
    }
    return { ...m, blocks: [...m.blocks, { type: 'text', text: delta }] };
  });
}

function appendVenuesToAssistant(
  prev: VennyMessage[],
  asstId: string,
  venues: VenueResult[],
): VennyMessage[] {
  return prev.map(m => {
    if (m.id !== asstId) return m;
    return { ...m, blocks: [...m.blocks, { type: 'venues', venues }] };
  });
}

function appendPlanToAssistant(
  prev: VennyMessage[],
  asstId: string,
  plan: Plan,
  planMsgId: string,
): VennyMessage[] {
  return prev.map(m => {
    if (m.id !== asstId) return m;
    return { ...m, blocks: [...m.blocks, { type: 'plan', plan, planMsgId }] };
  });
}

// Convert a venny_messages row from the DB into our local VennyMessage(s).
// History rows carry the raw Anthropic content blocks; we extract text +
// search_venues tool results so the rendered history matches what the
// user originally saw.
interface DbVennyRow {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: unknown;
  metadata?: VennyMessageMetadata | null;
}

function rowToMessages(row: DbVennyRow): VennyMessage[] {
  if (row.role === 'tool') return []; // tool turns folded into the assistant
  const blocks = extractBlocks(row.content);
  if (blocks.length === 0) return [];
  const out: VennyMessage = {
    id: row.id,
    role: row.role,
    blocks,
  };
  if (row.metadata && typeof row.metadata === 'object') {
    out.metadata = row.metadata;
  }
  return [out];
}

function extractBlocks(content: unknown): MessageContent[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: MessageContent[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      out.push({ type: 'text', text: block.text });
    }
  }
  return out;
}

export const VennySheet = memo(VennySheetInner);
