import { useRef, useState, useEffect, useCallback } from 'react';
import { formatCount, getCapacityPercent } from '../../lib/utils';
import { getEventTimeLabel } from '../../lib/eventUtils';
import { useVenueRecaps } from '../../hooks/useVenueRecaps';
import { useGeofence } from '../../hooks/useGeofence';
import MomentOrb from '../Moment/MomentOrb';
import MomentFullScreen from '../Moment/MomentFullScreen';
import { PunchCard } from '../Loyalty/PunchCard';
import { formatCoverPriceShort } from '../../lib/coverPricing';
import { recordSignal } from '../../lib/signals';
import { openDirectionsTo } from '../../lib/directions';
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

/* ── Leave a Recap ── */

function LeaveRecap({ disabled }: {
  venue: Venue;
  username: string;
  submitRecap: (u: string, b: string, s: number) => Promise<void>;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div className="leave-recap" style={{ textAlign: 'center', padding: '16px' }}>
        <div style={{
          color: 'rgba(255,255,255,0.4)',
          fontSize: '13px',
          fontFamily: 'Satoshi, sans-serif',
          fontStyle: 'italic',
        }}>
          {'\u2728'} Your moment at this venue is captured
        </div>
      </div>
    );
  }

  return (
    <div className="leave-recap" style={{
      textAlign: 'center',
      padding: '20px 16px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px dashed rgba(255,255,255,0.12)',
      borderRadius: '12px',
      margin: '12px 0',
    }}>
      <div style={{
        fontSize: '14px',
        fontWeight: 600,
        color: 'rgba(255,255,255,0.7)',
        fontFamily: 'Satoshi, sans-serif',
        marginBottom: '4px',
      }}>
        {'\u2728'} Moments coming soon
      </div>
      <div style={{
        fontSize: '11px',
        color: 'rgba(255,255,255,0.4)',
        fontFamily: 'Satoshi, sans-serif',
      }}>
        paint + capture one moment per venue, develops at 8am
      </div>
    </div>
  );
}

/* ── Recap Section (receives hook data from parent to avoid duplicate subscriptions) ── */

interface RecapSectionProps {
  venue: Venue;
  username: string;
  recapData: ReturnType<typeof useVenueRecaps>;
}

