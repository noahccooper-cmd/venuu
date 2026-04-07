import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { formatCoverPriceShort, formatCoverPrice } from '../../lib/coverPricing';
import type { CoverPriceInfo } from '../../hooks/useCoverPricing';
import type { PurchaseResult } from '../../hooks/useCoverPurchase';

const FONT = 'Satoshi, sans-serif';

interface CoverPurchaseSheetProps {
  venueId: string;
  venueName: string;
  priceInfo: CoverPriceInfo;
  alreadyPurchasedQR?: string | null;
  purchasing: boolean;
  onBuy: (configId: string, venueId: string) => Promise<PurchaseResult>;
  onClose: () => void;
}

interface PriceTick {
  price: number;
  recorded_at: string;
}

export function CoverPurchaseSheet({
  venueId, venueName, priceInfo, alreadyPurchasedQR, purchasing, onBuy, onClose,
}: CoverPurchaseSheetProps) {
  const [priceHistory, setPriceHistory] = useState<PriceTick[]>([]);
  const [result, setResult] = useState<PurchaseResult | null>(null);

  // Fetch recent price history for sparkline
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('cover_price_history')
        .select('price, recorded_at')
        .eq('cover_config_id', priceInfo.configId)
        .order('recorded_at', { ascending: true })
        .limit(60);
      if (data) setPriceHistory(data as PriceTick[]);
    };
    load();
  }, [priceInfo.configId]);

  const handleBuy = useCallback(async () => {
    const res = await onBuy(priceInfo.configId, venueId);
    setResult(res);
  }, [onBuy, priceInfo.configId, venueId]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const soldPct = priceInfo.capacity > 0 ? Math.round((priceInfo.coversSold / priceInfo.capacity) * 100) : 0;
  const priceChangeFromBase = priceInfo.currentPrice - priceInfo.basePrice;
  const arrow = priceInfo.priceDirection === 'up' ? '\u2191' : priceInfo.priceDirection === 'down' ? '\u2193' : '\u2192';
  const arrowColor = priceInfo.priceDirection === 'up' ? '#00FF88' : priceInfo.priceDirection === 'down' ? '#FF8200' : '#8A8A95';
  const fee = Math.round(priceInfo.currentPrice * 0.08);

  // ── SUCCESS SCREEN ──
  if (result?.success) {
    return (
      <div onClick={handleBackdrop} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 600 }}>
        <div className="event-card-slide-up" style={{
          background: '#111114', borderTop: '3px solid #00FF88',
          borderRadius: '20px 20px 0 0', padding: '24px 20px',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: FONT, fontSize: 36, fontWeight: 800, color: '#00FF88', margin: '0 0 8px' }}>
              You're in! {'\uD83C\uDF89'}
            </p>
            <p style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: 'white', margin: '0 0 4px' }}>
              {result.venueName ?? venueName}
            </p>
            <p style={{ fontFamily: FONT, fontSize: 14, color: '#8A8A95', margin: '0 0 20px' }}>
              Paid {formatCoverPrice(result.pricePaid ?? priceInfo.currentPrice)}
            </p>
            {/* QR Code display */}
            <div style={{
              background: 'white', borderRadius: 16, padding: '20px', margin: '0 auto 16px',
              width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <p style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#000', textAlign: 'center', wordBreak: 'break-all' }}>
                {result.qrCode}
              </p>
            </div>
            <p style={{ fontFamily: FONT, fontSize: 13, color: '#8A8A95', margin: '0 0 20px' }}>
              Show this at the door
            </p>
            <button
              onClick={onClose}
              className="active:scale-[0.98] transition-transform"
              style={{
                width: '100%', height: 48, borderRadius: 12, background: '#00FF88',
                color: '#050507', fontWeight: 700, fontSize: 16, border: 'none',
                cursor: 'pointer', fontFamily: FONT,
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ALREADY PURCHASED ──
  if (alreadyPurchasedQR) {
    return (
      <div onClick={handleBackdrop} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 600 }}>
        <div className="event-card-slide-up" style={{
          background: '#111114', borderTop: '3px solid #22C55E',
          borderRadius: '20px 20px 0 0', padding: '24px 20px',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: '#22C55E', margin: '0 0 4px' }}>
              {'\u2705'} Cover Purchased
            </p>
            <p style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: 'white', margin: '0 0 16px' }}>
              {venueName}
            </p>
            <div style={{
              background: 'white', borderRadius: 16, padding: '20px', margin: '0 auto 16px',
              width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <p style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#000', textAlign: 'center', wordBreak: 'break-all' }}>
                {alreadyPurchasedQR}
              </p>
            </div>
            <p style={{ fontFamily: FONT, fontSize: 13, color: '#8A8A95', margin: '0 0 16px' }}>
              Show this at the door
            </p>
            <button onClick={onClose} className="active:scale-[0.98] transition-transform" style={{
              width: '100%', height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontWeight: 600, fontSize: 14,
              cursor: 'pointer', fontFamily: FONT,
            }}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PURCHASE SHEET ──
  return (
    <div onClick={handleBackdrop} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 600 }}>
      <div className="event-card-slide-up" style={{
        background: '#111114', borderTop: '2px solid #FF8200',
        borderRadius: '20px 20px 0 0', padding: '16px 20px',
        paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
      }}>
        {/* Handle + close */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: 'white', margin: 0 }}>
            {venueName}
          </p>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8,
            width: 32, height: 32, color: '#8A8A95', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>&times;</button>
        </div>

        {/* THE TICKER */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
            <span style={{ fontFamily: FONT, fontSize: 48, fontWeight: 800, color: 'white', lineHeight: 1 }}>
              {formatCoverPriceShort(priceInfo.currentPrice)}
            </span>
            <span style={{ fontSize: 24, fontWeight: 800, color: arrowColor }}>
              {arrow}
            </span>
          </div>
          {priceChangeFromBase > 0 && (
            <p style={{ fontFamily: FONT, fontSize: 12, color: '#00FF88', margin: '4px 0 0' }}>
              +{formatCoverPrice(priceChangeFromBase)} from {formatCoverPriceShort(priceInfo.basePrice)}
            </p>
          )}
        </div>

        {/* SPARKLINE */}
        {priceHistory.length > 2 && (
          <div style={{ height: 40, marginBottom: 12, padding: '0 4px' }}>
            <svg width="100%" height="40" viewBox={`0 0 ${priceHistory.length - 1} 40`} preserveAspectRatio="none">
              {(() => {
                const prices = priceHistory.map(t => t.price);
                const minP = Math.min(...prices);
                const maxP = Math.max(...prices);
                const range = maxP - minP || 1;
                const points = prices.map((p, i) => `${i},${40 - ((p - minP) / range) * 36 - 2}`).join(' ');
                return <polyline points={points} fill="none" stroke="#FF8200" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
              })()}
            </svg>
          </div>
        )}

        {/* URGENCY INDICATORS */}
        {soldPct >= 80 && (
          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: '#FF2D05', textAlign: 'center', marginBottom: 8 }}>
            {'\uD83D\uDD25'} Almost sold out!
          </p>
        )}
        {priceChangeFromBase > 0 && priceChangeFromBase / (priceInfo.capPrice - priceInfo.basePrice) > 0.3 && soldPct < 80 && (
          <p style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#00FF88', textAlign: 'center', marginBottom: 8 }}>
            {'\uD83D\uDCC8'} Price up {Math.round((priceChangeFromBase / priceInfo.basePrice) * 100)}% tonight
          </p>
        )}
        {priceInfo.priceDirection === 'down' && soldPct < 80 && priceChangeFromBase <= 0 && (
          <p style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#FF8200', textAlign: 'center', marginBottom: 8 }}>
            {'\uD83D\uDCC9'} Price just dropped — buy now!
          </p>
        )}

        {/* PROGRESS BAR + SOCIAL PROOF */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95' }}>
              {priceInfo.coversRemaining} of {priceInfo.capacity} remaining
            </span>
            <span style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95' }}>
              {priceInfo.coversSold} bought tonight
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
            <div style={{
              height: '100%', borderRadius: 2, background: soldPct >= 80 ? '#FF2D05' : '#FF8200',
              width: `${soldPct}%`, transition: 'width 0.5s',
            }} />
          </div>
        </div>

        {/* ERROR */}
        {result && !result.success && (
          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: '#FF2D05', textAlign: 'center', marginBottom: 8 }}>
            {result.error}
          </p>
        )}

        {/* FEE DISCLOSURE */}
        <p style={{ fontFamily: FONT, fontSize: 11, color: '#55555F', textAlign: 'center', marginBottom: 12 }}>
          Includes {formatCoverPrice(fee)} service fee
        </p>

        {/* BUY BUTTON */}
        <button
          onClick={handleBuy}
          disabled={purchasing}
          className="active:scale-[0.98] transition-transform"
          style={{
            width: '100%', height: 52, borderRadius: 12,
            background: purchasing ? 'rgba(255, 130, 0, 0.4)' : '#FF8200',
            color: 'white', fontWeight: 700, fontSize: 17, border: 'none',
            cursor: purchasing ? 'wait' : 'pointer', fontFamily: FONT,
            opacity: purchasing ? 0.7 : 1,
          }}
        >
          {purchasing ? 'Processing...' : `Buy Cover \u2014 ${formatCoverPriceShort(priceInfo.currentPrice)}`}
        </button>
      </div>
    </div>
  );
}
