import { useState, useCallback } from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { supabase, envReady } from '../../lib/supabase';
import { CITIES, type CityKey } from '../../lib/constants';

interface OnboardScreenProps {
  onComplete: (username: string, classYear: number, city: CityKey) => Promise<{ error: unknown }>;
}

const CLASS_YEARS = [2025, 2026, 2027, 2028, 2029];

export function OnboardScreen({ onComplete }: OnboardScreenProps) {
  const [username, setUsername] = useState('');
  const [classYear, setClassYear] = useState(2027);
  const [city, setCity] = useState<CityKey>('knoxville');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  const checkUsername = useCallback(async (name: string) => {
    if (!envReady || name.length < 3) {
      setUsernameStatus('idle');
      return;
    }

    setUsernameStatus('checking');
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', name.toLowerCase())
      .single();

    setUsernameStatus(data ? 'taken' : 'available');
  }, []);

  const handleUsernameChange = (value: string) => {
    const clean = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
    setUsername(clean);
    if (clean.length >= 3) {
      const timeout = setTimeout(() => checkUsername(clean), 400);
      return () => clearTimeout(timeout);
    } else {
      setUsernameStatus('idle');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.length < 3 || usernameStatus === 'taken') return;

    setLoading(true);
    setError('');

    const { error: err } = await onComplete(username, classYear, city);
    setLoading(false);

    if (err) {
      setError('Username might be taken or something went wrong. Try again.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
      <h2 className="text-white font-bold text-2xl mb-1" style={{ fontFamily: 'Satoshi, sans-serif' }}>
        Welcome to venuu
      </h2>
      <p className="text-[#8A8A95] text-sm mb-8" style={{ fontFamily: 'Satoshi, sans-serif' }}>
        Set up your profile
      </p>

      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div>
          <label className="text-[#8A8A95] text-xs font-medium mb-1.5 block" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            Pick a username
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#55555F] text-sm">@</span>
            <input
              type="text"
              value={username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              placeholder="username"
              maxLength={24}
              className="w-full h-12 pl-9 pr-10 bg-[#111114] border border-[#2A2A30] rounded-xl text-white text-sm placeholder-[#55555F] outline-none focus:border-[#FF5E1A] transition-colors"
              style={{ fontFamily: 'Satoshi, sans-serif' }}
            />
            {usernameStatus === 'available' && (
              <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#00E676]" />
            )}
            {usernameStatus === 'taken' && (
              <X size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#FF2D05]" />
            )}
          </div>
          {usernameStatus === 'taken' && (
            <p className="text-[#FF2D05] text-xs mt-1" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              Username taken
            </p>
          )}
        </div>

        <div>
          <label className="text-[#8A8A95] text-xs font-medium mb-1.5 block" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            Class year
          </label>
          <select
            value={classYear}
            onChange={(e) => setClassYear(Number(e.target.value))}
            className="w-full h-12 px-4 bg-[#111114] border border-[#2A2A30] rounded-xl text-white text-sm outline-none focus:border-[#FF5E1A] transition-colors appearance-none"
            style={{ fontFamily: 'Satoshi, sans-serif' }}
          >
            {CLASS_YEARS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[#8A8A95] text-xs font-medium mb-1.5 block" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            Your city
          </label>
          <select
            value={city}
            onChange={(e) => setCity(e.target.value as CityKey)}
            className="w-full h-12 px-4 bg-[#111114] border border-[#2A2A30] rounded-xl text-white text-sm outline-none focus:border-[#FF5E1A] transition-colors appearance-none"
            style={{ fontFamily: 'Satoshi, sans-serif' }}
          >
            {(Object.keys(CITIES) as CityKey[]).map((c) => (
              <option key={c} value={c}>{CITIES[c].name}, {CITIES[c].state}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="text-[#FF2D05] text-xs text-center" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || username.length < 3 || usernameStatus === 'taken'}
          className="w-full h-[52px] rounded-xl font-bold text-white text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
          style={{
            fontFamily: 'Satoshi, sans-serif',
            background: '#FF8200',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : "LET'S GO"}
        </button>
      </form>
    </div>
  );
}
