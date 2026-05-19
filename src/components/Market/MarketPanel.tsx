import { useState, useEffect } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { useTonightMovers, type TonightMover } from '../../hooks/useTonightMovers';
import { useCityPulse } from '../../hooks/useCityPulse';
import './MarketPanel.css';

interface MarketPanelProps {
  city: string | null;
  active: boolean;
  onClose: () => void;
  onVenueTap: (venueId: string, venue: TonightMover) => void;
  spotlightVenueId: string | null;
}

/**
 * MarketPanel — the panel half of the Market View Mode signature
 * gesture. Shares `layoutId="market-pill"` with `MoversChip`, so the
 * chip morphs upward into this panel as a single continuous element.
 *
 * Compact: 280×~55vh, top-5 risers + city pulse delta.
 * Expanded: ~half-screen, top-10 risers + top-10 fallers.
 *
 * Drag up or right → expand. Drag down or left → collapse. Drag
 * hard left (>200px) while compact → close. Tap × → close. Tap a
 * row → bubble up the venue id so MapView can spotlight + flyTo.
 */
export function MarketPanel({
  city,
  active,
  onClose,
  onVenueTap,
  spotlightVenueId,
}: MarketPanelProps) {
  const { risers, fallers } = useTonightMovers(city, 10);
  const { pulse } = useCityPulse(city);
  const [expanded, setExpanded] = useState(false);

  // Reset expansion when panel closes, but only after the exit animation
  // has had time to settle — collapsing mid-exit causes a layout twitch.
  useEffect(() => {
    if (!active) {
      const t = window.setTimeout(() => setExpanded(false), 320);
      return () => window.clearTimeout(t);
    }
  }, [active]);

  if (!city) return null;

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const dx = info.offset.x;
    const dy = info.offset.y;
    if ((dx > 60 || dy < -60) && !expanded) {
      setExpanded(true);
    } else if ((dx < -60 || dy > 60) && expanded) {
      setExpanded(false);
    } else if (dx < -200 && !expanded) {
      onClose();
    }
  };

  const totalMovers = risers.length + fallers.length;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          layoutId="market-pill"
          className={`market-panel ${expanded ? 'market-panel--expanded' : 'market-panel--compact'}`}
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            layout: { type: 'spring', damping: 26, stiffness: 220 },
            opacity: { duration: 0.18 },
          }}
          drag
          dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
          dragElastic={0.18}
          dragMomentum={false}
          onDragEnd={handleDragEnd}
        >
          {/* HEADER — close + city pulse */}
          <motion.div
            className="market-panel__header"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.32 }}
          >
            <button
              type="button"
              className="market-panel__close"
              onClick={onClose}
              aria-label="Close market view"
            >
              ×
            </button>
            <div className="market-panel__title-block">
              <span className="market-panel__title">MARKET</span>
              {pulse && (
                <span
                  className={`market-panel__delta market-panel__delta--${pulse.avg_delta_pct >= 0 ? 'up' : 'down'}`}
                >
                  {pulse.avg_delta_pct >= 0 ? '+' : ''}{Math.round(pulse.avg_delta_pct)}%
                </span>
              )}
            </div>
          </motion.div>

          {/* BODY — leaderboard */}
          <motion.div
            className="market-panel__body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.22, duration: 0.4 }}
          >
            {risers.length > 0 && (
              <section className="market-section">
                <h3 className="market-section__label">RISERS</h3>
                {risers.slice(0, expanded ? 10 : 5).map((m, idx) => (
                  <MarketRow
                    key={m.venue_id}
                    mover={m}
                    direction="up"
                    rank={idx + 1}
                    spotlit={m.venue_id === spotlightVenueId}
                    onTap={() => onVenueTap(m.venue_id, m)}
                    expanded={expanded}
                  />
                ))}
              </section>
            )}

            {fallers.length > 0 && expanded && (
              <section className="market-section">
                <h3 className="market-section__label">FADERS</h3>
                {fallers.slice(0, 10).map((m, idx) => (
                  <MarketRow
                    key={m.venue_id}
                    mover={m}
                    direction="down"
                    rank={idx + 1}
                    spotlit={m.venue_id === spotlightVenueId}
                    onTap={() => onVenueTap(m.venue_id, m)}
                    expanded={expanded}
                  />
                ))}
              </section>
            )}

            {risers.length === 0 && fallers.length === 0 && (
              <div className="market-section__empty">
                Nothing's calling yet.
              </div>
            )}
          </motion.div>

          {/* FOOTER — the chip identity persists at the bottom edge */}
          <motion.div
            className="market-panel__footer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.18, duration: 0.28 }}
          >
            <span className="market-panel__footer-icon" aria-hidden>📈</span>
            <span className="market-panel__footer-count">
              {totalMovers} {totalMovers === 1 ? 'mover' : 'movers'}
            </span>
            {!expanded && totalMovers > 5 && (
              <span className="market-panel__hint">drag up for full board</span>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface MarketRowProps {
  mover: TonightMover;
  direction: 'up' | 'down';
  rank: number;
  spotlit: boolean;
  onTap: () => void;
  expanded: boolean;
}

function MarketRow({ mover, direction, rank, spotlit, onTap, expanded }: MarketRowProps) {
  const sign = mover.delta_pct >= 0 ? '+' : '';
  return (
    <button
      type="button"
      className={`market-row market-row--${direction}${spotlit ? ' market-row--spotlit' : ''}`}
      onClick={onTap}
    >
      <span className="market-row__rank">{rank}</span>
      <div className="market-row__info">
        <span className="market-row__name">{mover.venue_name}</span>
        {expanded && (
          <span className={`market-row__state market-row__state--${mover.state_label.toLowerCase()}`}>
            {mover.state_label}
          </span>
        )}
      </div>
      <span className={`market-row__delta market-row__delta--${direction}`}>
        {sign}{Math.round(mover.delta_pct)}%
      </span>
    </button>
  );
}
