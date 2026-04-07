import { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface NicknameScreenProps {
  onComplete: (username: string) => Promise<{ error: unknown }>;
}

const FONT = 'Satoshi, sans-serif';
const MAX_LEN = 20;

export function NicknameScreen({ onComplete }: NicknameScreenProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fade in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, MAX_LEN);
    setName(raw);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (clean.length < 2) return;

    setLoading(true);
    setError('');
    const { error: err } = await onComplete(clean);
    setLoading(false);

    if (err) {
      setError('That name is taken — try another.');
    }
  };

  const canSubmit = name.length >= 2 && !loading;

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
          What should we call you?
        </p>
        <p style={{
          color: '#8A8A95',
          fontSize: 14,
          textAlign: 'center',
          margin: '0 0 32px',
          lineHeight: 1.4,
        }}>
          Pick a nickname — lowercase letters, numbers, underscores
        </p>

        <form onSubmit={handleSubmit}>
          {/* Input + char counter */}
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
                padding: '0 52px 0 16px',
                outline: 'none',
                boxSizing: 'border-box',
                WebkitTapHighlightColor: 'transparent',
                transition: 'border-color 200ms ease',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#FF8200'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#2A2A3A'; }}
            />
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

          {/* Continue button */}
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
            {loading ? <Loader2 size={20} className="animate-spin" /> : 'Continue →'}
          </button>
        </form>
      </div>
    </div>
  );
}