function RecapSection({ venue, username, recapData }: RecapSectionProps) {
  const { recaps, submitRecap, hasUserRecapped } = recapData;
  const [openMomentId, setOpenMomentId] = useState<string | null>(null);

  return (
    <div className="recap-section">
      {/* moments header */}
      <div className="recap-header-row">
        <span className="recap-title">Moments from {venue.name}</span>
      </div>
      <div className="recap-list">
        {(() => {
          // Only show DEVELOPED moments publicly. Locked ones stay
          // private to their author (and visible on author's profile
          // via the read_own_developing RLS policy).
          const developedMoments = recaps.filter(r => {
            if (!r.developed_at) return false;
            return new Date(r.developed_at).getTime() <= Date.now();
          });

          if (developedMoments.length === 0) {
            return (
              <div style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: 'rgba(255,255,255,0.3)',
                fontSize: '13px',
                fontStyle: 'italic',
                fontFamily: 'Satoshi, sans-serif',
              }}>
                No moments captured here yet
              </div>
            );
          }

          return (
            <div style={{
              display: 'flex',
              flexDirection: 'row',
              gap: '14px',
              padding: '12px 4px 16px',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
            }}>
              {developedMoments.map(m => {
                const momentForOrb = {
                  id: m.id,
                  venue_id: venue.id,
                  venue_name: venue.name,
                  photo_url: m.photo_url || '',
                  hue_at_capture: m.hue_at_capture || 0,
                  developed_at: m.developed_at || new Date().toISOString(),
                  created_at: m.created_at,
                  username: m.username,
                };
                return (
                  <MomentOrb
                    key={m.id}
                    moment={momentForOrb}
                    size="venue-card"
                    onTap={() => setOpenMomentId(m.id)}
                  />
                );
              })}
            </div>
          );
        })()}
      </div>
      <LeaveRecap venue={venue} username={username} submitRecap={submitRecap} disabled={hasUserRecapped} />

      {openMomentId && (() => {
        const m = recaps.find(r => r.id === openMomentId);
        if (!m) return null;
        return (
          <MomentFullScreen
            open={true}
            moment={{
              id: m.id,
              venue_id: venue.id,
              venue_name: venue.name,
              photo_url: m.photo_url || '',
              hue_at_capture: m.hue_at_capture || 0,
              developed_at: m.developed_at || new Date().toISOString(),
              created_at: m.created_at,
              username: m.username,
            }}
            onClose={() => setOpenMomentId(null)}
          />
        );
      })()}
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
  username,
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
  const recapRef = useRef<HTMLDivElement>(null);
  const recapData = useVenueRecaps(venue.id, username);
  const geofence = useGeofence(venue.lat, venue.lng);
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

  const handleOpenRecap = useCallback(() => {
    setSheetState('expanded');
    setTimeout(() => {
      recapRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 400);
  }, []);

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

        {/* Live Count */}
        {isLive ? (
          <div className="sheet-live-section">
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
            <span className="sheet-no-data">No live count yet</span>
          </div>
        )}

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
          <button onClick={handleOpenRecap} className="sheet-action-btn">
            <span className="sa-icon">{'\u2B50'}</span>
            <span className="sa-label">Recap</span>
          </button>
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

        {/* Loyalty Punch Card — bars only (frats don't have loyalty) */}
        {venue.category !== 'fraternity' && (
          <div style={{ padding: '0 16px' }}>
            <PunchCard venueId={venue.id} venueName={venue.name} venueLat={venue.lat} venueLng={venue.lng} loyaltyActive={venue.loyalty_active ?? false} nfcRequired={venue.nfc_required ?? false} userId={userId} onSignIn={onSignIn} />
          </div>
        )}

        {/* In-app paint entry — new in 44A. Same destination as push-driven
            paint, additional entry point. Geofence verified on tap. */}
        {username && username !== 'Guest' && (
          <div style={{
            padding: '14px 16px',
            margin: '12px 0',
            borderRadius: '14px',
            background: 'rgba(255, 130, 0, 0.04)',
            border: '1px solid rgba(255, 130, 0, 0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            <button
              onClick={() => {
                if (!geofence.isNearVenue) {
                  // Not inside — show the friendly message instead.
                  // We use a simple alert here for now; PROMPT 44B will
                  // polish this to a toast.
                  const dist = geofence.distance != null ? `${geofence.distance}m` : 'unknown distance';
                  alert(`Get within 200m of ${venue.name} to paint your night. You're ${dist} away.`);
                  return;
                }
                // Geofenced — open CaptureSurface for this venue.
                // The actual open path is owned by App.tsx; we dispatch a
                // custom event the App listens for to open the capture
                // surface with this venue. (49c — replaced the legacy
                // venuu:request-paint path.)
                window.dispatchEvent(new CustomEvent('venuu:request-capture', {
                  detail: { venueId: venue.id, venueName: venue.name, lat: venue.lat, lng: venue.lng },
                }));
              }}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'transparent',
                border: 'none',
                color: '#FF8200',
                fontFamily: 'Satoshi, sans-serif',
                fontSize: '14px',
                fontWeight: 700,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {'✦'} capture {venue.name.toLowerCase()}
            </button>
            {!geofence.isNearVenue && geofence.distance != null && (
              <div style={{
                fontSize: '10px',
                color: 'rgba(255,255,255,0.35)',
                fontFamily: 'Satoshi, sans-serif',
                textAlign: 'center',
                letterSpacing: '0.5px',
              }}>
                you must be inside · {geofence.distance}m away
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="sheet-divider" />

        {/* The Recap */}
        <div ref={recapRef}>
          <RecapSection venue={venue} username={username} recapData={recapData} />
        </div>
      </div>
    </div>
    </>
  );
}
