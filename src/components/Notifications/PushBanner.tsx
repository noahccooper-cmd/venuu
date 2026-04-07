import { useState, useEffect, useCallback } from 'react';
import { hapticHeavy } from '../../lib/haptics';

interface Notification {
  title: string;
  body: string;
}

const FONT = 'Satoshi, sans-serif';
const AUTO_DISMISS_MS = 5000;

export function PushBanner() {
  const [notification, setNotification] = useState<Notification | null>(null);
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => setNotification(null), 300);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Notification;
      setNotification(detail);
      setVisible(true);
      hapticHeavy();
    };

    window.addEventListener('push-notification', handler);
    return () => window.removeEventListener('push-notification', handler);
  }, []);

  // Auto-dismiss
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible, dismiss]);

  if (!notification) return null;

  return (
    <div
      onClick={dismiss}
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 80px)',
        left: 12,
        right: 12,
        zIndex: 900,
        background: '#111114',
        borderRadius: 12,
        borderLeft: '3px solid #FF8200',
        padding: '12px 16px',
        transform: visible ? 'translateY(0)' : 'translateY(-120%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.3s ease, opacity 0.3s ease',
        cursor: 'pointer',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      {notification.title && (
        <p style={{
          fontFamily: FONT,
          fontSize: 14,
          fontWeight: 700,
          color: 'white',
          marginBottom: notification.body ? 2 : 0,
        }}>
          {notification.title}
        </p>
      )}
      {notification.body && (
        <p style={{
          fontFamily: FONT,
          fontSize: 13,
          color: '#8A8A95',
          margin: 0,
          lineHeight: '1.3',
        }}>
          {notification.body}
        </p>
      )}
    </div>
  );
}
