import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { hapticLight } from '../../lib/haptics';

/**
 * MiniVennyPill — floating, glassmorphic Venny access while a plan
 * is live.
 *
 * The bottom offset tracks the plan sheet so the pill always sits
 * just above the sheet's top edge:
 *
 *   • no sheet    → bottom: 24px (above the OS gesture inset)
 *   • pill        → bottom: 24px (sheet is at the *top* of the map)
 *   • card        → bottom: 60dvh + 16px
 *   • full        → bottom: 88dvh + 16px
 *
 * Motion is a spring with stiffness 280 / damping 26 so the pill
 * follows the sheet snap without lag or wobble.
 */

type SheetState = 'pill' | 'card' | 'full' | null | undefined;

interface MiniVennyPillProps {
  contextHasUpdate: boolean;
  onTap: () => void;
  sheetState?: SheetState;
}

function bottomForSheet(sheetState: SheetState): string {
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  if (sheetState === 'full') return `${Math.round(winH * 0.88) + 16}px`;
  if (sheetState === 'card') return `${Math.round(winH * 0.60) + 16}px`;
  // pill state OR no sheet → default resting position
  return '24px';
}

function MiniVennyPillInner({ contextHasUpdate, onTap, sheetState }: MiniVennyPillProps) {
  // Recompute on every sheet-state change so resize during the night
  // (e.g. iOS URL-bar collapse) doesn't strand the pill mid-air.
  const bottom = useMemo(() => bottomForSheet(sheetState), [sheetState]);

  return (
    <motion.button
      type="button"
      className="mini-venny"
      data-context-update={contextHasUpdate ? 'true' : 'false'}
      onClick={() => { void hapticLight(); onTap(); }}
      animate={{ bottom }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      aria-label="Open Venny"
    >
      <span className="mini-venny__icon" aria-hidden>✨</span>
      <span className="mini-venny__label">Venny</span>
      <span className="mini-venny__dot" aria-hidden />
    </motion.button>
  );
}

export const MiniVennyPill = memo(MiniVennyPillInner);
