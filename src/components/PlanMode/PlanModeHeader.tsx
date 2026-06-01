import { memo } from 'react';
import { motion } from 'framer-motion';
import { hapticLight } from '../../lib/haptics';

interface PlanModeHeaderProps {
  planTitle: string;
  currentStopName: string | null;
  currentStopIndex: number;
  totalStops: number;
  onExit: () => void;
}

function PlanModeHeaderInner({
  planTitle,
  currentStopName,
  currentStopIndex,
  totalStops,
  onExit,
}: PlanModeHeaderProps) {
  return (
    <motion.div
      className="plan-mode-header"
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -80, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.0) 100%)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          pointerEvents: 'auto',
        }}
      >
        {/* Exit button (left) */}
        <button
          type="button"
          onClick={() => { void hapticLight(); onExit(); }}
          aria-label="Exit plan mode"
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            border: 'none',
            background: 'rgba(0,0,0,0.55)',
            color: '#FFF',
            fontSize: 18,
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>

        {/* Plan title + current stop (center) */}
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.55)',
              marginBottom: 2,
            }}
          >
            {planTitle}
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: '#FFF',
              letterSpacing: 0.2,
            }}
          >
            {currentStopName ?? 'No stop selected'}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.5)',
              marginTop: 2,
              letterSpacing: 0.5,
            }}
          >
            Stop {currentStopIndex + 1} of {totalStops}
          </div>
        </div>

        {/* Spacer (right) — same width as exit button for visual balance */}
        <div style={{ width: 36 }} />
      </div>

      {/* Progress dots underneath */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 6,
          paddingBottom: 10,
          pointerEvents: 'auto',
        }}
      >
        {Array.from({ length: totalStops }).map((_, i) => (
          <div
            key={i}
            style={{
              width: i === currentStopIndex ? 24 : 6,
              height: 6,
              borderRadius: 3,
              background: i === currentStopIndex
                ? '#FF8200'
                : i < currentStopIndex
                  ? 'rgba(255,130,0,0.55)'
                  : 'rgba(255,255,255,0.3)',
              transition: 'all 320ms cubic-bezier(0.2, 0.7, 0.2, 1)',
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

export const PlanModeHeader = memo(PlanModeHeaderInner);
