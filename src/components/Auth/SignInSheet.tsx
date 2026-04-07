import { useState } from 'react';
import { Loader2 } from 'lucide-react';

interface SignInSheetProps {
  onClose: () => void;
  onSignedIn: () => void;
  signInWithApple: () => Promise<{ error: Error | null | unknown }>;
}

export function SignInSheet({ onClose, onSignedIn, signInWithApple }: SignInSheetProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAppleSignIn = async () => {
    setLoading(true);
    setError('');

    const { error: err } = await signInWithApple();
    setLoading(false);

    if (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      // User cancelled — don't show error
      if (message.includes('cancel') || message.includes('Cancel')) return;
      setError(message);
    } else {
      onSignedIn();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[998] bg-black/60 backdrop-blur-sm animate-[fadeIn_200ms_ease-out]"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[999] bg-[#111114] rounded-t-[28px] animate-[slideUp_300ms_ease-out]"
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-[#2A2A30]" />
        </div>

        <div className="px-6 pt-4 pb-4 flex flex-col items-center">
          {/* Logo */}
          <h1
            className="text-3xl font-black tracking-[-0.5px] mb-3"
            style={{ fontFamily: 'Satoshi, sans-serif', color: '#FF8200' }}
          >
            venuu
          </h1>

          {/* Subtitle */}
          <p
            className="text-[#8A8A95] text-sm text-center mb-8 max-w-[260px]"
            style={{ fontFamily: 'Satoshi, sans-serif' }}
          >
            Sign in to check in, earn rewards, and more
          </p>

          {/* Apple Sign In Button */}
          <button
            type="button"
            onClick={handleAppleSignIn}
            disabled={loading}
            className="w-full max-w-sm h-[52px] rounded-xl font-semibold text-white text-base flex items-center justify-center gap-3 bg-black border border-[#2A2A30] transition-all active:scale-[0.98] disabled:opacity-60"
            style={{ fontFamily: 'Satoshi, sans-serif', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            {loading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                {/* Apple logo SVG */}
                <svg width="18" height="22" viewBox="0 0 18 22" fill="white">
                  <path d="M17.0703 17.3047C16.7812 18.0078 16.4375 18.6562 16.0391 19.2578C15.4922 20.0703 15.0469 20.6406 14.707 20.9688C14.1758 21.4922 13.6055 21.7617 12.9922 21.7812C12.5547 21.7812 12.0312 21.6562 11.4258 21.4023C10.8164 21.1523 10.2578 21.0273 9.74609 21.0273C9.20703 21.0273 8.62891 21.1523 8.01172 21.4023C7.39062 21.6562 6.89844 21.7852 6.52734 21.793C5.94141 21.8086 5.35938 21.5312 4.78125 20.9609C4.41406 20.6055 3.94922 20.0117 3.39062 19.1797C2.78906 18.2891 2.29688 17.2578 1.91016 16.082C1.49609 14.8164 1.28906 13.5898 1.28906 12.4023C1.28906 11.0508 1.56641 9.88281 2.12109 8.90234C2.55469 8.12891 3.13281 7.51953 3.85938 7.07422C4.58594 6.62891 5.37109 6.40234 6.21484 6.39062C6.67969 6.39062 7.28516 6.53516 8.03516 6.82031C8.78125 7.10547 9.26172 7.25 9.47266 7.25C9.62891 7.25 10.1641 7.07812 11.0703 6.73828C11.9258 6.42578 12.6484 6.29688 13.2422 6.34766C14.9102 6.48438 16.1602 7.16406 16.9883 8.39453C15.5039 9.30469 14.7695 10.5703 14.7852 12.1875C14.8008 13.4609 15.2891 14.5273 16.2461 15.3828C16.6797 15.7891 17.1602 16.1055 17.6914 16.332C17.4961 16.8789 17.2891 17.4023 17.0703 17.3047ZM13.3516 0.441406C13.3516 1.44141 12.9883 2.37109 12.2656 3.22656C11.3945 4.24219 10.3398 4.82422 9.19922 4.73438C9.18359 4.61328 9.17578 4.48438 9.17578 4.34766C9.17578 3.39062 9.59375 2.36328 10.3281 1.52734C10.6953 1.10547 11.1602 0.75 11.7227 0.460938C12.2812 0.175781 12.8125 0.0195312 13.3125 0C13.3281 0.148438 13.3516 0.296875 13.3516 0.441406Z" />
                </svg>
                Sign in with Apple
              </>
            )}
          </button>

          {/* Error message */}
          {error && (
            <p
              className="text-[#FF2D05] text-xs mt-3 text-center"
              style={{ fontFamily: 'Satoshi, sans-serif' }}
            >
              {error}
            </p>
          )}

          {/* Maybe later */}
          <button
            type="button"
            onClick={onClose}
            className="mt-5 text-[#55555F] text-sm transition-colors active:text-[#8A8A95]"
            style={{ fontFamily: 'Satoshi, sans-serif', minHeight: 44, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            Maybe later
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
