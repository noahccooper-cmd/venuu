import { memo, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { hapticLight } from '../../lib/haptics';

/**
 * LocationPermissionCard — floating glass card that asks the signed-in
 * user for location permission so the passive presence detector can
 * run. The card surfaces whenever the OS hasn't told us "granted" or
 * "denied" yet (covers iOS's reinstall-quirk where checkPermissions
 * skips 'prompt' and goes straight to 'granted'/'unknown') AND the
 * user hasn't dismissed it this session.
 *
 * Dismissal uses sessionStorage rather than localStorage so a fresh
 * app launch always re-offers the prompt — important because
 * sessionStorage survives WKWebView reinstalls less reliably than
 * localStorage, which matches what we actually want here.
 *
 * Position: just below the venuu wordmark, above the Venny pill.
 * Dismiss path A: tap "Not now" → set sessionStorage flag, hide card.
 * Dismiss path B: tap "Allow" → triggers requestPermission().
 */

const DISMISS_KEY = 'venuu_location_prompt_dismissed';

export function hasDismissedLocationPrompt(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markLocationPromptDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, 'true');
  } catch {
    /* private mode */
  }
}

interface LocationPermissionCardProps {
  onAllow: () => void;
  onDismiss: () => void;
}

function LocationPermissionCardInner({ onAllow, onDismiss }: LocationPermissionCardProps) {
  const [busy, setBusy] = useState(false);

  const handleAllow = async () => {
    if (busy) return;
    hapticLight();
    setBusy(true);
    try {
      await onAllow();
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    hapticLight();
    markLocationPromptDismissed();
    onDismiss();
  };

  return (
    <div
      role="dialog"
      aria-label="Allow location access"
      style={{
        position: 'fixed',
        // Sit just below the wordmark + counter; above the Venny pill (z 590).
        top: 'calc(80px + env(safe-area-inset-top, 0px) + 8px)',
        left: 12,
        right: 12,
        zIndex: 595,
        background: 'var(--bg-glass)',
        border: '1px solid var(--brand-orange-tint-strong)',
        borderRadius: 16,
        padding: '14px 14px 14px 16px',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.55), 0 0 22px rgba(255, 130, 0, 0.16)',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <div style={{
        flexShrink: 0,
        width: 36, height: 36, borderRadius: 18,
        background: 'rgba(255, 130, 0, 0.18)',
        border: '1px solid var(--brand-orange-tint-strong)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginTop: 2,
      }}>
        <MapPin size={16} strokeWidth={1.8} style={{ color: 'var(--brand-orange)' }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: 'Satoshi, sans-serif',
          fontSize: 14, fontWeight: 700,
          color: 'var(--text-primary)',
          margin: 0,
          letterSpacing: '-0.01em',
        }}>
          track your nights automatically
        </p>
        <p style={{
          fontFamily: 'Satoshi, sans-serif',
          fontSize: 12,
          color: 'var(--text-secondary)',
          margin: '4px 0 10px',
          lineHeight: 1.4,
        }}>
          venuu uses your location while open to count visits and unlock stamps — no NFC tap needed. we only use it when the app is open.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleAllow}
            disabled={busy}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              background: 'var(--brand-orange)',
              border: 'none',
              color: 'white',
              fontFamily: 'Satoshi, sans-serif',
              fontSize: 13, fontWeight: 700,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
              WebkitTapHighlightColor: 'transparent',
              letterSpacing: '-0.01em',
            }}
          >
            Allow
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontFamily: 'Satoshi, sans-serif',
              fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Not now
          </button>
        </div>
      </div>

      {/* small × in the corner — secondary dismiss affordance */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          flexShrink: 0,
          background: 'transparent', border: 'none',
          color: 'var(--text-muted)',
          padding: 4, marginTop: -2,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export const LocationPermissionCard = memo(LocationPermissionCardInner);
