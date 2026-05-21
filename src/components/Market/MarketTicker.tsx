import { useState, useEffect } from 'react';
import { useTonightMovers, type TonightMover } from '../../hooks/useTonightMovers';
import { useCityPulse } from '../../hooks/useCityPulse';
import './MarketTicker.css';

interface MarketTickerProps {
  city: string | null;
  onVenueTap?: (venue: TonightMover) => void;
}

/**
 * MarketTicker — Bloomberg-style horizontal scroll just below the
 * City Pulse Line. Auto-scrolls right-to-left over ~30 s for a full
 * loop. Pauses on touch. Tap an entry to fly the camera + spotlight
 * the venue (handled upstream via onVenueTap).
 *
 * Mood tinting: background tints by city avg delta — warm when the
 * city is hot, cool when it's cold, neutral otherwise. Mover bars
 * use the locked palette (mint up, wine red down).
 *
 * Self-hides when there are no movers of meaningful magnitude
 * (>= 10% absolute delta) or when city is null.
 */
export function MarketTicker({ city, onVenueTap }: MarketTickerProps) {
  const { risers, fallers } = useTonightMovers(city, 6);
  const { pulse } = useCityPulse(city);
  const [paused, setPaused] = useState(false);

  // Hide at globe zoom in unison with the other pills (broadcast by
  // TonightPage). MarketTicker had no zoom logic of its own before.
  const [isAtGlobe, setIsAtGlobe] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => setIsAtGlobe((e as CustomEvent).detail.isAtGlobe);
    window.addEventListener('venuu:globe-state', handler as EventListener);
    return () => window.removeEventListener('venuu:globe-state', handler as EventListener);
  }, []);

  if (!city) return null;

  const allMovers = [...risers, ...fallers]
    .filter(m => Math.abs(m.delta_pct) >= 3)
    .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));

  if (allMovers.length === 0) return null;

  const cityAvg = pulse?.avg_delta_pct ?? 0;
  const tintClass =
    cityAvg >= 15 ? 'market-ticker--hot' :
    cityAvg <= -10 ? 'market-ticker--cool' :
    'market-ticker--neutral';

  // Duplicate entries so the keyframe -50% translate seamlessly loops.
  const tickerEntries = [...allMovers, ...allMovers];

  return (
    <div
      className={`market-ticker ${tintClass}`}
      style={{
        opacity: isAtGlobe ? 0 : 1,
        pointerEvents: isAtGlobe ? 'none' : 'auto',
        transition: 'opacity 0.3s ease',
      }}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      onTouchCancel={() => setPaused(false)}
    >
      <div
        className={`market-ticker__track${paused ? ' market-ticker__track--paused' : ''}`}
      >
        {tickerEntries.map((m, i) => {
          const sign = m.delta_pct >= 0 ? '+' : '';
          const direction = m.delta_pct >= 0 ? 'up' : 'down';
          return (
            <button
              type="button"
              key={`${m.venue_id}-${i}`}
              className="market-ticker__entry"
              onClick={() => onVenueTap?.(m)}
              aria-label={`${m.venue_name} ${direction} ${Math.abs(m.delta_pct).toFixed(0)} percent`}
            >
              <span className="market-ticker__name">
                {m.venue_name.replace(/^The\s+/i, '').toUpperCase()}
              </span>
              <span className={`market-ticker__delta market-ticker__delta--${direction}`}>
                {direction === 'up' ? '▲' : '▼'}
                {sign}{Math.round(m.delta_pct)}%
              </span>
              <span className="market-ticker__sep" aria-hidden>·</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
