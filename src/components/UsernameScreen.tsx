import { useState } from 'react';

interface UsernameScreenProps {
  onComplete: (username: string) => void;
}

export function UsernameScreen({ onComplete }: UsernameScreenProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
    setName(raw);
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (clean.length < 3) { setError('At least 3 characters'); return; }
    if (clean.length > 16) { setError('Max 16 characters'); return; }
    localStorage.setItem('venue_username', clean);
    onComplete(clean);
  };

  return (
    <div className="min-h-screen bg-[#050507] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-white font-black text-3xl tracking-[0.05em] mb-3"
            style={{ fontFamily: 'Satoshi, sans-serif' }}>
            venuu
          </h1>
          <p className="text-[#8A8A95] text-base" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            your cheat code for nightlife
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-[#8A8A95] text-sm font-medium mb-2" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            Pick a username
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#55555F] text-lg font-bold"
              style={{ fontFamily: 'Satoshi, sans-serif' }}>@</span>
            <input
              type="text"
              value={name}
              onChange={handleChange}
              placeholder="yourname"
              maxLength={16}
              autoFocus
              className="w-full h-14 pl-10 pr-5 bg-[#111114] border border-[#2A2A30] rounded-xl text-white text-lg font-bold placeholder-[#333338] outline-none focus:border-[#FF5E1A] transition-colors"
              style={{ fontFamily: 'Satoshi, sans-serif' }}
            />
          </div>
          <p className="text-[#55555F] text-xs mt-2" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            3–16 characters, letters, numbers, underscores
          </p>

          {error && (
            <p className="text-[#FF2D05] text-sm text-center mt-3 font-medium" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={name.length < 3}
            className="w-full h-[52px] rounded-xl font-bold text-white text-base flex items-center justify-center transition-all active:scale-[0.98] disabled:opacity-40 mt-6"
            style={{
              fontFamily: 'Satoshi, sans-serif',
              background: '#FF8200',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            LET'S GO
          </button>
        </form>
      </div>
    </div>
  );
}
