import { useState, useEffect } from 'react';
import { Radio, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { startNfcCheckin, isNfcAvailable } from '../lib/nfc';
import { hapticLight, hapticSuccess, hapticError } from '../lib/haptics';

interface CheckinButtonProps {
  venueId: string;
  onCheckinSuccess?: (visitCount: number) => void;
}

type Status = 'idle' | 'scanning' | 'detected' | 'verifying' | 'success' | 'error';

const ERROR_MESSAGES: Record<string, string> = {
  too_far_from_venue: 'You need to be at the venue to check in',
  already_checked_in_tonight: 'Already checked in tonight — come back tomorrow!',
  rate_limited: 'Slow down! Try again in a minute.',
  wrong_venue_tag: 'That tag is for a different venue',
  tag_not_registered: 'Tag not registered yet',
  tag_lookup_failed: 'Could not verify tag',
  tag_disabled: 'This tag is disabled',
  not_signed_in: 'Please sign in to check in',
  scan_timeout: 'No tag detected. Try again.',
  scan_cancelled: 'Scan cancelled. Try again.',
  scan_failed: 'NFC unavailable — check device settings.',
  not_native: 'NFC only works on iPhone',
  venue_not_found: 'Venue not found',
  location_denied: 'Enable location to check in',
};

export function CheckinButton({ venueId, onCheckinSuccess }: CheckinButtonProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [nfcSupported, setNfcSupported] = useState(false);

  useEffect(() => {
    isNfcAvailable().then((supported) => {
      console.log('[checkin] NFC supported:', supported);
      setNfcSupported(supported);
    });
  }, []);

  const resetAfterDelay = (ms: number) => {
    setTimeout(() => {
      setStatus('idle');
      setMessage('');
    }, ms);
  };

  const handleCheckin = async () => {
    if (status !== 'idle') return;

    console.log('[checkin] tapped — nfcSupported:', nfcSupported);
    hapticLight();

    if (!nfcSupported) {
      setStatus('error');
      setMessage('NFC not available on this device');
      resetAfterDelay(4000);
      return;
    }

    setStatus('scanning');
    setMessage('Hold your phone near the tag');

    const result = await startNfcCheckin(venueId, (newStatus) => {
      console.log('[checkin] status update:', newStatus);
      if (newStatus === 'detected') {
        setStatus('detected');
        setMessage('Tag detected...');
      } else if (newStatus === 'verifying') {
        setStatus('verifying');
        setMessage('Verifying...');
      }
    });

    console.log('[checkin] result:', result);

    if (result.success) {
      hapticSuccess();
      setStatus('success');
      setMessage(`Checked in! ${result.visit_count} visit${result.visit_count === 1 ? '' : 's'}`);
      onCheckinSuccess?.(result.visit_count ?? 0);
      resetAfterDelay(3000);
    } else {
      hapticError();
      setStatus('error');
      setMessage(ERROR_MESSAGES[result.error ?? ''] ?? result.error ?? 'Something went wrong');
      resetAfterDelay(4000);
    }
  };

  const bgColor = (() => {
    switch (status) {
      case 'success': return 'linear-gradient(135deg, #00CC66, #00884A)';
      case 'error':   return 'linear-gradient(135deg, #CC3333, #992222)';
      default:        return 'linear-gradient(135deg, #FF8200, #FF6B35)';
    }
  })();

  const glow = (() => {
    switch (status) {
      case 'success': return '0 4px 20px rgba(0, 204, 102, 0.4)';
      case 'error':   return '0 4px 20px rgba(204, 51, 51, 0.4)';
      default:        return '0 4px 20px rgba(255, 130, 0, 0.4)';
    }
  })();

  const anim = (() => {
    switch (status) {
      case 'scanning':
      case 'detected':
      case 'verifying': return 'checkin-btn-pulse 1.5s ease-in-out infinite';
      case 'success':   return 'checkin-btn-pop 0.4s ease-out';
      case 'error':     return 'checkin-btn-shake 0.4s ease-out';
      default:          return 'none';
    }
  })();

  const icon = (() => {
    switch (status) {
      case 'scanning':
      case 'detected':
      case 'verifying': return <Loader2 size={22} className="animate-spin" />;
      case 'success':   return <CheckCircle2 size={22} />;
      case 'error':     return <XCircle size={22} />;
      default:          return <Radio size={22} />;
    }
  })();

  return (
    <>
      <style>{`
        @keyframes checkin-btn-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(0.98); }
        }
        @keyframes checkin-btn-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
        @keyframes checkin-btn-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
        }
      `}</style>
      <button
        onClick={handleCheckin}
        disabled={status !== 'idle'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          width: '100%',
          height: 56,
          borderRadius: 16,
          border: 'none',
          background: bgColor,
          boxShadow: glow,
          color: 'white',
          fontSize: 17,
          fontWeight: 700,
          fontFamily: 'Satoshi, sans-serif',
          cursor: status === 'idle' ? 'pointer' : 'default',
          transition: 'background 0.3s ease, box-shadow 0.3s ease',
          WebkitTapHighlightColor: 'transparent',
          animation: anim,
          marginBottom: 4,
        }}
        onTouchStart={(e) => status === 'idle' && (e.currentTarget.style.transform = 'scale(0.98)')}
        onTouchEnd={(e) => status === 'idle' && (e.currentTarget.style.transform = 'scale(1)')}
      >
        {icon}
        <span>{status === 'idle' ? 'Check In' : message}</span>
      </button>
    </>
  );
}
