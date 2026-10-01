import { useEffect } from 'react';

export interface ToastMsg { id: number; text: string; tone?: 'ok' | 'warn' }

/** One-line toast just above the carousels / tab bar; auto-hides. */
export function SocialToast({ toast, onDone }: { toast: ToastMsg | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: 'absolute', zIndex: 40, left: 16, right: 16, bottom: 196, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <span
        key={toast.id}
        className="social-fade-in"
        style={{
          maxWidth: '100%', padding: '10px 16px', borderRadius: 14, boxSizing: 'border-box',
          background: 'rgba(20, 18, 16, 0.96)', border: `1px solid ${toast.tone === 'warn' ? 'rgba(229,72,77,0.6)' : 'var(--social-hairline)'}`,
          fontFamily: 'Satoshi, sans-serif', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center',
          boxShadow: '0 10px 30px -12px rgba(0,0,0,0.8)',
        }}
      >
        {toast.text}
      </span>
    </div>
  );
}
