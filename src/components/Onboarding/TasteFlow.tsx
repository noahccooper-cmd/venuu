import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { ArrowRight, Check, X as XIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hapticLight, hapticMedium, hapticSuccess } from '../../lib/haptics';
import type { Profile } from '../../lib/types';

/**
 * TasteFlow — Tinder-style structured taste calibration.
 *
 * Seven steps:
 *   0  welcome    — start / skip
 *   1  age        — three preset chips
 *   2  vibes      — 8 swipe cards (drag right = like, left = skip)
 *   3  music      — multi-select chips, min 3
 *   4  budget     — three stacked cards, single-select
 *   5  dress      — three horizontal cards, single-select
 *   6  group      — four cards, single-select
 *   7  completion — preview + write + "Let's plan a night →"
 *
 * Submit writes everything to user_preferences via upsert keyed on
 * auth.users.id (the existing 00027 schema). Venny will pick up the
 * new data on its next get_user_taste tool call — no edge function
 * redeploy required.
 */

const FONT = 'Satoshi, sans-serif';

// Step keys give us readable transition + completion logic.
type StepKey =
  | 'welcome' | 'age' | 'vibes' | 'music' | 'budget'
  | 'dress'   | 'group' | 'done';

const STEP_ORDER: StepKey[] = [
  'welcome', 'age', 'vibes', 'music', 'budget', 'dress', 'group', 'done',
];

// ─── Vibe catalog ────────────────────────────────────────────────
interface VibeCard {
  key: string;
  emoji: string;
  title: string;
  body: string;
}
const VIBES: VibeCard[] = [
  { key: 'cocktails',  emoji: '🍸', title: 'Cocktails',  body: 'craft drinks, ambient lighting' },
  { key: 'dancing',    emoji: '💃', title: 'Dancing',    body: 'feet hurt by 2am energy' },
  { key: 'dive bar',   emoji: '🍺', title: 'Dive Bar',   body: 'cheap drinks, no pretense' },
  { key: 'rooftop',    emoji: '🏙️', title: 'Rooftop',   body: 'views and vibes' },
  { key: 'live music', emoji: '🎸', title: 'Live Music', body: 'bands, energy, sweat' },
  { key: 'sports bar', emoji: '🏈', title: 'Sports Bar', body: 'screens, beer, wings' },
  { key: 'chill',      emoji: '🛋️', title: 'Chill',     body: 'conversations, low-key' },
  { key: 'frat',       emoji: '🎓', title: 'Frat',       body: 'house parties, college energy' },
];

const MUSIC_GENRES = [
  'hip-hop', 'edm', 'country', 'pop',
  'rock',    'indie', 'latin',  'r&b',
] as const;

type AgeBucket = '21-24' | '25-29' | '30+';
type BudgetTier = '$' | '$$' | '$$$';
type DressStyle = 'chill' | 'smart' | 'dressy';
type GroupSize = 'solo' | 'couple' | 'small' | 'big';

function ageBucketToInt(b: AgeBucket): number {
  if (b === '21-24') return 22;
  if (b === '25-29') return 27;
  return 32;
}

function groupSizeToInt(g: GroupSize): number {
  if (g === 'solo')   return 1;
  if (g === 'couple') return 2;
  if (g === 'small')  return 4;
  return 8;
}

interface TasteFlowProps {
  open: boolean;
  onClose: () => void;
  /** auth.users.id — user_preferences keys on this (not profile.id). */
  userId: string | null;
  profile: Profile | null;
  /** Called when the user finishes the flow AND successfully writes.
   *  Parent typically uses this to open the Venny pill so the user
   *  can immediately put their taste to work. */
  onCompleted?: () => void;
}

