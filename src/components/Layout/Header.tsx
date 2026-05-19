import { useRef, useEffect, useState, useCallback } from 'react';
import type { CityKey } from '../../lib/constants';
import { CityToggle } from './CityToggle';

/**
 * Header — the top strip. Pre-Ship-1.2 contained an avatar button as
 * the entry point to ProfileScreen. The bottom nav now owns the
 * "You" tab, so the avatar was redundant clutter and is removed.
 *
 * Layout: venuu wordmark + live counter on the left, city dropdown
 * on the right (Portal tab swaps the right side for a small Portal
 * label).
 */

interface HeaderProps {
  city: CityKey;
  onCityChange: (city: CityKey) => void;
  totalCount: number;
  activeTab?: string;
}

export function Header({ city, onCityChange, totalCount, activeTab }: HeaderProps) {
  const isPortal = activeTab === 'portal';

  // Animated total count
  const [displayCount, setDisplayCount] = useState(totalCount);
  const prevCountRef = useRef(totalCount);
  const animFrameRef = useRef(0);
  const [fireScale, setFireScale] = useState(1);

  const animateTo = useCallback((from: number, to: number) => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    const diff = to - from;
    const absDiff = Math.abs(diff);
    const effectiveFrom = absDiff > 10 ? to - Math.sign(diff) * 3 : from;
    const duration = 600;
    const start = performance.now();
    const range = to - effectiveFrom;

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayCount(Math.round(effectiveFrom + range * eased));
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    }
    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (totalCount !== prevCountRef.current) {
      animateTo(prevCountRef.current, totalCount);
      // Fire emoji pulse
      setFireScale(1.3);
      const timer = setTimeout(() => setFireScale(1), 300);
      prevCountRef.current = totalCount;
      return () => clearTimeout(timer);
    }
  }, [totalCount, animateTo]);

  useEffect(() => {
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 bg-[#050507]"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        zIndex: 1000,
      }}>
      <div className="pt-2 pb-2 flex items-center justify-between"
        style={{ paddingLeft: 'max(20px, env(safe-area-inset-left, 20px))', paddingRight: '16px' }}>
        <div>
          <h1
            style={{
              fontFamily: 'Satoshi, sans-serif',
              color: '#FF8200',
              fontSize: '28px',
              fontWeight: 800,
              letterSpacing: '-0.5px',
              lineHeight: 1,
            }}
          >
            venuu
          </h1>
          <p
            style={{
              fontFamily: 'Satoshi, sans-serif',
              fontSize: '15px',
              marginTop: '4px',
              lineHeight: 1,
            }}
          >
            {displayCount > 0 ? (
              <>
                <span style={{
                  display: 'inline-block',
                  transform: `scale(${fireScale})`,
                  transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
                }}>
                  {'🔥'}
                </span>{' '}
                <span style={{ color: '#fff', fontWeight: 700 }}>
                  {displayCount}
                </span>{' '}
                <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                  people out right now
                </span>
              </>
            ) : (
              <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                No one out yet tonight
              </span>
            )}
          </p>
        </div>
        {isPortal ? (
          <span style={{
            fontFamily: 'Satoshi, sans-serif',
            fontSize: '13px',
            fontWeight: 700,
            color: 'rgba(255,255,255,0.35)',
            letterSpacing: '1px',
            textTransform: 'uppercase',
          }}>
            Portal
          </span>
        ) : (
          <CityToggle city={city} onChange={onCityChange} />
        )}
      </div>
    </header>
  );
}
