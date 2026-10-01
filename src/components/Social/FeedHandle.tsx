import { ChevronUp } from 'lucide-react';
import { hapticLight } from '../../lib/haptics';

/** Small "Feed" handle floating just above a carousel (44pt target). */
export function FeedHandle({ bottom, onOpen }: { bottom: number; onOpen: () => void }) {
  return (
    <div style={{ position: 'absolute', zIndex: 10, left: 0, right: 0, bottom: bottom + 4, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <button
        className="social-press"
        aria-label="Open the feed"
        onClick={() => { hapticLight(); onOpen(); }}
        style={{
          pointerEvents: 'auto', minHeight: 44, minWidth: 88, padding: '0 14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 12px', borderRadius: 14,
            background: 'rgba(11, 10, 9, 0.86)', border: '1px solid var(--social-hairline)',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            fontFamily: 'Satoshi, sans-serif', fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-primary)',
          }}
        >
          <ChevronUp size={14} strokeWidth={2.5} /> Feed
        </span>
      </button>
    </div>
  );
}
