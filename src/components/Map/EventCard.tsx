import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getEventTimeLabel } from '../../lib/eventUtils';
import { formatCoverPrice } from '../../lib/coverPricing';
import { useTicketPurchase } from '../../hooks/useTicketPurchase';
import type { VenueEvent } from '../../lib/types';

const FONT = 'Satoshi, sans-serif';
const ACCENT = '#00D4FF';
const ORANGE = '#FF8200';

const EVENT_TYPE_LABELS: Record<VenueEvent['event_type'], string> = {
  party: 'Party',
  brand: 'Brand Event',
  greek: 'Greek Life',
  launch: 'Launch',
  special: 'Special',
};

const EVENT_TYPE_EMOJI: Record<VenueEvent['event_type'], string> = {
  party: '\u{1F389}',
  brand: '\u{1F48E}',
  greek: '\u{1F3DB}',
  launch: '\u{1F680}',
  special: '\u{2B50}',
};

function formatEventDate(startTime: string, endTime: string | null): string {
  const start = new Date(startTime);
  const dayLabel = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const startStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (!endTime) return `${dayLabel}, ${startStr}`;
  const end = new Date(endTime);
  const endStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel}, ${startStr} – ${endStr}`;
}

function formatSaleStart(saleStartsAt: string | null): string {
  if (!saleStartsAt) return '';
  const d = new Date(saleStartsAt);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

interface EventCardProps {
  event: VenueEvent;
  userId?: string | null;
  venueName?: string | null;
  onSignIn?: () => void;
  onClose: () => void;
}

export function EventCard({ event, userId, venueName, onSignIn, onClose }: EventCardProps) {
  const { purchasing, purchaseTicket } = useTicketPurchase(userId ?? null);
  const [existingQR, setExistingQR] = useState<string | null>(null);
  const [checkingTicket, setCheckingTicket] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<{ qrCode: string; pricePaid: number } | null>(null);
  const [buyError, setBuyError] = useState('');

  // Check if user already has a ticket
  useEffect(() => {
    if (!userId || !event.has_tickets) return;
    setCheckingTicket(true);
    supabase
      .from('event_tickets')
      .select('qr_code')
      .eq('user_id', userId)
      .eq('event_id', event.id)
      .in('status', ['completed', 'used'])
      .maybeSingle()
      .then(({ data }) => {
        setExistingQR(data?.qr_code ?? null);
        setCheckingTicket(false);
      });
  }, [userId, event.id, event.has_tickets]);

  const handleBuy = useCallback(async () => {
    setBuyError('');
    if (!userId) { onSignIn?.(); return; }
    const result = await purchaseTicket(event.id);
    if (result.success && result.qrCode) {
      setPurchaseResult({ qrCode: result.qrCode, pricePaid: result.pricePaid ?? 0 });
    } else {
      setBuyError(result.error ?? 'Purchase failed');
    }
  }, [userId, event.id, purchaseTicket, onSignIn]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const now = new Date();
  const hasTickets = event.has_tickets && event.ticket_price != null && event.total_tickets != null;
  const ticketsRemaining = hasTickets
    ? Math.max(0, (event.total_tickets ?? 0) - event.tickets_sold)
    : null;
  const soldOut = hasTickets && ticketsRemaining === 0;
  const saleNotStarted = hasTickets && event.sale_starts_at && new Date(event.sale_starts_at) > now;
  const saleEnded = hasTickets && event.sale_ends_at && new Date(event.sale_ends_at) < now;
  const remainingPct = hasTickets && (event.total_tickets ?? 0) > 0
    ? ticketsRemaining! / event.total_tickets!
    : 1;
  const almostSoldOut = hasTickets && remainingPct < 0.2 && !soldOut;
  const sellingFast = hasTickets && ticketsRemaining !== null && ticketsRemaining < 30 && !soldOut;

  const activeQR = purchaseResult?.qrCode ?? existingQR;

  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        zIndex: 500, pointerEvents: 'auto',
      }}
    >
      <div
        className="event-card-slide-up"
        style={{
          background: '#111114',
          borderTop: `2px solid ${ACCENT}`,
          borderRadius: '20px 20px 0 0',
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          boxShadow: `0 -4px 30px rgba(0, 212, 255, 0.15)`,
          maxHeight: '85vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 20px 0' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: '#2A2A30' }} />
        </div>

        <div style={{ padding: '10px 20px 0' }}>
          {/* Type badge + close */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{
                fontFamily: FONT, fontSize: 11, fontWeight: 700, color: ACCENT,
                background: 'rgba(0, 212, 255, 0.12)', border: '1px solid rgba(0, 212, 255, 0.25)',
                borderRadius: 20, padding: '3px 10px', letterSpacing: '0.5px',
              }}>
                {EVENT_TYPE_EMOJI[event.event_type]} {EVENT_TYPE_LABELS[event.event_type]}
              </span>
              {hasTickets && !soldOut && !saleEnded && (
                <span style={{
                  fontFamily: FONT, fontSize: 11, fontWeight: 700,
                  color: sellingFast ? '#FF2D05' : ORANGE,
                  background: sellingFast ? 'rgba(255, 45, 5, 0.12)' : 'rgba(255, 130, 0, 0.12)',
                  border: `1px solid ${sellingFast ? 'rgba(255,45,5,0.3)' : 'rgba(255,130,0,0.3)'}`,
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  {sellingFast ? 'SELLING FAST' : 'TICKETS'}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8,
                width: 32, height: 32, color: '#8A8A95', fontSize: 18, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              &times;
            </button>
          </div>

          {/* Time */}
          {(() => {
            const tl = getEventTimeLabel(event.start_time, event.expires_at);
            return (
              <p style={{
                fontFamily: FONT, fontSize: 13, fontWeight: 700,
                color: tl.isNow ? '#00FF88' : ACCENT,
                margin: '0 0 4px',
              }}>
                {tl.isNow ? '\u26A1' : '\uD83D\uDD59'} {tl.text}
              </p>
            );
          })()}

          {/* Title */}
          <h3 style={{ fontFamily: FONT, fontSize: 20, fontWeight: 800, color: 'white', margin: '0 0 4px', lineHeight: 1.2 }}>
            {event.title}
          </h3>

          {/* Venue + host */}
          {(venueName || event.host_name) && (
            <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: ACCENT, margin: '0 0 4px' }}>
              {venueName ? `${venueName}` : ''}{venueName && event.host_name ? ' · ' : ''}{event.host_name}
            </p>
          )}

          {/* Date + time */}
          <p style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95', margin: '0 0 10px' }}>
            {formatEventDate(event.start_time, event.end_time)}
          </p>

          {/* Description */}
          {event.description && (
            <p style={{
              fontFamily: FONT, fontSize: 13, color: 'rgba(255,255,255,0.6)',
              margin: '0 0 14px', lineHeight: 1.45,
            }}>
              {event.description}
            </p>
          )}

          {/* ── Ticket Section ── */}
          {hasTickets && (
            <div style={{ marginBottom: 16 }}>
              {/* Price + remaining count */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <p style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: ORANGE, margin: 0 }}>
                  {formatCoverPrice(event.ticket_price!)} per ticket
                </p>
                {!soldOut && ticketsRemaining !== null && (
                  <p style={{
                    fontFamily: FONT, fontSize: 12, fontWeight: 600,
                    color: almostSoldOut ? '#FF2D05' : '#8A8A95',
                    margin: 0,
                  }}>
                    {almostSoldOut ? '⚠ Almost sold out! ' : ''}{ticketsRemaining} of {event.total_tickets} left
                  </p>
                )}
              </div>

              {/* Progress bar */}
              {event.total_tickets != null && event.total_tickets > 0 && (
                <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', marginBottom: 12 }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    background: almostSoldOut ? '#FF2D05' : ORANGE,
                    width: `${Math.round((1 - remainingPct) * 100)}%`,
                    transition: 'width 0.4s',
                  }} />
                </div>
              )}

              {/* CTA — varies by state */}
              {activeQR ? (
                // User has a ticket
                <div>
                  <div style={{
                    background: 'rgba(0, 255, 136, 0.08)', border: '1px solid rgba(0, 255, 136, 0.25)',
                    borderRadius: 12, padding: '12px 14px', marginBottom: 8, textAlign: 'center',
                  }}>
                    <p style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: '#00FF88', margin: '0 0 2px' }}>
                      {'\u2705'} You're in!
                    </p>
                    <p style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95', margin: 0 }}>
                      {purchaseResult
                        ? `Ticket purchased — ${formatCoverPrice(purchaseResult.pricePaid)}`
                        : 'Tap to view your QR code'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowQR(v => !v)}
                    style={{
                      width: '100%', height: 44, borderRadius: 12, border: `1px solid ${ACCENT}`,
                      background: 'rgba(0, 212, 255, 0.08)',
                      color: ACCENT, fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {showQR ? 'Hide QR Code' : 'View QR Code'}
                  </button>
                  {showQR && (
                    <div style={{
                      marginTop: 10, background: 'white', borderRadius: 12,
                      padding: '20px', textAlign: 'center',
                    }}>
                      <p style={{ fontFamily: FONT, fontSize: 11, color: '#8A8A95', marginBottom: 8 }}>
                        Show this at the door
                      </p>
                      <p style={{
                        fontFamily: 'monospace', fontSize: 15, fontWeight: 800,
                        color: '#000', letterSpacing: '0.5px', margin: 0, wordBreak: 'break-all',
                      }}>
                        {activeQR}
                      </p>
                    </div>
                  )}
                </div>
              ) : soldOut ? (
                <button disabled style={{
                  width: '100%', height: 48, borderRadius: 12, border: 'none',
                  background: 'rgba(255,255,255,0.06)', color: '#55555F',
                  fontFamily: FONT, fontSize: 15, fontWeight: 700, cursor: 'not-allowed',
                }}>
                  Sold Out
                </button>
              ) : saleNotStarted ? (
                <div style={{
                  textAlign: 'center', padding: '12px',
                  background: 'rgba(255,255,255,0.03)', borderRadius: 12,
                }}>
                  <p style={{ fontFamily: FONT, fontSize: 14, color: '#8A8A95', margin: 0 }}>
                    On sale {formatSaleStart(event.sale_starts_at)}
                  </p>
                </div>
              ) : saleEnded ? (
                <button disabled style={{
                  width: '100%', height: 48, borderRadius: 12, border: 'none',
                  background: 'rgba(255,255,255,0.06)', color: '#55555F',
                  fontFamily: FONT, fontSize: 15, fontWeight: 700, cursor: 'not-allowed',
                }}>
                  Sales Ended
                </button>
              ) : checkingTicket ? (
                <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="w-5 h-5 border-2 border-[#00D4FF] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <button
                  onClick={handleBuy}
                  disabled={purchasing}
                  className="active:scale-[0.97] transition-transform"
                  style={{
                    width: '100%', height: 48, borderRadius: 12, border: 'none',
                    background: purchasing ? 'rgba(255, 130, 0, 0.4)' : `linear-gradient(135deg, ${ORANGE}, #F1B82D)`,
                    color: 'white', fontFamily: FONT, fontSize: 15, fontWeight: 800,
                    cursor: purchasing ? 'wait' : 'pointer',
                  }}
                >
                  {purchasing ? 'Processing...' : `Buy Ticket — ${formatCoverPrice(event.ticket_price!)}`}
                </button>
              )}

              {buyError && (
                <p style={{
                  fontFamily: FONT, fontSize: 12, color: '#FF2D05',
                  textAlign: 'center', marginTop: 8,
                }}>
                  {buyError}
                </p>
              )}

              {!userId && !soldOut && !saleNotStarted && !saleEnded && (
                <p style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95', textAlign: 'center', marginTop: 8 }}>
                  <button
                    onClick={onSignIn}
                    style={{ background: 'none', border: 'none', color: ACCENT, fontFamily: FONT, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
                  >
                    Sign in
                  </button>
                  {' '}to buy a ticket
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
