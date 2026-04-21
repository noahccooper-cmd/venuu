import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '../../lib/supabase';
import { formatCoverPrice, formatCoverPriceShort, parseQRCode } from '../../lib/coverPricing';
import { getTonightDate } from '../../lib/utils';
import { hapticSuccess, hapticError, hapticLight } from '../../lib/haptics';
import type { Venue, CoverConfig } from '../../lib/types';

const FONT = 'Satoshi, sans-serif';

interface CoverPortalSectionProps {
  venue: Venue;
}

interface ScanResult {
  type: 'valid' | 'used' | 'invalid';
  message: string;
  details?: string;
}

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5b3V2aHRnendjYnFweWxjc3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzQ5NDYsImV4cCI6MjA4Njc1MDk0Nn0.kr1qQ1jyFBaNDP351aMihxNO3K4GFf_XJEfHRZ9MZ-E';
const CONNECT_URL = 'https://tyouvhtgzwcbqpylcssk.supabase.co/functions/v1/create-stripe-connect';
const PUSH_COVERS_URL = 'https://tyouvhtgzwcbqpylcssk.supabase.co/functions/v1/push-covers';

export function CoverPortalSection({ venue }: CoverPortalSectionProps) {
  const [config, setConfig] = useState<CoverConfig | null>(null);
  const [stripeVerified, setStripeVerified] = useState<boolean | null>(null); // null = loading
  const [connectingStripe, setConnectingStripe] = useState(false);
  const isFrat = venue.category === 'fraternity';
  const [pricingMode, setPricingMode] = useState<'dynamic' | 'flat'>(isFrat ? 'flat' : 'dynamic');
  const [baseInput, setBaseInput] = useState('');
  const [capInput, setCapInput] = useState('');
  const [capacityInput, setCapacityInput] = useState('100');
  const [openTimeInput, setOpenTimeInput] = useState('18:00');
  const [closeTimeInput, setCloseTimeInput] = useState('01:30');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [revenue, setRevenue] = useState(0);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const nightOf = getTonightDate();

  // Check Stripe account status
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('venue_stripe_accounts')
        .select('is_verified')
        .eq('venue_id', venue.id)
        .maybeSingle();
      setStripeVerified(data?.is_verified ?? false);
    };
    load();
  }, [venue.id]);

  // Load existing config for tonight
  useEffect(() => {
    const load = async () => {
      console.debug('[covers] Fetching config: venue', venue.id, 'night', nightOf);
      const { data } = await supabase
        .from('cover_configs')
        .select('*')
        .eq('venue_id', venue.id)
        .eq('night_of', nightOf)
        .maybeSingle();
      if (data) {
        const c = data as CoverConfig;
        setConfig(c);
        setBaseInput(String(c.base_price / 100));
        setCapInput(String(c.cap_price / 100));
        setCapacityInput(String(c.capacity));
        const openD = new Date(c.open_time);
        const closeD = new Date(c.close_time);
        setOpenTimeInput(`${String(openD.getHours()).padStart(2, '0')}:${String(openD.getMinutes()).padStart(2, '0')}`);
        setCloseTimeInput(`${String(closeD.getHours()).padStart(2, '0')}:${String(closeD.getMinutes()).padStart(2, '0')}`);
        setPricingMode(c.base_price === c.cap_price ? 'flat' : 'dynamic');
      }
    };
    load();
  }, [venue.id, nightOf]);

  // Load revenue
  useEffect(() => {
    if (!config) return;
    const load = async () => {
      const { data } = await supabase
        .from('cover_purchases')
        .select('price_paid')
        .eq('cover_config_id', config.id)
        .in('status', ['completed', 'used']);
      if (data) {
        setRevenue(data.reduce((sum: number, p: { price_paid: number }) => sum + p.price_paid, 0));
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [config?.id]);

  // Realtime config updates
  useEffect(() => {
    if (!config) return;
    const channel = supabase
      .channel(`cover-portal-${config.id}-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cover_configs', filter: `id=eq.${config.id}` },
        (payload) => { setConfig(payload.new as CoverConfig); }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [config?.id]);

  const handleStartSelling = useCallback(async () => {
    const base = Math.round(parseFloat(baseInput || '0') * 100);
    const cap = pricingMode === 'flat' ? base : Math.round(parseFloat(capInput || '0') * 100);
    const capacity = parseInt(capacityInput || '100', 10);
    if (!base || capacity <= 0 || (pricingMode === 'dynamic' && (!cap || cap <= base))) {
      setSaveMsg('Check your prices'); setTimeout(() => setSaveMsg(''), 2000); return;
    }

    setSaving(true);
    const today = new Date();
    const [oh, om] = openTimeInput.split(':').map(Number);
    const [ch, cm] = closeTimeInput.split(':').map(Number);
    const openTime = new Date(today); openTime.setHours(oh, om, 0, 0);
    const closeTime = new Date(today);
    closeTime.setHours(ch, cm, 0, 0);
    if (ch < oh) closeTime.setDate(closeTime.getDate() + 1); // past midnight

    // Bars: 8% platform fee. Fraternities: 12% (set via FratPortal).
    const platformFee = venue.category === 'fraternity' ? 0.12 : 0.08;
    console.debug('[covers] Upserting config for venue:', venue.id, 'night:', nightOf, 'base:', base, 'cap:', cap);
    const { data, error } = await supabase.from('cover_configs').upsert({
      venue_id: venue.id,
      night_of: nightOf,
      base_price: base,
      cap_price: cap,
      capacity,
      open_time: openTime.toISOString(),
      close_time: closeTime.toISOString(),
      current_price: base,
      covers_sold: config?.covers_sold ?? 0,
      is_active: true,
      platform_fee_percent: platformFee,
      pricing_mode: pricingMode,
    }, { onConflict: 'venue_id,night_of' }).select().maybeSingle();
    console.debug('[covers] Upsert result:', error ? `error: ${error.message}` : 'success');

    setSaving(false);
    if (error) {
      console.error('[covers] upsert error:', error.message, error.details, error.hint);
      setSaveMsg(`Failed to save: ${error.message}`);
      hapticError();
    } else {
      setConfig(data as CoverConfig);
      setSaveMsg('Covers are live! \u2713');
      // Push notification to all students in the city (non-blocking)
      fetch(PUSH_COVERS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ venue_name: venue.name, city: venue.city, base_price: base }),
      }).catch(() => {});
    }
    setTimeout(() => setSaveMsg(''), 2000);
  }, [venue.id, venue.name, venue.city, nightOf, baseInput, capInput, capacityInput, openTimeInput, closeTimeInput, config?.covers_sold]);

  const handleConnectStripe = useCallback(async () => {
    setConnectingStripe(true);
    try {
      const res = await fetch(CONNECT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ venue_id: venue.id, venue_name: venue.name }),
      });
      const data = await res.json();
      console.debug('[stripe-connect] Response:', data);
      if (!res.ok) {
        console.warn('[stripe-connect] Error:', data);
        setConnectingStripe(false);
        return;
      }
      if (data.already_verified) {
        setStripeVerified(true);
      } else if (data.url) {
        // Open Stripe onboarding in Capacitor browser (or web fallback)
        console.debug('[stripe-connect] Opening URL:', data.url);
        if (Capacitor.isNativePlatform()) {
          await Browser.open({ url: data.url });
        } else {
          window.open(data.url, '_blank');
        }
        // Poll for verification (they'll come back)
        const poll = setInterval(async () => {
          const { data: acct } = await supabase
            .from('venue_stripe_accounts')
            .select('is_verified')
            .eq('venue_id', venue.id)
            .maybeSingle();
          if (acct?.is_verified) {
            setStripeVerified(true);
            clearInterval(poll);
          }
        }, 5000);
        setTimeout(() => clearInterval(poll), 300000); // stop polling after 5 min
      }
    } catch (err) {
      console.warn('[stripe-connect]', err);
    }
    setConnectingStripe(false);
  }, [venue.id, venue.name]);

  const handleStopSelling = useCallback(async () => {
    if (!config) return;
    await supabase.from('cover_configs').update({ is_active: false }).eq('id', config.id);
    setConfig(prev => prev ? { ...prev, is_active: false } : null);
  }, [config]);

  const handleScan = useCallback(async () => {
    setScanResult(null);
    try {
      let qrValue: string;
      if (Capacitor.isNativePlatform()) {
        const mod = await import('@capacitor/barcode-scanner');
        const result = await mod.CapacitorBarcodeScanner.scanBarcode({ hint: 17 });
        qrValue = result.ScanResult;
      } else {
        qrValue = prompt('Enter QR code (dev mode):') ?? '';
      }

      if (!qrValue) return;

      const trimmed = qrValue.trim().toUpperCase();

      // ── Event ticket QR (format: VENUU-TKT-XXXXXXXX-XXXXXXXX) ──
      if (trimmed.startsWith('VENUU-TKT-')) {
        const { data: ticket } = await supabase
          .from('event_tickets')
          .select('id, status, price_paid, used_at, venue_id, event_id')
          .eq('qr_code', trimmed)
          .maybeSingle();

        if (!ticket || ticket.venue_id !== venue.id) {
          setScanResult({ type: 'invalid', message: 'INVALID TICKET' });
          hapticError();
        } else if (ticket.status === 'used') {
          const usedTime = ticket.used_at ? new Date(ticket.used_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
          setScanResult({ type: 'used', message: 'ALREADY USED', details: usedTime ? `Scanned at ${usedTime}` : undefined });
          hapticError();
        } else if (ticket.status === 'completed') {
          // Fetch event name for display
          const { data: evt } = await supabase
            .from('events').select('title').eq('id', ticket.event_id).maybeSingle();
          await supabase.from('event_tickets')
            .update({ status: 'used', used_at: new Date().toISOString() })
            .eq('id', ticket.id);
          setScanResult({
            type: 'valid',
            message: 'TICKET VALID',
            details: evt?.title ? `Entry confirmed — ${evt.title}` : `Paid ${formatCoverPrice(ticket.price_paid)}`,
          });
          hapticSuccess();
        } else {
          setScanResult({ type: 'invalid', message: 'INVALID STATUS', details: ticket.status });
        }
        setTimeout(() => setScanResult(null), 4000);
        return;
      }

      // ── Cover QR (format: VENUU-XXXXXXXX-XXXXXXXX) ──
      const parsed = parseQRCode(trimmed);
      if (!parsed) {
        setScanResult({ type: 'invalid', message: 'INVALID CODE' });
        hapticError();
        setTimeout(() => setScanResult(null), 3000);
        return;
      }

      // Look up cover purchase by QR code
      const { data: purchase } = await supabase
        .from('cover_purchases')
        .select('id, status, price_paid, used_at, venue_id, user_id')
        .eq('qr_code', trimmed)
        .maybeSingle();

      if (!purchase || purchase.venue_id !== venue.id) {
        setScanResult({ type: 'invalid', message: 'INVALID COVER' });
        hapticError();
      } else if (purchase.status === 'used') {
        const usedTime = purchase.used_at ? new Date(purchase.used_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
        setScanResult({ type: 'used', message: 'ALREADY USED', details: usedTime ? `Scanned at ${usedTime}` : undefined });
        hapticError();
      } else if (purchase.status === 'completed') {
        await supabase.from('cover_purchases').update({ status: 'used', used_at: new Date().toISOString() }).eq('id', purchase.id);
        setScanResult({ type: 'valid', message: 'COVER VALID', details: `Paid ${formatCoverPrice(purchase.price_paid)}` });
        hapticSuccess();
      } else {
        setScanResult({ type: 'invalid', message: 'INVALID STATUS', details: purchase.status });
      }

      setTimeout(() => setScanResult(null), 4000);
    } catch (err) {
      console.warn('[cover-scan]', err);
    }
  }, [venue.id]);

  const inputStyle: React.CSSProperties = {
    height: '40px', borderRadius: '10px',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
    padding: '0 12px', fontSize: '15px', color: 'white', outline: 'none',
    boxSizing: 'border-box', fontFamily: FONT,
  };

  const isActive = config?.is_active ?? false;
  const secFeeRate = config?.security_fee_percent ?? 0;
  const platformFeeRate = config?.platform_fee_percent ?? 0.08;
  const fee = Math.round(revenue * platformFeeRate);
  const secFee = Math.round(revenue * secFeeRate);
  const payout = revenue - fee - secFee;

  return (
    <div style={{ marginTop: '14px', padding: '0 0 24px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#FF8200', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px', fontFamily: FONT }}>
        {'\uD83D\uDCB5'} COVERS
      </div>

      {/* Scan button — always accessible when covers are active */}
      {isActive && (
        <>
          <button
            onClick={handleScan}
            className="active:scale-[0.97] transition-transform"
            style={{
              width: '100%', height: 50, borderRadius: 14, marginBottom: 10,
              background: 'linear-gradient(135deg, #16A34A, #15803D)',
              border: 'none', color: 'white', fontFamily: FONT, fontSize: 16, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {'\uD83D\uDCF7'} SCAN COVER
          </button>

          {/* Scan result feedback */}
          {scanResult && (
            <div style={{
              padding: '12px 16px', borderRadius: 12, marginBottom: 10, textAlign: 'center',
              background: scanResult.type === 'valid' ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 45, 5, 0.1)',
              border: `1px solid ${scanResult.type === 'valid' ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 45, 5, 0.3)'}`,
            }}>
              <p style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: scanResult.type === 'valid' ? '#00FF88' : '#FF2D05', margin: '0 0 2px' }}>
                {scanResult.type === 'valid' ? '\u2705' : '\u274C'} {scanResult.message}
              </p>
              {scanResult.details && (
                <p style={{ fontFamily: FONT, fontSize: 13, color: '#8A8A95', margin: 0 }}>
                  {scanResult.details}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Live dashboard (when active) */}
      {isActive && config && (
        <div style={{ background: '#111114', border: '1px solid #2A2A30', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <p style={{ fontFamily: FONT, fontSize: 11, color: '#8A8A95', margin: '0 0 2px' }}>CURRENT PRICE</p>
              <p style={{ fontFamily: FONT, fontSize: 28, fontWeight: 800, color: 'white', margin: 0 }}>
                {formatCoverPriceShort(config.current_price)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontFamily: FONT, fontSize: 11, color: '#8A8A95', margin: '0 0 2px' }}>SOLD</p>
              <p style={{ fontFamily: FONT, fontSize: 28, fontWeight: 800, color: '#FF8200', margin: 0 }}>
                {config.covers_sold}/{config.capacity}
              </p>
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', marginBottom: 12 }}>
            <div style={{ height: '100%', borderRadius: 2, background: '#FF8200', width: `${Math.round((config.covers_sold / config.capacity) * 100)}%`, transition: 'width 0.5s' }} />
          </div>
          {/* Revenue — three-way split */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 70, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
              <p style={{ fontFamily: FONT, fontSize: 9, color: '#8A8A95', margin: '0 0 2px' }}>REVENUE</p>
              <p style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: 'white', margin: 0 }}>{formatCoverPrice(revenue)}</p>
            </div>
            <div style={{ flex: 1, minWidth: 70, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
              <p style={{ fontFamily: FONT, fontSize: 9, color: '#8A8A95', margin: '0 0 2px' }}>VENUE</p>
              <p style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: '#22C55E', margin: 0 }}>{formatCoverPrice(payout)}</p>
            </div>
            <div style={{ flex: 1, minWidth: 70, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
              <p style={{ fontFamily: FONT, fontSize: 9, color: '#8A8A95', margin: '0 0 2px' }}>VENUU ({Math.round(platformFeeRate * 100)}%)</p>
              <p style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: '#55555F', margin: 0 }}>{formatCoverPrice(fee)}</p>
            </div>
            {secFee > 0 && (
              <div style={{ flex: 1, minWidth: 70, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
                <p style={{ fontFamily: FONT, fontSize: 9, color: '#8A8A95', margin: '0 0 2px' }}>SECURITY</p>
                <p style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: '#C9A96E', margin: 0 }}>{formatCoverPrice(secFee)}</p>
              </div>
            )}
          </div>
          {/* Stop button */}
          <button onClick={handleStopSelling} className="active:scale-[0.97] transition-transform" style={{
            width: '100%', height: 40, borderRadius: 10, marginTop: 12,
            background: 'transparent', border: '1px solid rgba(255, 45, 5, 0.3)',
            color: '#FF2D05', fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            Stop Selling Covers
          </button>
        </div>
      )}

      {/* Stripe Connect onboarding (when no verified account) */}
      {!isActive && !stripeVerified && stripeVerified !== null && (
        <div style={{ background: '#111114', border: '1px solid #2A2A30', borderRadius: 14, padding: '20px 16px', textAlign: 'center' }}>
          {stripeVerified === false && (
            <>
              <p style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: 'white', margin: '0 0 6px' }}>
                Connect Payments
              </p>
              <p style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95', margin: '0 0 16px' }}>
                To sell covers, {venue.name} needs to connect a bank account
              </p>
              <button
                onClick={handleConnectStripe}
                disabled={connectingStripe}
                className="active:scale-[0.97] transition-transform"
                style={{
                  width: '100%', height: 44, borderRadius: 12,
                  background: connectingStripe ? 'rgba(99, 91, 255, 0.3)' : '#635BFF',
                  color: 'white', fontWeight: 700, fontSize: 15, border: 'none',
                  cursor: connectingStripe ? 'wait' : 'pointer', fontFamily: FONT,
                }}
              >
                {connectingStripe ? 'Connecting...' : 'Connect with Stripe'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Stripe verified badge */}
      {!isActive && stripeVerified && (
        <p style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#22C55E', marginBottom: 8 }}>
          {'\u2705'} Payments connected
        </p>
      )}

      {/* Setup form (when NOT active AND Stripe verified) */}
      {!isActive && stripeVerified && (
        <div style={{ background: '#111114', border: '1px solid #2A2A30', borderRadius: 14, padding: '14px 16px' }}>
          {/* Pricing Mode Toggle */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['flat', 'dynamic'] as const).map(mode => (
              <button key={mode} onClick={() => { hapticLight(); setPricingMode(mode); }} style={{
                flex: 1, height: 34, borderRadius: 8, fontFamily: FONT, fontSize: 13, fontWeight: 700,
                background: pricingMode === mode ? (isFrat ? '#C9A96E' : '#FF8200') : 'rgba(255,255,255,0.05)',
                border: pricingMode === mode ? 'none' : '1px solid rgba(255,255,255,0.15)',
                color: pricingMode === mode && isFrat ? '#1a1a2e' : 'white',
                cursor: 'pointer', textTransform: 'uppercase',
              }}>
                {mode === 'dynamic' ? '\uD83D\uDCC8 Dynamic' : '\uD83D\uDCCC Flat'}
              </button>
            ))}
          </div>

          {/* Price inputs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: FONT, fontSize: 11, color: '#8A8A95', marginBottom: 4 }}>
                {pricingMode === 'flat' ? 'Cover Price' : 'Base Price'}
              </p>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#8A8A95', fontSize: 15 }}>$</span>
                <input type="number" value={baseInput} onChange={e => setBaseInput(e.target.value)} placeholder={pricingMode === 'flat' ? '10' : '5'} step="0.50" min="1"
                  style={{ ...inputStyle, width: '100%', paddingLeft: 24 }} />
              </div>
            </div>
            {pricingMode === 'dynamic' && (
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: FONT, fontSize: 11, color: '#8A8A95', marginBottom: 4 }}>Cap Price</p>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#8A8A95', fontSize: 15 }}>$</span>
                  <input type="number" value={capInput} onChange={e => setCapInput(e.target.value)} placeholder="20" step="1" min="2"
                    style={{ ...inputStyle, width: '100%', paddingLeft: 24 }} />
                </div>
              </div>
            )}
          </div>
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontFamily: FONT, fontSize: 11, color: '#8A8A95', marginBottom: 4 }}>Total Available</p>
            <input type="number" value={capacityInput} onChange={e => setCapacityInput(e.target.value)} placeholder="100" min="1"
              style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: FONT, fontSize: 11, color: '#8A8A95', marginBottom: 4 }}>Open</p>
              <input type="time" value={openTimeInput} onChange={e => setOpenTimeInput(e.target.value)}
                style={{ ...inputStyle, width: '100%', colorScheme: 'dark' }} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: FONT, fontSize: 11, color: '#8A8A95', marginBottom: 4 }}>Close</p>
              <input type="time" value={closeTimeInput} onChange={e => setCloseTimeInput(e.target.value)}
                style={{ ...inputStyle, width: '100%', colorScheme: 'dark' }} />
            </div>
          </div>
          <button onClick={handleStartSelling} disabled={saving} className="active:scale-[0.97] transition-transform" style={{
            width: '100%', height: 44, borderRadius: 12,
            background: saving ? 'rgba(0, 255, 136, 0.3)' : '#00FF88',
            color: '#050507', fontWeight: 700, fontSize: 15, border: 'none',
            cursor: saving ? 'wait' : 'pointer', fontFamily: FONT,
          }}>
            {saving ? 'Starting...' : 'START SELLING'}
          </button>
          {saveMsg && <p style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: saveMsg.startsWith('Failed') ? '#FF2D05' : '#22C55E', textAlign: 'center', marginTop: 6 }}>{saveMsg}</p>}
        </div>
      )}
    </div>
  );
}
