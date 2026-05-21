import { useEffect, useState } from 'react';
import type { CityKey } from '../../lib/constants';
import { CityToggle } from './CityToggle';

/**
 * Header — the top strip: venuu wordmark on the left, city dropdown on
 * the right (Portal tab swaps the right side for a small Portal label).
 *
 * The live "people out" subtitle was removed — that count now lives in
 * the city pulse line (street zoom) and the centered globe card (globe
 * zoom), so the header stays a clean single row.
 */

interface HeaderProps {
  city: CityKey;
  onCityChange: (city: CityKey) => void;
  /** Accepted for call-site compatibility; no longer rendered in the header. */
  totalCount?: number;
  activeTab?: string;
}

export function Header({ city, onCityChange, activeTab }: HeaderProps) {
  const isPortal = activeTab === 'portal';

  // Hide the city selector at globe zoom on the tonight tab — at the
  // universe view the user is looking at all cities, not one. Driven by
  // the venuu:globe-state broadcast from TonightPage (single source).
  const [isAtGlobe, setIsAtGlobe] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => setIsAtGlobe((e as CustomEvent).detail.isAtGlobe);
    window.addEventListener('venuu:globe-state', handler as EventListener);
    return () => window.removeEventListener('venuu:globe-state', handler as EventListener);
  }, []);
  const concealAtGlobe = isAtGlobe && activeTab === 'tonight';

  return (
    <header className="fixed top-0 left-0 right-0 bg-[#050507]"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        zIndex: 1000,
      }}>
      <div className="pt-2 pb-2 flex items-center justify-between"
        style={{ paddingLeft: 'max(20px, env(safe-area-inset-left, 20px))', paddingRight: '16px' }}>
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
          <div style={{
            opacity: concealAtGlobe ? 0 : 1,
            pointerEvents: concealAtGlobe ? 'none' : 'auto',
            transition: 'opacity 0.3s ease',
          }}>
            <CityToggle city={city} onChange={onCityChange} />
          </div>
        )}
      </div>
    </header>
  );
}
