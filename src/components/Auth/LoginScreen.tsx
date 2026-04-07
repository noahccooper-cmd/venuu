import { useState } from 'react';
import { Mail, ArrowRight, Loader2, MapPin } from 'lucide-react';

interface LoginScreenProps {
  onSendLink: (email: string) => Promise<{ error: unknown }>;
  onBrowseAsGuest: () => void;
}

export function LoginScreen({ onSendLink, onBrowseAsGuest }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError('');

    const { error: err } = await onSendLink(email.trim());
    setLoading(false);

    if (err) {
      setError('Something went wrong. Try again.');
    } else {
      setSent(true);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-[#FF5E1A15] flex items-center justify-center mb-6">
          <Mail size={28} strokeWidth={1.5} className="text-[#FF5E1A]" />
        </div>
        <h2 className="text-white font-bold text-2xl mb-2" style={{ fontFamily: 'Satoshi, sans-serif' }}>
          Check your email
        </h2>
        <p className="text-[#8A8A95] text-sm mb-1" style={{ fontFamily: 'Satoshi, sans-serif' }}>
          We sent a magic link to
        </p>
        <p className="text-white font-medium text-sm mb-6" style={{ fontFamily: 'Satoshi, sans-serif' }}>
          {email}
        </p>
        <p className="text-[#55555F] text-xs" style={{ fontFamily: 'Satoshi, sans-serif' }}>
          Click the link in the email to sign in.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
      <h1 className="text-white font-black text-3xl tracking-[0.05em] mb-2"
        style={{ fontFamily: 'Satoshi, sans-serif' }}>
        venuu
      </h1>
      <div className="text-center mb-8">
        <p className="text-[#8A8A95] text-sm leading-relaxed" style={{ fontFamily: 'Satoshi, sans-serif' }}>
          your cheat code for nightlife
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <div className="relative mb-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="w-full h-12 px-4 bg-[#111114] border border-[#2A2A30] rounded-xl text-white text-sm placeholder-[#55555F] outline-none focus:border-[#FF5E1A] transition-colors"
            style={{ fontFamily: 'Satoshi, sans-serif' }}
          />
        </div>

        {error && (
          <p className="text-[#FF2D05] text-xs mb-3 text-center" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="w-full h-[52px] rounded-xl font-bold text-white text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
          style={{
            fontFamily: 'Satoshi, sans-serif',
            background: '#FF8200',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {loading ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <>
              SEND MAGIC LINK
              <ArrowRight size={18} strokeWidth={2} />
            </>
          )}
        </button>

        <p className="text-center text-[#55555F] text-xs mt-4" style={{ fontFamily: 'Satoshi, sans-serif' }}>
          We'll send you a link to sign in. No password needed.
        </p>
      </form>

      {/* Guest mode */}
      <div className="w-full max-w-sm mt-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-[#2A2A30]" />
          <span className="text-[#55555F] text-xs" style={{ fontFamily: 'Satoshi, sans-serif' }}>or</span>
          <div className="flex-1 h-px bg-[#2A2A30]" />
        </div>
        <button
          type="button"
          onClick={onBrowseAsGuest}
          className="w-full h-12 rounded-xl font-medium text-[#8A8A95] text-sm flex items-center justify-center gap-2 bg-[#111114] border border-[#2A2A30] hover:border-[#55555F] transition-colors active:scale-[0.98]"
          style={{ fontFamily: 'Satoshi, sans-serif', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
        >
          <MapPin size={16} strokeWidth={1.5} />
          Browse as Guest
        </button>
      </div>
    </div>
  );
}
