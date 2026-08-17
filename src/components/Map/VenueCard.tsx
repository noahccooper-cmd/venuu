import { useRef, useState, useEffect, useCallback } from 'react';
import { formatCount, getCapacityPercent } from '../../lib/utils';
import { getEventTimeLabel } from '../../lib/eventUtils';
import { PunchCard } from '../Loyalty/PunchCard';
import { formatCoverPriceShort } from '../../lib/coverPricing';
import { recordSignal } from '../../lib/signals';
import { openDirectionsTo } from '../../lib/directions';
import { getVenueStatus } from '../../lib/venueHours';
import type { Venue, Headcount, VenueEvent } from '../../lib/types';
import type { CoverPriceInfo } from '../../hooks/useCoverPricing';

type SheetState = 'hidden' | 'peeked' | 'expanded';

interface VenueSheetProps {
  venue: Venue;
  headcount: Headcount | null;
  venueEvent?: VenueEvent | null;
  username: string;
  userId: string | null;
  onSignIn: () => void;
  onClose: () => void;
  onGetThere?: () => void;
  getThereLoading?: boolean;
  onAskVenny?: () => void;
  coverPriceInfo?: CoverPriceInfo | null;
  onBuyCover?: () => void;
}

/* ── Uber deep link ── */

function getUberUrl(venue: Venue): string {
  const params = new URLSearchParams({
    action: 'setPickup',
    'dropoff[latitude]': String(venue.lat),
    'dropoff[longitude]': String(venue.lng),
    'dropoff[nickname]': venue.name,
  });
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) return `uber://?${params.toString()}`;
  return `https://m.uber.com/ul/?${params.toString()}`;
}

/* ── Tonight Banner (peek-visible, below venue name) ── */

function TonightBanner({ venue }: { venue: Venue }) {
  if (!venue.tonight_special) return null;
  const specials = venue.tonight_special.split('|').map(s => s.trim()).filter(Boolean);
  if (specials.length === 0) return null;

  return (
    <div className="tonight-banner">
      <div className="tonight-banner-scroll">
        {specials.map((special, i) => (
          <span key={i} className="tonight-pill">{'\uD83C\uDF89'} {special}</span>
        ))}
      </div>
    </div>
  );
}

/* ── Specials Row (scrollable chips) ── */

function SpecialsRow({ venue }: { venue: Venue }) {
  if (!venue.tonight_special) return null;
  const specials = venue.tonight_special.split('|').map(s => s.trim()).filter(Boolean);
  if (specials.length === 0) return null;

  return (
    <div className="specials-section">
      <div className="specials-label">{'\uD83C\uDF89'} TONIGHT</div>
      <div className="specials-scroll">
        {specials.map((special, i) => (
          <div key={i} className="special-chip">{special}</div>
        ))}
      </div>
    </div>
  );
}

/* ── Main VenueSheet (Pull-Up Bottom Sheet) ── */

const EVENT_TYPE_LABELS: Record<VenueEvent['event_type'], string> = {
  party: 'Party',
  brand: 'Brand',
  greek: 'Greek',
  launch: 'Launch',
  special: 'Special',
};


