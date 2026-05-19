import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { supabase, envReady } from '../../lib/supabase';

interface NicknameScreenProps {
  onComplete: (username: string) => Promise<{ error: unknown }>;
}

const FONT = 'Satoshi, sans-serif';
const MAX_LEN = 20;

/**
 * NicknameScreen — the only thing we ask the user before they're in
 * the app. One input, one button. Class year and any further taste
 * questions are deferred to Venny so friction is paid in proportion
 * to engagement.
 *
 * The availability check is debounced + only fires at length ≥ 3 so
 * we don't spam Supabase on every keystroke and don't flicker the
 * status indicator while the user is still typing the obvious prefix.
 */

type AvailabilityStatus = 'idle' | 'checking' | 'available' | 'taken';

export function NicknameScreen({ onComplete }: NicknameScreenProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityStatus>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef<string>('');

  // Fade in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // ── Debounced availability check ────────────────────────────────
  const runCheck = useCallback(async (candidate: string) => {
    if (!envReady) {
      setAvailability('idle');
      return;
    }
    setAvailability('checking');
    const { data, error: queryErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', candidate)
      .maybeSingle();
    // Bail if the user kept typing while the request was in flight.
    if (lastCheckedRef.current !== candidate) return;
    if (queryErr) {
      // PGRST116 = no rows. Anything else is unexpected; treat as idle.
      setAvailability(queryErr.code === 'PGRST116' ? 'available' : 'idle');
      return;
    }
    setAvailability(data ? 'taken' : 'available');
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, MAX_LEN);
    setName(raw);
    setError('');

    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    if (raw.length < 3) {
      setAvailability('idle');
      lastCheckedRef.current = '';
      return;
    }
    lastCheckedRef.current = raw;
    checkTimerRef.current = setTimeout(() => runCheck(raw), 350);
  };

  // Cleanup
  useEffect(() => () => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (clean.length < 2 || availability === 'taken') return;

    setLoading(true);
    setError('');
    const { error: err } = await onComplete(clean);
    setLoading(false);

    if (err) {
      setError('That name is taken — try another.');
      setAvailability('taken');
    }
  };

  const canSubmit = name.length >= 2 && !loading && availability !== 'taken' && availability !== 'checking';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0A0A14',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px',
        fontFamily: FONT,
        opacity: visible ? 1 : 0,
        transition: 'opacity 300ms ease',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{
            color: '#FF8200',
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: '-0.5px',
            margin: 0,
            lineHeight: 1,
          }}>
            venuu
          </h1>
        </div>

        {/* Heading */}
        <p style={{
          color: '#fff',
          fontSize: 22,
          fontWeight: 700,
          textAlign: 'center',
          margin: '0 0 8px',
          letterSpacing: '-0.3px',
        }}>
          pick a username
        </p>
        <p style={{
          color: '#8A8A95',
          fontSize: 14,
          textAlign: 'center',
          margin: '0 0 32px',
          lineHeight: 1.4,
        }}>
          this is how venuu knows you
        </p>

        <form onSubmit={handleSubmit}>
          {/* Input + char counter + availability glyph */}
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={handleChange}
              placeholder="yourname"
              maxLength={MAX_LEN}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                height: 48,
                borderRadius: 12,
                background: '#1C1C2E',
                border: '1.5px solid #2A2A3A',
                color: '#fff',
                fontSize: 16,
                fontFamily: FONT,
                fontWeight: 600,
                padding: '0 76px 0 16px',
                outline: 'none',
                boxSizing: 'border-box',
                WebkitTapHighlightColor: 'transparent',
                transition: 'border-color 200ms ease',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#FF8200'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#2A2A3A'; }}
            />
            {/* Availability glyph */}
            <span style={{
              position: 'absolute',
              right: 38,
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}>
              {availability === 'checking' && (
                <Loader2 size={14} className="animate-spin" style={{ color: '#55555F' }} />
              )}
              {availability === 'available' && (
                <Check size={16} style={{ color: '#22C55E' }} />
              )}
              {availability === 'taken' && (
                <X size={16} style={{ color: '#FF4444' }} />
              )}
            </span>
            {/* Character counter */}
            <span style={{
              position: 'absolute',
              right: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              color: name.length >= MAX_LEN ? '#FF5E1A' : '#55555F',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: FONT,
              pointerEvents: 'none',
              userSelect: 'none',
            }}>
              {name.length}/{MAX_LEN}
            </span>
          </div>

          {/* Error */}
          {error && (
            <p style={{
              color: '#FF2D05',
              fontSize: 13,
              fontWeight: 600,
              textAlign: 'center',
              margin: '0 0 12px',
              fontFamily: FONT,
            }}>
              {error}
            </p>
          )}

          {/* Done button */}
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              width: '100%',
              height: 48,
              borderRadius: 12,
              background: '#FF8200',
              border: 'none',
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              fontFamily: FONT,
              cursor: canSubmit ? 'pointer' : 'default',
              opacity: canSubmit ? 1 : 0.5,
              transition: 'opacity 200ms ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: error ? 0 : 12,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : 'Done'}
          </button>
        </form>
      </div>
    </div>
  );
}