function TasteFlowInner({ open, onClose, userId, profile, onCompleted }: TasteFlowProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEP_ORDER[stepIdx];

  // Selections
  const [ageBucket, setAgeBucket] = useState<AgeBucket | null>(null);
  const [vibeIdx, setVibeIdx] = useState(0);
  const [vibesLiked, setVibesLiked] = useState<string[]>([]);
  const [vibesSkipped, setVibesSkipped] = useState<string[]>([]);
  const [musicGenres, setMusicGenres] = useState<string[]>([]);
  const [budget, setBudget] = useState<BudgetTier | null>(null);
  const [dressStyle, setDressStyle] = useState<DressStyle | null>(null);
  const [groupSize, setGroupSize] = useState<GroupSize | null>(null);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const advance = useCallback(() => {
    hapticLight();
    setStepIdx(prev => Math.min(prev + 1, STEP_ORDER.length - 1));
  }, []);

  const back = useCallback(() => {
    hapticLight();
    setStepIdx(prev => Math.max(0, prev - 1));
  }, []);

  const reset = useCallback(() => {
    setStepIdx(0);
    setAgeBucket(null);
    setVibeIdx(0);
    setVibesLiked([]);
    setVibesSkipped([]);
    setMusicGenres([]);
    setBudget(null);
    setDressStyle(null);
    setGroupSize(null);
    setSubmitting(false);
    setSubmitError(null);
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    // Reset for next open. Done in a microtask so the closing
    // animation reads the current step rather than flashing welcome.
    queueMicrotask(reset);
  }, [onClose, reset]);

  // ── Vibe card swipe handlers ──
  const handleVibeSwipe = useCallback((direction: 'left' | 'right') => {
    const card = VIBES[vibeIdx];
    if (!card) return;
    if (direction === 'right') {
      hapticMedium();
      setVibesLiked(prev => (prev.includes(card.key) ? prev : [...prev, card.key]));
    } else {
      hapticLight();
      setVibesSkipped(prev => (prev.includes(card.key) ? prev : [...prev, card.key]));
    }
    if (vibeIdx + 1 >= VIBES.length) {
      // All cards swiped → onto music.
      advance();
    } else {
      setVibeIdx(prev => prev + 1);
    }
  }, [vibeIdx, advance]);

  const toggleMusic = useCallback((g: string) => {
    hapticLight();
    setMusicGenres(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
    );
  }, []);

  // ── Submit on Step 7 (done) ──
  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!userId) {
      setSubmitError('You need to be signed in.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);

    const row: Record<string, unknown> = {
      user_id: userId,
      age: ageBucket ? ageBucketToInt(ageBucket) : null,
      music_taste: musicGenres.join(','),
      typical_budget: budget,
      dress_style: dressStyle,
      group_size_typical: groupSize ? groupSizeToInt(groupSize) : null,
      vibes_liked: vibesLiked,
      vibes_disliked: vibesSkipped,
      home_city: profile?.city ?? null,
      updated_at: new Date().toISOString(),
    };

    try {
      const { error } = await supabase
        .from('user_preferences')
        .upsert(row, { onConflict: 'user_id' });
      if (error) {
        console.warn('[taste_flow] upsert failed:', error.message);
        setSubmitError(error.message);
        setSubmitting(false);
        return;
      }
      void hapticSuccess();
      setSubmitting(false);
      onCompleted?.();
      handleClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'something went wrong';
      console.warn('[taste_flow] upsert threw:', msg);
      setSubmitError(msg);
      setSubmitting(false);
    }
  }, [submitting, userId, ageBucket, musicGenres, budget, dressStyle, groupSize, vibesLiked, vibesSkipped, profile?.city, onCompleted, handleClose]);

  // ── Per-step enable gates for the bottom Next/Done CTA ──
  const canAdvance = useMemo(() => {
    switch (step) {
      case 'welcome': return true;
      case 'age':     return ageBucket != null;
      case 'vibes':   return vibeIdx >= VIBES.length;
      case 'music':   return musicGenres.length >= 3;
      case 'budget':  return budget != null;
      case 'dress':   return dressStyle != null;
      case 'group':   return groupSize != null;
      case 'done':    return true;
    }
  }, [step, ageBucket, vibeIdx, musicGenres.length, budget, dressStyle, groupSize]);

  const progressPct = Math.round((stepIdx / (STEP_ORDER.length - 1)) * 100);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2500,
            background: '#0A0A14',
            display: 'flex',
            flexDirection: 'column',
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            fontFamily: FONT,
          }}
        >
          {/* Top bar — progress + close */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '12px 16px 8px', gap: 12,
            flexShrink: 0,
          }}>
            {stepIdx > 0 && step !== 'done' ? (
              <button
                type="button"
                onClick={back}
                aria-label="Back"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: 22, lineHeight: 1, padding: 4,
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                ‹
              </button>
            ) : (
              <span style={{ width: 30 }} />
            )}

            {/* Progress bar */}
            <div style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${progressPct}%`,
                height: '100%',
                background: 'var(--brand-orange)',
                transition: 'width 280ms cubic-bezier(0.2, 0.9, 0.3, 1)',
              }} />
            </div>

            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--text-muted)',
                padding: 4,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <XIcon size={18} strokeWidth={1.8} />
            </button>
          </div>

          {/* Body */}
          <div style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '8px 24px 12px',
            display: 'flex', flexDirection: 'column',
          }}>
            {step === 'welcome' && <WelcomeStep />}
            {step === 'age' && (
              <AgeStep value={ageBucket} onChange={setAgeBucket} />
            )}
            {step === 'vibes' && (
              <VibesStep
                index={vibeIdx}
                liked={vibesLiked}
                onSwipe={handleVibeSwipe}
              />
            )}
            {step === 'music' && (
              <MusicStep value={musicGenres} onToggle={toggleMusic} />
            )}
            {step === 'budget' && (
              <BudgetStep value={budget} onChange={setBudget} />
            )}
            {step === 'dress' && (
              <DressStep value={dressStyle} onChange={setDressStyle} />
            )}
            {step === 'group' && (
              <GroupStep value={groupSize} onChange={setGroupSize} />
            )}
            {step === 'done' && (
              <DoneStep
                ageBucket={ageBucket}
                vibesLiked={vibesLiked}
                budget={budget}
                groupSize={groupSize}
                username={profile?.username ?? ''}
                city={profile?.city ?? ''}
                submitting={submitting}
                error={submitError}
                onSubmit={handleSubmit}
              />
            )}
          </div>

          {/* Bottom CTA for non-swipe steps */}
          {step !== 'vibes' && step !== 'done' && (
            <div style={{
              flexShrink: 0,
              padding: '12px 24px 20px',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <button
                type="button"
                onClick={step === 'welcome' ? advance : advance}
                disabled={!canAdvance}
                style={{
                  width: '100%',
                  height: 52,
                  borderRadius: 14,
                  background: canAdvance ? 'var(--brand-orange)' : 'rgba(255, 130, 0, 0.32)',
                  border: 'none',
                  color: 'white',
                  fontFamily: FONT, fontSize: 16, fontWeight: 700,
                  cursor: canAdvance ? 'pointer' : 'default',
                  WebkitTapHighlightColor: 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  letterSpacing: '-0.01em',
                }}
              >
                {step === 'welcome' ? 'Start' : 'Next'}
                <ArrowRight size={18} strokeWidth={2} />
              </button>
              {step === 'welcome' && (
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--text-muted)',
                    fontFamily: FONT, fontSize: 13, fontWeight: 500,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    padding: 8,
                  }}
                >
                  Skip for now
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Welcome step ────────────────────────────────────────────────
function WelcomeStep() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: 60, lineHeight: 1, marginBottom: 18 }}>✨</div>
      <h1 style={{
        fontFamily: FONT, fontSize: 26, fontWeight: 800,
        color: 'var(--text-primary)', margin: 0,
        letterSpacing: '-0.02em',
      }}>
        Set up your taste
      </h1>
      <p style={{
        fontFamily: FONT, fontSize: 14,
        color: 'var(--text-secondary)',
        margin: '12px 0 0', lineHeight: 1.5,
        maxWidth: 320,
      }}>
        Swipe right on what you like, left on what you don't. Venny will use this to plan way better nights.
      </p>
    </div>
  );
}

// ─── Age step ─────────────────────────────────────────────────────
function AgeStep({ value, onChange }: { value: AgeBucket | null; onChange: (v: AgeBucket) => void }) {
  const opts: { key: AgeBucket; label: string }[] = [
    { key: '21-24', label: '21–24' },
    { key: '25-29', label: '25–29' },
    { key: '30+',   label: '30+' },
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', gap: 22 }}>
      <h2 style={{
        fontFamily: FONT, fontSize: 22, fontWeight: 800,
        color: 'var(--text-primary)', margin: 0,
        letterSpacing: '-0.01em',
      }}>
        How old are you?
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {opts.map(o => {
          const selected = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => { hapticLight(); onChange(o.key); }}
              style={{
                width: '100%',
                padding: '16px 14px',
                borderRadius: 14,
                background: selected ? 'var(--brand-orange-tint)' : 'var(--bg-glass)',
                border: selected
                  ? '1.5px solid var(--brand-orange)'
                  : '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontFamily: FONT, fontSize: 17, fontWeight: 700,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                letterSpacing: '-0.01em',
                transition: 'background 160ms ease, border-color 160ms ease',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Vibes (Tinder) step ─────────────────────────────────────────
function VibesStep({
  index,
  liked,
  onSwipe,
}: {
  index: number;
  liked: string[];
  onSwipe: (direction: 'left' | 'right') => void;
}) {
  const card = VIBES[index];
  const remaining = VIBES.length - index;

  if (!card) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{
          fontFamily: FONT, fontSize: 18, fontWeight: 700,
          color: 'var(--text-primary)', margin: 0,
        }}>
          Got it — {liked.length} liked
        </p>
      </div>
    );
  }

  const handleDragEnd = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const dx = info.offset.x;
    if (dx > 80) onSwipe('right');
    else if (dx < -80) onSwipe('left');
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, paddingTop: 8 }}>
      <p style={{
        fontFamily: FONT, fontSize: 12, fontWeight: 600,
        color: 'var(--text-muted)', margin: 0,
        letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
        {index + 1}/{VIBES.length}
      </p>
      <h2 style={{
        fontFamily: FONT, fontSize: 18, fontWeight: 700,
        color: 'var(--text-primary)', margin: 0,
        textAlign: 'center', letterSpacing: '-0.01em',
      }}>
        swipe right if you like it
      </h2>

      {/* Card stack — current card + a peek of the next one behind it. */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 340, height: 360, flexShrink: 0 }}>
        {/* Peek card (next in line) */}
        {remaining > 1 && (
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0,
              top: 14, transform: 'scale(0.95)',
              borderRadius: 22,
              background: 'var(--bg-glass)',
              border: '1px solid var(--border-subtle)',
              opacity: 0.45,
            }}
          />
        )}

        {/* Top card — drag-aware */}
        <motion.div
          key={card.key}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.8}
          onDragEnd={handleDragEnd}
          whileTap={{ cursor: 'grabbing' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ x: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          style={{
            position: 'absolute', inset: 0,
            borderRadius: 22,
            background: 'linear-gradient(180deg, rgba(255, 130, 0, 0.10), rgba(15, 15, 22, 0.92))',
            border: '1px solid var(--brand-orange-tint-strong)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.55), 0 0 24px rgba(255, 130, 0, 0.18)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '32px 24px',
            gap: 14,
            cursor: 'grab',
            touchAction: 'pan-y',
          }}
        >
          <div style={{ fontSize: 72, lineHeight: 1 }}>{card.emoji}</div>
          <p style={{
            fontFamily: FONT, fontSize: 24, fontWeight: 800,
            color: 'var(--text-primary)', margin: 0,
            letterSpacing: '-0.02em',
            textAlign: 'center',
          }}>
            {card.title}
          </p>
          <p style={{
            fontFamily: FONT, fontSize: 14,
            color: 'var(--text-secondary)',
            margin: 0, textAlign: 'center',
            lineHeight: 1.4, maxWidth: 240,
          }}>
            {card.body}
          </p>
        </motion.div>
      </div>

      {/* Tap buttons — fallback for users who don't realize they can drag */}
      <div style={{ display: 'flex', gap: 18 }}>
        <button
          type="button"
          onClick={() => onSwipe('left')}
          aria-label="Skip"
          style={{
            width: 56, height: 56, borderRadius: 28,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid var(--border-subtle)',
            color: '#FF8080',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <XIcon size={22} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => onSwipe('right')}
          aria-label="Like"
          style={{
            width: 56, height: 56, borderRadius: 28,
            background: 'var(--brand-orange)',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
            boxShadow: '0 0 18px rgba(255, 130, 0, 0.5)',
          }}
        >
          <Check size={22} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

// ─── Music step ───────────────────────────────────────────────────
function MusicStep({ value, onToggle }: { value: string[]; onToggle: (g: string) => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', gap: 18 }}>
      <h2 style={{
        fontFamily: FONT, fontSize: 22, fontWeight: 800,
        color: 'var(--text-primary)', margin: 0,
        letterSpacing: '-0.01em',
      }}>
        What music gets you out?
      </h2>
      <p style={{
        fontFamily: FONT, fontSize: 12,
        color: 'var(--text-muted)', margin: 0,
      }}>
        Pick 3 or more
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
        {MUSIC_GENRES.map(g => {
          const selected = value.includes(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => onToggle(g)}
              style={{
                padding: '12px 18px',
                borderRadius: 999,
                background: selected ? 'var(--brand-orange)' : 'var(--bg-glass)',
                border: selected
                  ? '1.5px solid var(--brand-orange)'
                  : '1px solid var(--border-subtle)',
                color: selected ? 'white' : 'var(--text-primary)',
                fontFamily: FONT, fontSize: 14, fontWeight: 700,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                letterSpacing: '-0.01em',
                transition: 'background 160ms ease, border-color 160ms ease',
              }}
            >
              {g}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Budget step ──────────────────────────────────────────────────
function BudgetStep({ value, onChange }: { value: BudgetTier | null; onChange: (v: BudgetTier) => void }) {
  const opts: { key: BudgetTier; title: string; body: string }[] = [
    { key: '$',   title: 'Keep it cheap',   body: 'well drinks, no cover' },
    { key: '$$',  title: 'Solid night out', body: 'craft cocktails, maybe cover' },
    { key: '$$$', title: 'Treat yo self',   body: 'rooftop, top-shelf, no limits' },
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
      <h2 style={{
        fontFamily: FONT, fontSize: 22, fontWeight: 800,
        color: 'var(--text-primary)', margin: 0,
        textAlign: 'center', letterSpacing: '-0.01em',
      }}>
        What's your usual spend?
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {opts.map(o => {
          const selected = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => { hapticLight(); onChange(o.key); }}
              style={{
                width: '100%',
                padding: '18px 16px',
                borderRadius: 16,
                background: selected ? 'var(--brand-orange-tint)' : 'var(--bg-glass)',
                border: selected
                  ? '2px solid var(--brand-orange)'
                  : '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                display: 'flex', alignItems: 'center', gap: 14,
                textAlign: 'left',
                transform: selected ? 'scale(1.02)' : 'scale(1)',
                transition: 'transform 180ms ease, background 160ms ease, border 160ms ease',
                font: 'inherit',
              }}
            >
              <span style={{
                fontFamily: FONT, fontSize: 28, fontWeight: 800,
                color: 'var(--brand-orange)', flexShrink: 0,
                minWidth: 44, textAlign: 'center',
              }}>
                {o.key}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontFamily: FONT, fontSize: 15, fontWeight: 700,
                  color: 'var(--text-primary)', margin: 0,
                  letterSpacing: '-0.01em',
                }}>
                  {o.title}
                </p>
                <p style={{
                  fontFamily: FONT, fontSize: 12,
                  color: 'var(--text-secondary)', margin: '2px 0 0',
                }}>
                  {o.body}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dress step ───────────────────────────────────────────────────
function DressStep({ value, onChange }: { value: DressStyle | null; onChange: (v: DressStyle) => void }) {
  const opts: { key: DressStyle; emoji: string; title: string; body: string }[] = [
    { key: 'chill',  emoji: '👕', title: 'Chill',  body: 'tshirts and jeans' },
    { key: 'smart',  emoji: '👔', title: 'Smart',  body: 'nice but not formal' },
    { key: 'dressy', emoji: '🥂', title: 'Dressy', body: "i'm dressing up" },
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
      <h2 style={{
        fontFamily: FONT, fontSize: 22, fontWeight: 800,
        color: 'var(--text-primary)', margin: 0,
        textAlign: 'center', letterSpacing: '-0.01em',
      }}>
        Dress code?
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {opts.map(o => {
          const selected = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => { hapticLight(); onChange(o.key); }}
              style={{
                padding: '18px 8px 14px',
                borderRadius: 16,
                background: selected ? 'var(--brand-orange-tint)' : 'var(--bg-glass)',
                border: selected
                  ? '2px solid var(--brand-orange)'
                  : '1px solid var(--border-subtle)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                transform: selected ? 'scale(1.04)' : 'scale(1)',
                transition: 'transform 180ms ease, background 160ms ease, border 160ms ease',
                color: 'var(--text-primary)',
                font: 'inherit',
              }}
            >
              <span style={{ fontSize: 32, lineHeight: 1 }}>{o.emoji}</span>
              <p style={{
                fontFamily: FONT, fontSize: 14, fontWeight: 700,
                color: 'var(--text-primary)', margin: 0,
                letterSpacing: '-0.01em',
              }}>
                {o.title}
              </p>
              <p style={{
                fontFamily: FONT, fontSize: 11,
                color: 'var(--text-secondary)', margin: 0,
                textAlign: 'center', lineHeight: 1.3,
              }}>
                {o.body}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Group step ───────────────────────────────────────────────────
function GroupStep({ value, onChange }: { value: GroupSize | null; onChange: (v: GroupSize) => void }) {
  const opts: { key: GroupSize; emoji: string; title: string; body: string }[] = [
    { key: 'solo',   emoji: '🧍', title: 'Solo',        body: 'just me' },
    { key: 'couple', emoji: '💕', title: 'Couple',      body: 'two of us' },
    { key: 'small',  emoji: '👥', title: 'Small Group', body: '3–5 friends' },
    { key: 'big',    emoji: '🎉', title: 'Big Group',   body: '6+ rowdy' },
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
      <h2 style={{
        fontFamily: FONT, fontSize: 22, fontWeight: 800,
        color: 'var(--text-primary)', margin: 0,
        textAlign: 'center', letterSpacing: '-0.01em',
      }}>
        Usual squad size?
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {opts.map(o => {
          const selected = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => { hapticLight(); onChange(o.key); }}
              style={{
                padding: '20px 12px 16px',
                borderRadius: 16,
                background: selected ? 'var(--brand-orange-tint)' : 'var(--bg-glass)',
                border: selected
                  ? '2px solid var(--brand-orange)'
                  : '1px solid var(--border-subtle)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                transform: selected ? 'scale(1.03)' : 'scale(1)',
                transition: 'transform 180ms ease, background 160ms ease, border 160ms ease',
                color: 'var(--text-primary)',
                font: 'inherit',
              }}
            >
              <span style={{ fontSize: 30, lineHeight: 1 }}>{o.emoji}</span>
              <p style={{
                fontFamily: FONT, fontSize: 14, fontWeight: 700,
                color: 'var(--text-primary)', margin: 0,
              }}>
                {o.title}
              </p>
              <p style={{
                fontFamily: FONT, fontSize: 11,
                color: 'var(--text-secondary)', margin: 0,
              }}>
                {o.body}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Done step ────────────────────────────────────────────────────
function DoneStep({
  ageBucket, vibesLiked, budget, groupSize, username, city,
  submitting, error, onSubmit,
}: {
  ageBucket: AgeBucket | null;
  vibesLiked: string[];
  budget: BudgetTier | null;
  groupSize: GroupSize | null;
  username: string;
  city: string;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const summaryBits = useMemo(() => {
    const parts: string[] = [];
    if (vibesLiked.length) parts.push(vibesLiked.slice(0, 3).join(' + '));
    if (budget) parts.push(budget);
    if (groupSize) parts.push(
      groupSize === 'solo' ? 'solo'
      : groupSize === 'couple' ? 'couple'
      : groupSize === 'small' ? 'small group'
      : 'big group'
    );
    return parts.join(' · ');
  }, [vibesLiked, budget, groupSize]);

  const handle = username ? `@${username}` : 'you';
  const cityLabel = city ? city.replace('_', ' ') : '';

  // Celebration — fire confetti + scale burst + haptic exactly once,
  // when the user lands on Step 7. Subsequent re-renders (e.g. an
  // error retry) don't re-trigger because the effect is gated by an
  // empty deps array. Haptic is a no-op on web.
  useEffect(() => {
    void hapticMedium();
    const t = window.setTimeout(() => {
      // Cleanup is implicit — the CSS classes self-terminate.
    }, 2200);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div style={{
      flex: 1,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', gap: 18,
      position: 'relative',
    }}>
      {/* Radial orange glow behind the content — one-time pulse */}
      <div
        aria-hidden
        className="taste-done-glow"
        style={{
          position: 'absolute', inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(circle at 50% 30%, rgba(255, 130, 0, 0.35), rgba(255, 130, 0, 0) 60%)',
        }}
      />

      {/* Confetti burst — 14 dots, staggered, falling from above */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, height: 320,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className="taste-confetti-dot"
            style={{
              left: `${(i * 7) + 6}%`,
              animationDelay: `${(i % 7) * 90}ms`,
              background: i % 3 === 0 ? '#FFFFFF' : i % 3 === 1 ? '#FF8200' : '#FFB888',
            }}
          />
        ))}
      </div>

      <div style={{ fontSize: 60, lineHeight: 1, zIndex: 1 }}>✨</div>
      <h1 style={{
        fontFamily: FONT, fontSize: 26, fontWeight: 800,
        color: 'var(--text-primary)', margin: 0,
        letterSpacing: '-0.02em',
        zIndex: 1,
      }}>
        you're calibrated
      </h1>
      <p style={{
        fontFamily: FONT, fontSize: 14,
        color: 'var(--text-secondary)', margin: 0,
        zIndex: 1,
      }}>
        venny knows your vibe
      </p>

      {/* Summary preview card — one-shot scale-burst on mount. */}
      <div
        className="taste-summary-burst"
        style={{
          marginTop: 10,
          width: '100%',
          maxWidth: 320,
          background: 'var(--bg-glass)',
          border: '1px solid var(--brand-orange-tint-strong)',
          borderRadius: 16,
          padding: '14px 16px',
          textAlign: 'left',
          boxShadow: '0 0 18px rgba(255, 130, 0, 0.18)',
          zIndex: 1,
        }}
      >
        <p style={{
          fontFamily: FONT, fontSize: 13, fontWeight: 600,
          color: 'var(--brand-orange)', margin: 0,
          letterSpacing: '-0.01em',
        }}>
          {handle}
        </p>
        <p style={{
          fontFamily: FONT, fontSize: 14,
          color: 'var(--text-primary)', margin: '4px 0 0',
          lineHeight: 1.4,
        }}>
          {summaryBits || 'taste captured'}
        </p>
        {(ageBucket || cityLabel) && (
          <p style={{
            fontFamily: FONT, fontSize: 12,
            color: 'var(--text-muted)', margin: '4px 0 0',
          }}>
            {[ageBucket, cityLabel].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {error && (
        <p style={{
          fontFamily: FONT, fontSize: 13,
          color: '#FF8080', margin: 0,
        }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        style={{
          marginTop: 6,
          width: '100%', maxWidth: 320,
          height: 52,
          borderRadius: 14,
          background: submitting ? 'rgba(255, 130, 0, 0.4)' : 'var(--brand-orange)',
          border: 'none',
          color: 'white',
          fontFamily: FONT, fontSize: 16, fontWeight: 700,
          cursor: submitting ? 'default' : 'pointer',
          WebkitTapHighlightColor: 'transparent',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          letterSpacing: '-0.01em',
        }}
      >
        {submitting ? 'saving…' : "Let's plan a night"}
        {!submitting && <ArrowRight size={18} strokeWidth={2} />}
      </button>
    </div>
  );
}

export const TasteFlow = memo(TasteFlowInner);