export function VenueSheet({
  venue,
  headcount,
  venueEvent,
  userId,
  onSignIn,
  onClose,
  onGetThere,
  getThereLoading,
  onAskVenny,
  coverPriceInfo,
  onBuyCover,
}: VenueSheetProps) {
  const [sheetState, setSheetState] = useState<SheetState>('peeked');

  const sheetRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDragging = useRef(false);
  const isLive = headcount?.is_live ?? false;
  const count = headcount?.current_count ?? 0;
  const peak = headcount?.peak_count ?? 0;
  const pct = getCapacityPercent(count, venue.capacity);

  // Reset state when venue changes
  useEffect(() => {
    setSheetState('peeked');
    if (sheetRef.current) sheetRef.current.scrollTop = 0;
  }, [venue.id]);

  useEffect(() => {
    if (venue?.id) {
      recordSignal({
        venueId: venue.id,
        signalType: 'card_view',
        metadata: { venue_name: venue.name },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id]);

  const dismiss = useCallback(() => {
    setSheetState('hidden');
    setTimeout(onClose, 300);
  }, [onClose]);

  const handleUber = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const deepLink = getUberUrl(venue);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      window.location.href = deepLink;
      setTimeout(() => {
        window.location.href = `https://m.uber.com/ul/?action=setPickup&dropoff[latitude]=${venue.lat}&dropoff[longitude]=${venue.lng}&dropoff[nickname]=${encodeURIComponent(venue.name)}`;
      }, 500);
    } else {
      window.open(deepLink, '_blank');
    }
  }, [venue]);

  /* ── Swipe / drag gesture handling ── */

  const finishDrag = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;

    const diff = startYRef.current - currentYRef.current; // positive = swipe up

    // Reset any drag transform
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }

    if (diff > 60) {
      // SWIPED UP
      if (sheetState === 'peeked') setSheetState('expanded');
    } else if (diff < -60) {
      // SWIPED DOWN
      if (sheetState === 'expanded' && (sheetRef.current?.scrollTop ?? 0) < 5) {
        setSheetState('peeked');
      } else if (sheetState === 'peeked') {
        dismiss();
      }
    }
  }, [sheetState, dismiss]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    currentYRef.current = e.touches[0].clientY;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    currentYRef.current = e.touches[0].clientY;

    // Visual drag feedback in peek mode
    const diff = currentYRef.current - startYRef.current;
    if (sheetRef.current && sheetState === 'peeked' && diff < 0) {
      const offset = Math.max(diff, -40);
      sheetRef.current.style.transform = `translateY(${offset}px)`;
    }
  }, [sheetState]);

  const handleTouchEnd = useCallback(() => {
    finishDrag();
  }, [finishDrag]);

  // Mouse events for desktop testing
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startYRef.current = e.clientY;
    currentYRef.current = e.clientY;
    isDragging.current = true;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    currentYRef.current = e.clientY;
  }, []);

  const handleMouseUp = useCallback(() => {
    finishDrag();
  }, [finishDrag]);

  // Handle toggle
  const handleHandleTap = useCallback(() => {
    if (sheetState === 'peeked') setSheetState('expanded');
    else if (sheetState === 'expanded') setSheetState('peeked');
  }, [sheetState]);

  return (
    <>
    {/* Backdrop overlay */}
    <div
      className={`venue-sheet-backdrop ${sheetState === 'hidden' ? '' : 'visible'}`}
      onClick={dismiss}
    />
    <div
      ref={sheetRef}
      className={`venue-sheet ${sheetState}`}
      onClick={e => e.stopPropagation()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Handle area — tappable to expand/collapse */}
      <div className="sheet-handle-area" onClick={handleHandleTap}>
        <div className="sheet-handle" />
        {sheetState === 'peeked' && (
          <div className="swipe-hint">Tap or swipe up for more</div>
        )}
      </div>

      {/* Close button (expanded only via CSS) */}
      <button className="sheet-close-btn" onClick={dismiss}>{'\u2715'}</button>

      {/* ═══ BANNER IMAGE (full-width, above peek content) ═══ */}
      {venue.image_url && (
        <div className="sheet-banner-wrap">
          <img src={venue.image_url} className="sheet-banner-img" alt={venue.name} />
          <div className="sheet-banner-gradient" />
          {isLive && (
            <div className="sheet-live-badge">
              <span className="ld" /> LIVE
            </div>
          )}
        </div>
      )}

      {/* ═══ PEEK CONTENT (always visible) ═══ */}
      <div className="sheet-peek-content">
        {/* Fraternity header (marble/gold styling) */}
        {venue.category === 'fraternity' && (
          <div style={{ padding: '4px 16px 8px', textAlign: 'center', borderBottom: '1px solid rgba(201,169,110,0.15)' }}>
            <h2 style={{ fontFamily: 'Satoshi, sans-serif', fontSize: 28, fontWeight: 800, color: '#C9A96E', margin: '0 0 2px', letterSpacing: '0.03em' }}>
              {venue.name}
            </h2>
            {venue.address && (
              <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: 12, color: '#8A8A95', margin: '4px 0 0' }}>
                {venue.address}
              </p>
            )}
            {count > 0 && (
              <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: 14, fontWeight: 700, color: '#C9A96E', margin: '8px 0 0' }}>
                {formatCount(count)} inside
              </p>
            )}
          </div>
        )}

        {/* Featured pill */}
        {venue.featured && venue.category !== 'fraternity' && (
          <div style={{ padding: '0 16px 4px' }}>
            <span style={{
              display: 'inline-block',
              background: '#7C3AED',
              color: 'white',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'Satoshi, sans-serif',
              borderRadius: 6,
              padding: '4px 10px',
            }}>
              {'\uD83D\uDC51'} FEATURED VENUE
            </span>
          </div>
        )}
        {/* Active Event Banner */}
        {venueEvent && (() => {
          const tl = getEventTimeLabel(venueEvent.start_time, venueEvent.expires_at);
          return (
            <div style={{
              margin: '0 16px 8px',
              padding: '10px 12px',
              background: 'rgba(0, 212, 255, 0.06)',
              borderRadius: '10px',
              borderLeft: '3px solid #00D4FF',
              animation: 'eventCardPulse 3s ease-in-out infinite',
            }}>
              {/* Badge */}
              <span style={{
                display: 'inline-block',
                fontSize: '10px',
                fontWeight: 700,
                color: '#00D4FF',
                background: 'rgba(0, 212, 255, 0.12)',
                border: '1px solid rgba(0, 212, 255, 0.25)',
                borderRadius: 12,
                padding: '2px 8px',
                letterSpacing: '0.5px',
                textTransform: 'uppercase' as const,
                fontFamily: 'Satoshi, sans-serif',
                marginBottom: '6px',
              }}>
                {EVENT_TYPE_LABELS[venueEvent.event_type]}
              </span>
              {/* TIME — the hook */}
              <p style={{
                fontSize: '16px',
                fontWeight: 800,
                color: tl.isNow ? '#00FF88' : '#00D4FF',
                margin: '0 0 4px',
                lineHeight: 1.2,
                fontFamily: 'Satoshi, sans-serif',
                letterSpacing: '0.5px',
                animation: tl.isNow ? 'eventCardPulse 1.5s ease-in-out infinite' : 'none',
              }}>
                {tl.isNow ? '\u26A1' : '\uD83D\uDD59'} {tl.text}
              </p>
              {/* Title */}
              <p style={{
                fontSize: '14px',
                fontWeight: 700,
                color: '#00D4FF',
                margin: '0 0 2px',
                lineHeight: 1.3,
                fontFamily: 'Satoshi, sans-serif',
              }}>
                {'\u26A1'} {venueEvent.title}
              </p>
              {/* Host */}
              <p style={{
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
                margin: 0,
                fontFamily: 'Satoshi, sans-serif',
              }}>
                Hosted by {venueEvent.host_name}
              </p>
            </div>
          );
        })()}

        {/* Name + Rating (hidden for fraternities — shown in frat header above) */}
        {venue.category !== 'fraternity' && <div className="sheet-info">
          <div className="sheet-name-row">
            <h2 className="sheet-name" style={venue.featured ? { borderLeft: '3px solid #A855F7', paddingLeft: 10 } : undefined}>{venue.name}</h2>
          </div>
          {venue.address && (
            <button
              type="button"
              onClick={() => openDirectionsTo(venue.lat, venue.lng, venue.name, venue.id)}
              className="sheet-address"
            >
              {'\uD83D\uDCCD'} {venue.address}
            </button>
          )}
        </div>}

        {/* Cover/Special/Tonight — bars only */}
        {venue.category !== 'fraternity' && (
          <>
            <div className="cover-banner">
              <span className="cover-pill">
                {'\uD83D\uDCB5'} {!venue.cover_charge || venue.cover_charge.toUpperCase() === 'FREE' || venue.cover_charge.toUpperCase() === 'NO COVER' ? 'FREE ENTRY' : `COVER: ${venue.cover_charge}`}
              </span>
            </div>
            <TonightBanner venue={venue} />
          </>
        )}

        {/* Open/Closed status + Live Count — gated by hours_json (venueHours engine) */}
        {(() => {
          const status = getVenueStatus((venue as { hours_json?: unknown }).hours_json as never);

          // Small inline status pill (no CSS additions required).
          const pill = (color: string, bg: string, label: string, detail?: string) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 700, fontFamily: 'Satoshi, sans-serif',
                color, background: bg, borderRadius: 8, padding: '4px 10px',
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} /> {label}
              </span>
              {detail && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: 'Satoshi, sans-serif' }}>
                  {detail}
                </span>
              )}
            </div>
          );

          // Closed right now — a closed bar should not display a headcount.
          if (status.status === 'closed') {
            return (
              <div className="sheet-live-section empty">
                {pill('#FF5A5A', 'rgba(255,90,90,0.12)', 'Closed', status.detail)}
              </div>
            );
          }

          // Event-driven venue (e.g. Jannus) — no fixed open/close.
          if (status.status === 'varies') {
            return (
              <div className="sheet-live-section empty">
                {pill('#FFB13D', 'rgba(255,177,61,0.12)', 'Hours vary', "check tonight's event")}
              </div>
            );
          }

          // Open (or hours unknown) — show the live headcount as before.
          const openPill = status.status === 'open'
            ? pill('#00FF88', 'rgba(0,255,136,0.10)', 'Open', status.detail)
            : null;

          return isLive ? (
            <div className="sheet-live-section">
              {openPill}
              <div className="sheet-live-row">
                <span className="sheet-live-pill"><span className="ld" /> LIVE</span>
                <span className="sheet-live-count">{formatCount(count)}</span>
                <span className="sheet-live-label">inside</span>
                {peak > 0 && (
                  <span className="sheet-live-peak">Peak: {formatCount(peak)}</span>
                )}
              </div>
              {pct !== null && (
                <div className="sheet-bar-row">
                  <div className="sheet-bar">
                    <div
                      className="sheet-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="sheet-bar-pct">{pct}%</span>
                </div>
              )}
            </div>
          ) : (
            <div className="sheet-live-section empty">
              {openPill}
              <span className="sheet-no-data">No live count yet</span>
            </div>
          );
        })()}

        {/* Get There — primary action */}
        {onGetThere && (
          <div style={{ padding: '0 16px 4px' }}>
            <button
              type="button"
              onClick={onGetThere}
              disabled={getThereLoading}
              className="active:scale-[0.98] transition-transform"
              style={{
                width: '100%',
                height: '48px',
                borderRadius: '12px',
                background: getThereLoading ? 'rgba(255, 130, 0, 0.5)' : venue.category === 'fraternity' ? '#C9A96E' : '#FF8200',
                color: 'white',
                fontSize: '15px',
                fontWeight: 700,
                fontFamily: 'Satoshi, sans-serif',
                border: 'none',
                cursor: getThereLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                WebkitTapHighlightColor: 'transparent',
                opacity: getThereLoading ? 0.7 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              {getThereLoading ? 'Finding route...' : '\uD83E\uDDED Get There'}
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="sheet-actions">
          <a href={getUberUrl(venue)} onClick={handleUber} className="sheet-action-btn">
            <span className="sa-icon">{'\uD83D\uDE97'}</span>
            <span className="sa-label">Uber</span>
          </a>
          {venue.category !== 'fraternity' && (venue.phone ? (
            <a href={`tel:${venue.phone}`} className="sheet-action-btn">
              <span className="sa-icon">{'\uD83D\uDCDE'}</span>
              <span className="sa-label">Call</span>
            </a>
          ) : (
            <div className="sheet-action-btn disabled">
              <span className="sa-icon">{'\uD83D\uDCDE'}</span>
              <span className="sa-label">Call</span>
            </div>
          ))}
          {onAskVenny && (
            <button onClick={onAskVenny} className="sheet-action-btn">
              <span className="sa-icon">{'\u2728'}</span>
              <span className="sa-label">Venny</span>
            </button>
          )}
          {coverPriceInfo && onBuyCover && (
            <button onClick={onBuyCover} className="sheet-action-btn">
              <span className="sa-icon" style={{ fontSize: 13, fontWeight: 800, color: '#FF8200' }}>
                {formatCoverPriceShort(coverPriceInfo.currentPrice)}
              </span>
              <span className="sa-label">Cover</span>
            </button>
          )}
        </div>
      </div>

      {/* ═══ EXPANDED CONTENT (hidden when peeked via CSS) ═══ */}
      <div className="sheet-expanded-content">
        {/* Specials */}
        <SpecialsRow venue={venue} />

        {/* Description */}
        {venue.description && (
          <p className="sheet-description">{venue.description}</p>
        )}

        {/* Hours / Website */}
        <div className="sheet-meta">
          {venue.hours && (
            <span className="sheet-meta-item">{'\uD83D\uDD50'} {venue.hours}</span>
          )}
          {venue.website && (
            <span className="sheet-meta-item">
              {'\uD83C\uDF10'}{' '}
              <a href={`https://${venue.website}`} target="_blank" rel="noopener noreferrer" className="sheet-meta-link">
                {venue.website}
              </a>
            </span>
          )}
        </div>

        {/* Loyalty Punch Card — only mounted where loyalty is actually
            enabled, so useLoyalty's queries + realtime subscription don't
            fire on every bar's card, just the ones with loyalty_active. */}
        {venue.category !== 'fraternity' && venue.loyalty_active && (
          <div style={{ padding: '0 16px' }}>
            <PunchCard venueId={venue.id} venueName={venue.name} venueLat={venue.lat} venueLng={venue.lng} loyaltyActive={venue.loyalty_active ?? false} nfcRequired={venue.nfc_required ?? false} userId={userId} onSignIn={onSignIn} />
          </div>
        )}

      </div>
    </div>
    </>
  );
}
