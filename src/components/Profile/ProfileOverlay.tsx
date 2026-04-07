import { useState } from 'react';
import { X, MapPin } from 'lucide-react';
import type { CityKey } from '../../lib/constants';

interface ProfileOverlayProps {
  open: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
  needsOnboard: boolean;
  onSendMagicLink: (email: string) => Promise<{ error: unknown }>;
  onCompleteOnboard: (username: string, classYear: number, city: CityKey) => Promise<{ error: unknown }>;
  onBrowseAsGuest: () => void;
}

const FONT = 'Satoshi, sans-serif';

export function ProfileOverlay({
  open,
  onClose,
  isLoggedIn,
  needsOnboard,
  onSendMagicLink,
  onCompleteOnboard,
  onBrowseAsGuest,
}: ProfileOverlayProps) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [classYear, setClassYear] = useState('2026');
  const [linkSent, setLinkSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSendLink = async () => {
    if (!email.includes('@')) return;
    setLoading(true);
    setError('');
    const result = await onSendMagicLink(email);
    setLoading(false);
    if (result.error) {
      setError('Failed to send link. Try again.');
    } else {
      setLinkSent(true);
    }
  };

  const handleOnboard = async () => {
    if (!username.trim() || username.length < 3) return;
    setLoading(true);
    setError('');
    const result = await onCompleteOnboard(username.trim(), parseInt(classYear), 'knoxville');
    setLoading(false);
    if (result.error) {
      setError('Username may be taken. Try another.');
    }
  };

  const handleGuest = () => {
    onBrowseAsGuest();
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[80] bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-[90] bg-[#0A0A0C] border-l border-[#2A2A30]"
        style={{
          width: 'min(340px, 85vw)',
          animation: 'slide-in-right 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)' }}>
          <h2 className="text-white font-bold text-lg" style={{ fontFamily: FONT }}>
            Profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-[#111114] text-[#8A8A95] hover:text-white transition-colors"
            style={{ WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 pb-8" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* ═══ Needs onboarding ═══ */}
          {isLoggedIn && needsOnboard && (
            <div className="space-y-4">
              <p className="text-white font-bold text-base" style={{ fontFamily: FONT }}>
                Create your profile
              </p>
              <div>
                <label className="text-[#8A8A95] text-xs mb-1 block" style={{ fontFamily: FONT }}>Username</label>
                <input
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  maxLength={20}
                  placeholder="username"
                  className="w-full h-11 rounded-xl bg-[#111114] border border-[#2A2A30] px-4 text-white text-sm outline-none focus:border-[#FF5E1A] transition-colors"
                  style={{ fontFamily: FONT }}
                />
              </div>
              <div>
                <label className="text-[#8A8A95] text-xs mb-1 block" style={{ fontFamily: FONT }}>Class year</label>
                <select
                  value={classYear}
                  onChange={e => setClassYear(e.target.value)}
                  className="w-full h-11 rounded-xl bg-[#111114] border border-[#2A2A30] px-4 text-white text-sm outline-none focus:border-[#FF5E1A] transition-colors"
                  style={{ fontFamily: FONT }}
                >
                  {[2024, 2025, 2026, 2027, 2028, 2029].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              {error && <p className="text-[#FF2D05] text-xs" style={{ fontFamily: FONT }}>{error}</p>}
              <button
                type="button"
                onClick={handleOnboard}
                disabled={loading || username.length < 3}
                className="w-full rounded-xl font-bold text-white text-sm transition-all active:scale-[0.98] disabled:opacity-50"
                style={{
                  fontFamily: FONT,
                  height: 48,
                  background: '#FF8200',
                  border: 'none',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {loading ? 'Creating...' : 'Create Profile'}
              </button>
            </div>
          )}

          {/* ═══ Not logged in ═══ */}
          {!isLoggedIn && (
            <div className="space-y-4">
              {!linkSent ? (
                <>
                  <p className="text-white font-bold text-base" style={{ fontFamily: FONT }}>
                    Sign in to check in & chat
                  </p>
                  <div>
                    <input
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      type="email"
                      placeholder="your@email.edu"
                      className="w-full h-11 rounded-xl bg-[#111114] border border-[#2A2A30] px-4 text-white text-sm outline-none focus:border-[#FF5E1A] transition-colors"
                      style={{ fontFamily: FONT }}
                      onKeyDown={e => e.key === 'Enter' && handleSendLink()}
                    />
                  </div>
                  {error && <p className="text-[#FF2D05] text-xs" style={{ fontFamily: FONT }}>{error}</p>}
                  <button
                    type="button"
                    onClick={handleSendLink}
                    disabled={loading || !email.includes('@')}
                    className="w-full rounded-xl font-bold text-white text-sm transition-all active:scale-[0.98] disabled:opacity-50"
                    style={{
                      fontFamily: FONT,
                      height: 48,
                      background: '#FF8200',
                      border: 'none',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {loading ? 'Sending...' : 'Send Magic Link'}
                  </button>
                  <div className="flex items-center gap-3 my-2">
                    <div className="flex-1 h-px bg-[#2A2A30]" />
                    <span className="text-[#55555F] text-xs" style={{ fontFamily: FONT }}>or</span>
                    <div className="flex-1 h-px bg-[#2A2A30]" />
                  </div>
                  <button
                    type="button"
                    onClick={handleGuest}
                    className="w-full rounded-xl bg-[#111114] border border-[#2A2A30] text-[#8A8A95] text-sm font-medium flex items-center justify-center gap-2 hover:text-white transition-colors"
                    style={{
                      fontFamily: FONT,
                      height: 48,
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <MapPin size={14} strokeWidth={1.5} />
                    Browse as Guest
                  </button>
                </>
              ) : (
                <div className="text-center py-6">
                  <p className="text-white font-bold text-base mb-2" style={{ fontFamily: FONT }}>
                    Check your email
                  </p>
                  <p className="text-[#8A8A95] text-sm" style={{ fontFamily: FONT }}>
                    We sent a magic link to {email}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
