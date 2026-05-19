import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { useTonightMovers, type TonightMover } from '../../hooks/useTonightMovers';
import './MoversDrawer.css';

/**
 * MoversChip — small floating bottom-left button that opens Market
 * View Mode. Self-hides when there are no movers, or when
 * `hidden=true` (panel is active and the chip is morphing).
 *
 * Wrapped in `motion.button` with `layoutId="market-pill"` — pairs
 * with MarketPanel's same layoutId so the chip morphs upward into
 * the panel via a single continuous spring rather than a fade
 * out/in. Both elements live in MapView's tree, so framer-motion's
 * layout system picks up the geometry handoff automatically.
 */
interface MoversChipProps {
  city: string | null;
  onOpen: () => void;
  /** Set true while the MarketPanel is mounted so the chip yields
   *  geometry to the panel for the layoutId morph. */
  hidden?: boolean;
}

export function MoversChip({ city, onOpen, hidden = false }: MoversChipProps) {
  const { risers, fallers } = useTonightMovers(city, 5);
  const totalMovers = risers.length + fallers.length;

  if (!city || totalMovers === 0 || hidden) return null;

  return (
    <motion.button
      type="button"
      layoutId="market-pill"
      className="movers-chip"
      onClick={onOpen}
      aria-label="Open market view"
      transition={{ layout: { type: 'spring', damping: 26, stiffness: 220 } }}
    >
      <motion.span className="movers-chip__icon" aria-hidden initial={false}>📈</motion.span>
      <motion.span className="movers-chip__count" initial={false}>{totalMovers}</motion.span>
    </motion.button>
  );
}

/**
 * MoversDrawer — bottom-sheet listing tonight's risers and faders.
 * Open/close state is owned by the parent so the chip (which lives
 * inside CityPulseLine) and the drawer can share it. Live-refreshes
 * every 60 s via useTonightMovers. Lighter spring than the plan
 * sheet so the metaphor reads as "ticker" rather than "agenda".
 *
 * Scrim + sheet both `position: fixed` so they sit above every map
 * UI element regardless of any transform context on their ancestor —
 * fixes the "sibling UI drags with the drawer" bug.
 */
interface MoversDrawerProps {
  city: string | null;
  open: boolean;
  onClose: () => void;
  onVenueTap?: (venue: TonightMover) => void;
}

export function MoversDrawer({ city, open, onClose, onVenueTap }: MoversDrawerProps) {
  const { risers, fallers } = useTonightMovers(city, 5);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 80) onClose();
  };

  if (!city) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="movers-drawer__scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="drawer"
            className="movers-drawer"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 400 }}
            dragElastic={0.15}
            onDragEnd={handleDragEnd}
          >
            <div className="movers-drawer__handle" />
            <div className="movers-drawer__header">
              <h2 className="movers-drawer__title">Tonight's Movers</h2>
              <button
                type="button"
                className="movers-drawer__close"
                onClick={onClose}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="movers-drawer__body">
              <section className="movers-section movers-section--risers">
                <h3 className="movers-section__title">
                  <span className="movers-section__icon" aria-hidden>🔥</span>
                  Tonight's Risers
                </h3>
                {risers.length === 0 && (
                  <div className="movers-section__empty">
                    No clear risers yet. Check back as the night picks up.
                  </div>
                )}
                {risers.map((m) => (
                  <MoverRow
                    key={m.venue_id}
                    mover={m}
                    direction="up"
                    onTap={() => {
                      onVenueTap?.(m);
                      onClose();
                    }}
                  />
                ))}
              </section>

              <section className="movers-section movers-section--fallers">
                <h3 className="movers-section__title">
                  <span className="movers-section__icon" aria-hidden>❄️</span>
                  Tonight's Faders
                </h3>
                {fallers.length === 0 && (
                  <div className="movers-section__empty">
                    No clear faders yet.
                  </div>
                )}
                {fallers.map((m) => (
                  <MoverRow
                    key={m.venue_id}
                    mover={m}
                    direction="down"
                    onTap={() => {
                      onVenueTap?.(m);
                      onClose();
                    }}
                  />
                ))}
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface MoverRowProps {
  mover: TonightMover;
  direction: 'up' | 'down';
  onTap: () => void;
}

function MoverRow({ mover, direction, onTap }: MoverRowProps) {
  const sign = mover.delta_pct >= 0 ? '+' : '';
  const stateClass = `mover-row__state mover-row__state--${mover.state_label.toLowerCase()}`;

  return (
    <button
      type="button"
      className={`mover-row mover-row--${direction}`}
      onClick={onTap}
    >
      <div className="mover-row__image">
        {mover.image_url ? (
          <img src={mover.image_url} alt={mover.venue_name} />
        ) : (
          <div className="mover-row__image-placeholder" />
        )}
      </div>
      <div className="mover-row__info">
        <div className="mover-row__name">{mover.venue_name}</div>
        <div className={stateClass}>{mover.state_label}</div>
      </div>
      <div className="mover-row__delta">
        <span className={`mover-row__delta-num mover-row__delta-num--${direction}`}>
          {sign}{Math.round(mover.delta_pct)}%
        </span>
        <span className="mover-row__delta-arrow" aria-hidden>
          {direction === 'up' ? '↗' : '↘'}
        </span>
      </div>
    </button>
  );
}
