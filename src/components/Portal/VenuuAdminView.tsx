import { useState, useRef, useEffect } from 'react';
import { Loader2, Send, X, Check } from 'lucide-react';

const FONT = 'Satoshi, sans-serif';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

interface VenuuAdminViewProps {
  onExit: () => void;
}

interface SentPush {
  id: string;
  message: string;
  sent_count: number;
  timestamp: number;
}

export function VenuuAdminView({ onExit }: VenuuAdminViewProps) {
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ sent: number; total: number } | null>(null);
  const [history, setHistory] = useState<SentPush[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('venuu_admin_history');
      if (stored) setHistory(JSON.parse(stored));
    } catch {}
  }, []);

  const charCount = message.length;
  const tooLong = charCount > 180;
  const empty = message.trim().length === 0;

  const handlePrepare = () => {
    if (empty) { setError('Message is empty'); return; }
    if (tooLong) { setError('Message too long (max 180 chars)'); return; }
    setError('');
    setConfirming(true);
  };

  const handleCancel = () => {
    setConfirming(false);
    setError('');
  };

  const handleFire = async () => {
    setSending(true);
    setError('');
    const dropId = `venuu-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

    try {
      const venueRes = await fetch(
        `${SUPABASE_URL}/rest/v1/venues?slug=eq.venuu&select=id,name,city`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
      );
      const venues = await venueRes.json();
      if (!venues?.[0]) throw new Error('venuu sender row not found');
      const venuu = venues[0];

      const cityNormalized = (venuu.city || 'Knoxville, TN').toLowerCase().split(',')[0].trim();

      const res = await fetch(`${SUPABASE_URL}/functions/v1/push-drop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          venue_id: venuu.id,
          venue_name: venuu.name,
          drop_text: message.trim(),
          drop_id: dropId,
          city: cityNormalized,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Push failed');

      const newPush: SentPush = {
        id: dropId,
        message: message.trim(),
        sent_count: data.sent ?? 0,
        timestamp: Date.now(),
      };
      const newHistory = [newPush, ...history].slice(0, 5);
      setHistory(newHistory);
      try { sessionStorage.setItem('venuu_admin_history', JSON.stringify(newHistory)); } catch {}

      setSuccess({ sent: data.sent ?? 0, total: data.total ?? 0 });
      setMessage('');
      setConfirming(false);
    } catch (e: any) {
      setError(e.message || 'Push failed');
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="bg-[#050507] flex flex-col" style={{ flex: 1, minHeight: '100vh', overflow: 'auto' }}>
      <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: '#FF2E7E', letterSpacing: 4, textTransform: 'uppercase' }}>venuu admin</div>
          <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: 'white', marginTop: 2 }}>Push to Knoxville</div>
        </div>
        <button onClick={onExit} style={{ width: 40, height: 40, borderRadius: 20, background: '#1C1C2E', border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={18} color="white" />
        </button>
      </div>

      {success && (
        <div style={{ margin: '16px 20px', padding: '16px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Check size={20} color="#22C55E" />
          <div style={{ fontFamily: FONT, color: 'white' }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Sent.</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
              {success.sent} delivered · {success.total} total
            </div>
          </div>
          <button onClick={() => setSuccess(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12, fontFamily: FONT }}>dismiss</button>
        </div>
      )}

      {!confirming && (
        <div style={{ padding: '20px' }}>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type your push..."
            style={{ width: '100%', minHeight: 140, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', padding: '16px', fontSize: 18, fontFamily: FONT, fontWeight: 500, color: 'white', outline: 'none', boxSizing: 'border-box', resize: 'none' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontFamily: FONT, fontSize: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>~1,000 phones in Knoxville</span>
            <span style={{ color: tooLong ? '#FF2D05' : 'rgba(255,255,255,0.4)', fontWeight: tooLong ? 700 : 500 }}>{charCount}/180</span>
          </div>
          {error && <p style={{ fontFamily: FONT, fontSize: 14, color: '#FF2D05', marginTop: 12, fontWeight: 600 }}>{error}</p>}
          <button
            onClick={handlePrepare}
            disabled={empty || tooLong}
            style={{ width: '100%', height: 64, marginTop: 20, borderRadius: 16, background: empty || tooLong ? 'rgba(255,46,126,0.3)' : '#FF2E7E', border: 'none', color: 'white', fontFamily: FONT, fontSize: 18, fontWeight: 800, letterSpacing: 2, cursor: empty || tooLong ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            <Send size={20} />
            PREPARE
          </button>
        </div>
      )}

      {confirming && (
        <div style={{ padding: '20px' }}>
          <div style={{ padding: '20px', background: 'rgba(255,46,126,0.08)', border: '1px solid rgba(255,46,126,0.4)', borderRadius: 16 }}>
            <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 4, color: '#FF2E7E', textTransform: 'uppercase', marginBottom: 8 }}>confirm push</div>
            <div style={{ fontFamily: FONT, fontSize: 18, color: 'white', lineHeight: 1.5, fontWeight: 500, padding: '12px 14px', background: 'rgba(0,0,0,0.3)', borderRadius: 10, marginBottom: 16 }}>
              "{message}"
            </div>
            <div style={{ fontFamily: FONT, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
              Will fire to ~1,000 phones in Knoxville. <b style={{ color: '#FF2D05' }}>Cannot be undone.</b>
            </div>
            {error && <p style={{ fontFamily: FONT, fontSize: 14, color: '#FF2D05', marginTop: 4, marginBottom: 12, fontWeight: 600 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleCancel} disabled={sending} style={{ flex: 1, height: 56, borderRadius: 14, background: '#1C1C2E', border: '1px solid #333', color: 'white', fontFamily: FONT, fontSize: 16, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer' }}>CANCEL</button>
              <button onClick={handleFire} disabled={sending} style={{ flex: 2, height: 56, borderRadius: 14, background: sending ? 'rgba(255,46,126,0.6)' : '#FF2E7E', border: 'none', color: 'white', fontFamily: FONT, fontSize: 16, fontWeight: 800, letterSpacing: 2, cursor: sending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {sending ? <Loader2 size={20} className="animate-spin" /> : <><Send size={18} /> FIRE NOW</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {history.length > 0 && !confirming && (
        <div style={{ padding: '8px 20px 24px' }}>
          <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 3, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 10, marginTop: 8 }}>recent pushes</div>
          {history.map(p => (
            <div key={p.id} style={{ padding: '12px 14px', marginBottom: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 }}>
              <div style={{ fontFamily: FONT, fontSize: 14, color: 'rgba(255,255,255,0.85)', marginBottom: 4 }}>{p.message}</div>
              <div style={{ fontFamily: FONT, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{p.sent_count} delivered · {formatTime(p.timestamp)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
