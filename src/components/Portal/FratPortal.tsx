import { useState, useEffect, useCallback } from 'react';
import { Minus, Plus, LogOut } from 'lucide-react';
import { formatCount, formatTime } from '../../lib/utils';
import type { Venue, Headcount } from '../../lib/types';
import type { EndNightSummary } from '../../hooks/usePortal';
import { EventCreator } from './EventCreator';
import { CoverPortalSection } from './CoverPortalSection';

const FONT = 'Satoshi, sans-serif';
const GOLD = '#C9A96E';

interface FratPortalProps {
  venue: Venue;
  headcount: Headcount | null;
  lastAction: { type: string; time: string } | null;
  endSummary: EndNightSummary | null;
  onEnter: (count?: number) => Promise<void>;
  onExit: (count?: number) => Promise<void>;
  onEndNight: () => Promise<void>;
  onDisconnect: () => void;
}

export function FratPortal({
  venue, headcount, lastAction, endSummary,
  onEnter, onExit, onEndNight, onDisconnect,
}: FratPortalProps) {
  const [flashClass, setFlashClass] = useState('');
  const [bumpKey, setBumpKey] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const count = headcount?.current_count ?? 0;
  const peak = headcount?.peak_count ?? 0;
  const isLive = headcount?.is_live ?? false;

  // Wake lock
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    const req = async () => { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {} };
    req();
    return () => { wakeLock?.release(); };
  }, []);

  const handleEnter = useCallback(async (n = 1) => {
    setFlashClass('clicker-flash-enter');
    setBumpKey(prev => prev + 1);
    if (navigator.vibrate) navigator.vibrate(40);
    setTimeout(() => setFlashClass(''), 400);
    await onEnter(n);
  }, [onEnter]);

  const handleExit = useCallback(async (n = 1) => {
    setFlashClass('clicker-flash-exit');
    setBumpKey(prev => prev + 1);
    if (navigator.vibrate) navigator.vibrate(40);
    setTimeout(() => setFlashClass(''), 400);
    await onExit(n);
  }, [onExit]);

  const handleEndNight = useCallback(async () => {
    setConfirmEnd(false);
    await onEndNight();
  }, [onEndNight]);

  // End of night summary
  if (endSummary) {
    return (
      <div className="min-h-screen bg-[#050507] flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h1 style={{ fontFamily: FONT, color: GOLD, fontSize: 28, fontWeight: 800, marginBottom: 24 }}>
            {venue.name}
          </h1>
          <div style={{ background: '#111114', border: `1px solid ${GOLD}40`, borderRadius: 16, padding: 24 }}>
            <p style={{ fontFamily: FONT, fontSize: 13, color: '#8A8A95', marginBottom: 8 }}>Tonight's Peak</p>
            <span style={{ fontFamily: FONT, fontSize: 48, fontWeight: 800, color: GOLD }}>
              {formatCount(endSummary.peakCount)}
            </span>
            <p style={{ fontFamily: FONT, fontSize: 12, color: '#55555F', marginTop: 8 }}>
              at {formatTime(endSummary.peakTime)}
            </p>
          </div>
          <button onClick={onDisconnect} className="active:scale-[0.98] transition-transform" style={{
            width: '100%', height: 52, borderRadius: 12, marginTop: 24,
            background: GOLD, color: '#1a1a2e', fontWeight: 700, fontSize: 16, border: 'none', cursor: 'pointer', fontFamily: FONT,
          }}>
            DONE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-[#050507] flex flex-col ${flashClass}`}
      style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none', touchAction: 'manipulation', paddingBottom: 120 }}>

      {/* Header */}
      <div className="px-5 pt-3 pb-2 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 76px)' }}>
        <div>
          <h1 style={{ fontFamily: FONT, fontSize: 22, fontWeight: 800, color: GOLD, letterSpacing: '0.05em' }}>
            {venue.name}
          </h1>
          {venue.address && (
            <p style={{ fontFamily: FONT, fontSize: 12, color: '#55555F' }}>{venue.address}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isLive && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full live-dot" style={{ background: GOLD }} />
              <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: GOLD }}>LIVE</span>
            </div>
          )}
          <button onClick={onDisconnect} className="p-2 rounded-lg bg-[#111114] text-[#55555F] hover:text-white transition-colors"
            style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LogOut size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Headcount Display */}
      <div className="flex flex-col items-center justify-center px-6" style={{ padding: '16px 24px' }}>
        <div key={bumpKey} className="count-bump">
          <span style={{ fontFamily: FONT, fontSize: 64, fontWeight: 900, color: GOLD, lineHeight: 1 }}>
            {formatCount(count)}
          </span>
        </div>
        <p style={{ fontFamily: FONT, fontSize: 14, color: '#8A8A95', marginTop: 4 }}>inside right now</p>
        {peak > 0 && headcount?.updated_at && (
          <p style={{ fontFamily: FONT, fontSize: 12, color: '#55555F', marginTop: 4 }}>
            Peak: {formatCount(peak)} at {formatTime(headcount.updated_at)}
          </p>
        )}
      </div>

      {/* Clicker Buttons */}
      <div className="px-4 pb-2">
        <div className="flex gap-3">
          <button onClick={() => handleExit()} className="flex-1 flex flex-col items-center justify-center gap-1 active:scale-[0.97] transition-transform"
            style={{ height: 100, backgroundColor: '#5C1A1A', borderRadius: 16 }}>
            <Minus size={32} strokeWidth={2.5} className="text-white" />
            <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: 'white', letterSpacing: '0.05em' }}>EXIT</span>
          </button>
          <button onClick={() => handleEnter()} className="flex-1 flex flex-col items-center justify-center gap-1 active:scale-[0.97] transition-transform"
            style={{ height: 100, background: GOLD, borderRadius: 16 }}>
            <Plus size={32} strokeWidth={2.5} className="text-white" />
            <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: '#1a1a2e', letterSpacing: '0.05em' }}>ENTER</span>
          </button>
        </div>
        <div className="clicker-bulk-row">
          <button onClick={() => handleExit(5)} className="clicker-bulk minus">-5</button>
          <button onClick={() => handleExit(2)} className="clicker-bulk minus">-2</button>
          <button onClick={() => handleEnter(2)} className="clicker-bulk plus" style={{ background: `${GOLD}30`, color: GOLD, border: `1px solid ${GOLD}50` }}>+2</button>
          <button onClick={() => handleEnter(5)} className="clicker-bulk plus" style={{ background: `${GOLD}30`, color: GOLD, border: `1px solid ${GOLD}50` }}>+5</button>
        </div>

        {lastAction && (
          <p style={{ fontFamily: FONT, fontSize: 12, color: '#55555F', textAlign: 'center', marginTop: 8 }}>
            Last: {lastAction.type} at {formatTime(lastAction.time)}
          </p>
        )}

        {/* End Night */}
        <div style={{ marginTop: 12 }}>
          {confirmEnd ? (
            <div className="flex flex-col gap-2">
              <p style={{ fontFamily: FONT, fontSize: 14, color: '#8A8A95', textAlign: 'center' }}>
                End tracking for {venue.name} tonight?
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmEnd(false)} style={{ flex: 1, height: 48, borderRadius: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)', fontFamily: FONT, fontSize: 16, fontWeight: 500 }}>Cancel</button>
                <button onClick={handleEndNight} style={{ flex: 1, height: 48, borderRadius: 12, background: '#FF2D05', border: 'none', color: 'white', fontFamily: FONT, fontSize: 16, fontWeight: 700 }}>End Tracking</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmEnd(true)} style={{
              width: '100%', height: 48, borderRadius: 12, background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)',
              fontFamily: FONT, fontSize: 16, fontWeight: 500,
            }}>
              End Night
            </button>
          )}
        </div>

        {/* Cover Pricing */}
        <CoverPortalSection venue={venue} />

        {/* Event Creator */}
        <EventCreator venue={venue} />
      </div>
    </div>
  );
}
