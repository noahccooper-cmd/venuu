import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';

const FONT = 'Satoshi, sans-serif';

interface VenueOption {
  id: string;
  name: string;
}

interface PortalLoginProps {
  cities: string[];
  selectedCity: string | null;
  onCityChange: (city: string) => void;
  venues: VenueOption[];
  loading: boolean;
  error: string;
  onSubmit: (venueId: string, pin: string) => Promise<{ error: string | null }>;
  onSecurityLogin: (orgCode: string) => Promise<{ error: string | null }>;
  loginMode: 'venue' | 'security';
  onToggleMode: (mode: 'venue' | 'security') => void;
}

export function PortalLogin({
  cities, selectedCity, onCityChange, venues, loading, error, onSubmit,
  onSecurityLogin, loginMode, onToggleMode,
}: PortalLoginProps) {
  const [selectedVenueId, setSelectedVenueId] = useState('');
  const [digits, setDigits] = useState(['', '', '', '']);
  const [shaking, setShaking] = useState(false);
  const [orgCode, setOrgCode] = useState('');
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (error) {
      setShaking(true);
      setDigits(['', '', '', '']);
      setTimeout(() => {
        setShaking(false);
        inputRefs.current[0]?.focus();
      }, 400);
    }
  }, [error]);

  useEffect(() => {
    if (selectedVenueId) inputRefs.current[0]?.focus();
  }, [selectedVenueId]);

  const handleDigitChange = useCallback((index: number, value: string) => {
    const digit = value.replace(/[^0-9]/g, '').slice(-1);
    setDigits(prev => { const next = [...prev]; next[index] = digit; return next; });
    if (digit && index < 3) inputRefs.current[index + 1]?.focus();
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus();
  }, [digits]);

  const pin = digits.join('');
  const canSubmit = selectedVenueId && pin.length === 4 && !loading;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit(selectedVenueId, pin);
  }, [canSubmit, selectedVenueId, pin, onSubmit]);

  const handleOrgSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgCode.trim() || orgLoading) return;
    setOrgLoading(true);
    setOrgError('');
    const result = await onSecurityLogin(orgCode.trim().toUpperCase());
    setOrgLoading(false);
    if (result.error) setOrgError(result.error);
  }, [orgCode, orgLoading, onSecurityLogin]);

  return (
    <div className="bg-[#050507] flex flex-col items-center justify-center px-6" style={{ flex: 1 }}>
      <div className="w-full max-w-sm" style={{ position: 'relative' }}>
        {/* Mode toggle — top right */}
        <button
          onClick={() => onToggleMode(loginMode === 'venue' ? 'security' : 'venue')}
          style={{
            position: 'absolute', top: -8, right: 0,
            width: 44, height: 44, borderRadius: 22,
            background: '#1C1C2E', border: '1px solid #333',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 20,
            transition: 'transform 0.2s',
          }}
          title={loginMode === 'venue' ? 'Switch to security login' : 'Switch to venue login'}
        >
          {loginMode === 'venue' ? '\uD83D\uDD12' : '\uD83D\uDEE1\uFE0F'}
        </button>

        {/* Header */}
        <div className="text-center mb-10">
          <h1 style={{ fontFamily: FONT, fontSize: '24px', fontWeight: 800, color: 'white' }}>
            {loginMode === 'venue' ? '\uD83D\uDD10 Bouncer Portal' : '\uD83D\uDEE1\uFE0F Security Portal'}
          </h1>
          <p style={{ fontFamily: FONT, fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginTop: '8px' }}>
            {loginMode === 'venue' ? 'Enter your venue code to start' : 'Enter your organization code'}
          </p>
        </div>

        {loginMode === 'venue' ? (
          /* ── VENUE PIN LOGIN ── */
          <form onSubmit={handleSubmit}>
            <div className="portal-select-wrap">
              <select
                value={selectedCity ?? ''}
                onChange={e => { onCityChange(e.target.value); setSelectedVenueId(''); }}
                className="portal-venue-select"
              >
                <option value="">Select your city...</option>
                {cities.map(c => (<option key={c} value={c}>{c}</option>))}
              </select>
              <ChevronDown size={18} className="portal-select-icon" />
            </div>

            <div className="portal-select-wrap">
              <select
                value={selectedVenueId}
                onChange={e => setSelectedVenueId(e.target.value)}
                disabled={!selectedCity}
                className="portal-venue-select"
                style={!selectedCity ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
              >
                <option value="">Select your venue...</option>
                {venues.map(v => (<option key={v.id} value={v.id}>{v.name}</option>))}
              </select>
              <ChevronDown size={18} className="portal-select-icon" />
            </div>

            <div className={`portal-pin-row ${shaking ? 'shake' : ''}`}>
              {[0, 1, 2, 3].map(i => (
                <input
                  key={i}
                  ref={el => { inputRefs.current[i] = el; }}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]"
                  maxLength={1}
                  value={digits[i]}
                  onChange={e => handleDigitChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  className="portal-pin-box"
                  autoComplete="off"
                />
              ))}
            </div>

            {error && (
              <p style={{ fontFamily: FONT, fontSize: '14px', color: '#FF2D05', textAlign: 'center', marginTop: '12px', fontWeight: 600 }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={!canSubmit} className="portal-clock-in-btn">
              {loading ? <Loader2 size={20} className="animate-spin" /> : 'CLOCK IN'}
            </button>
          </form>
        ) : (
          /* ── SECURITY ORG LOGIN ── */
          <form onSubmit={handleOrgSubmit}>
            <input
              type="text"
              value={orgCode}
              onChange={e => setOrgCode(e.target.value.toUpperCase())}
              placeholder="e.g. SHIELD"
              autoFocus
              style={{
                width: '100%', height: 52, borderRadius: 12,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
                padding: '0 16px', fontSize: 20, fontWeight: 700, color: 'white',
                textAlign: 'center', letterSpacing: 3, outline: 'none',
                boxSizing: 'border-box', fontFamily: FONT, textTransform: 'uppercase',
              }}
            />

            {orgError && (
              <p style={{ fontFamily: FONT, fontSize: '14px', color: '#FF2D05', textAlign: 'center', marginTop: '12px', fontWeight: 600 }}>
                {orgError}
              </p>
            )}

            <button
              type="submit"
              disabled={orgLoading || !orgCode.trim()}
              className="portal-clock-in-btn"
              style={{ marginTop: 16 }}
            >
              {orgLoading ? <Loader2 size={20} className="animate-spin" /> : 'LOGIN'}
            </button>
          </form>
        )}

        <div className="text-center mt-8">
          <p style={{ fontFamily: FONT, fontSize: '12px', color: '#55555F' }}>
            Don't have a code?
          </p>
          <p style={{ fontFamily: FONT, fontSize: '12px', color: '#8A8A95' }}>
            Contact us to get your bar on venuu
          </p>
        </div>
      </div>
    </div>
  );
}
