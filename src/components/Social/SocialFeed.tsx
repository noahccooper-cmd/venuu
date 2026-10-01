import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Map as MapIcon, Navigation, Share2 } from 'lucide-react';
import { hapticLight, hapticSelection } from '../../lib/haptics';
import type { SocialEvent } from '../../lib/socialTypes';
import type { Brand } from '../../lib/brands';
import type { GoingState } from '../../hooks/useGoing';
import { isLive } from '../../lib/socialPlaces';
import { prefersReducedMotion } from '../../lib/socialGeo';
import { openAppleMapsDirections, shareEvent } from '../../lib/socialLinks';
import { EventCover } from './EventCover';
import { EventBadge, EventDetailSheet } from './PlaceWorld';
import { Odometer } from './Odometer';

const FONT = 'Satoshi, sans-serif';
const TEXT = 13;
const RENDER_WINDOW = 2;       // cards rendered on each side of the current one
const DOUBLE_TAP_MS = 260;
const CLOSE_PULL_PX = 80;

function fullWhen(ev: SocialEvent): string {
  if (ev.date_tba) return 'Date TBA';
  const d = new Date(ev.start_time);
  return `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
const placeOf = (ev: SocialEvent) => ev.external_venue_name ?? ev.address;

function Marker({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 13, background: 'rgba(11,10,9,0.78)', border: `1px solid ${color}`, fontFamily: FONT, fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-primary)' }}>
      {children}
    </span>
  );
}

/** The Going button: fills in the event's color; a small radial burst on "on". */
function GoingButton({ on, color, burst, reduced, onTap }: { on: boolean; color: string; burst: number; reduced: boolean; onTap: () => void }) {
  return (
    <button
      className="social-press"
      aria-pressed={on}
      onClick={e => { e.stopPropagation(); onTap(); }}
      style={{
        position: 'relative', flex: 1.3, height: 48, borderRadius: 12, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontFamily: FONT, fontSize: 15, fontWeight: 800,
        background: on ? color : 'transparent', color: on ? '#0B0A09' : 'var(--text-primary)',
        border: `1.5px solid ${on ? color : 'var(--social-hairline)'}`,
        transition: 'background-color 220ms cubic-bezier(0.34, 1.36, 0.64, 1), border-color 220ms ease-out, color 220ms ease-out',
      }}
    >
      {on && <Check size={16} strokeWidth={2.75} />}
      Going
      {burst > 0 && !reduced && (
        <span key={burst} aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              className="social-burst-dot"
              style={{ '--a': `${i * 45}deg`, background: color } as React.CSSProperties}
            />
          ))}
        </span>
      )}
    </button>
  );
}

interface FeedCardProps {
  event: SocialEvent;
  brand: Brand | null;
  color: string;
  going: GoingState;
  live: boolean;
  fresh: boolean;
  eager: boolean;
  reduced: boolean;
  onGoing: (ev: SocialEvent, on: boolean) => Promise<boolean>;
  onOpen: () => void;
  /** Post flow "Look" step: the exact card, not interactive. */
  preview?: boolean;
}

export function FeedCard({ event, brand, color, going, live, fresh, eager, reduced, onGoing, onOpen, preview = false }: FeedCardProps) {
  const on = going.isGoing(event.id);
  const count = going.count(event);
  const faces = going.faces(event.id);
  const [burst, setBurst] = useState(0);
  const tapTimer = useRef(0);

  const setGoing = async (want: boolean) => {
    if (want && !on) setBurst(b => b + 1);
    await onGoing(event, want);
  };
  // One tap → detail (after a beat); double tap → Going.
  const onBodyTap = () => {
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = 0;
      if (!on) void setGoing(true); else setBurst(b => b + 1);
      return;
    }
    tapTimer.current = window.setTimeout(() => { tapTimer.current = 0; onOpen(); }, DOUBLE_TAP_MS);
  };
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);

  const btn: React.CSSProperties = {
    flex: 1, height: 48, borderRadius: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    fontFamily: FONT, fontSize: 15, fontWeight: 800, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--social-hairline)',
  };

  return (
    <div
      className="social-feed-card"
      onClick={onBodyTap}
      role="group"
      aria-label={`${event.title}, ${fullWhen(event)}`}
      aria-hidden={preview || undefined}
      style={{ position: 'relative', height: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', pointerEvents: preview ? 'none' : undefined }}
    >
      <div style={{ position: 'relative', height: '58%', flexShrink: 0 }}>
        <EventCover event={event} eager={eager} axis="y" />
        <span aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(11,10,9,0.35) 0%, rgba(11,10,9,0) 30%, rgba(11,10,9,0) 60%, #0B0A09 100%)' }} />
        <div style={{ position: 'absolute', left: 16, top: 68, display: 'flex', gap: 8 }}>
          {live && (
            <Marker color={color}>
              <span className={reduced ? undefined : 'social-live-dot'} style={{ width: 8, height: 8, borderRadius: 4, background: color }} /> Now
            </Marker>
          )}
          {fresh && <Marker color="rgba(255,255,255,0.6)">New</Marker>}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '0 20px 20px', marginTop: -24, position: 'relative' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
          <EventBadge brand={brand} event={event} />
          <div className="social-clamp-2" style={{ fontFamily: FONT, fontSize: 26, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{event.title}</div>
          <div className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-primary)' }}>{fullWhen(event)}</div>
          <div style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{placeOf(event)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            {faces.length > 0 && (
              <span style={{ display: 'inline-flex' }}>
                {faces.map((f, i) => (
                  <span key={f.id} style={{ width: 26, height: 26, marginLeft: i ? -5 : 0, borderRadius: 13, display: 'grid', placeItems: 'center', background: 'var(--social-surface-raised)', border: '2px solid #0B0A09', fontFamily: FONT, fontSize: 10, fontWeight: 800, color: 'var(--text-primary)' }}>
                    {f.initials}
                  </span>
                ))}
              </span>
            )}
            <span style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-secondary)' }}>
              <Odometer value={count} run reduced={reduced} rollIn={false} /> going
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <GoingButton on={on} color={color} burst={burst} reduced={reduced} onTap={() => void setGoing(!on)} />
          {!event.date_tba && (
            <button
              className="social-press"
              aria-label="Directions"
              onClick={e => { e.stopPropagation(); hapticLight(); openAppleMapsDirections(event.latitude, event.longitude, placeOf(event)); }}
              style={btn}
            >
              <Navigation size={16} strokeWidth={2.25} /> Directions
            </button>
          )}
          <ShareButton event={event} style={btn} />
        </div>
      </div>
    </div>
  );
}

function ShareButton({ event, style }: { event: SocialEvent; style: React.CSSProperties }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <button
      className="social-press"
      aria-label="Share"
      onClick={async e => {
        e.stopPropagation();
        hapticLight();
        const r = await shareEvent(event);
        setNote(r === 'copied' ? 'Copied' : r === 'failed' ? 'Try again' : null);
        if (r !== 'shared') window.setTimeout(() => setNote(null), 1800);
      }}
      style={{ ...style, flex: 0.9 }}
    >
      <Share2 size={16} strokeWidth={2.25} /> {note ?? 'Share'}
    </button>
  );
}

interface SocialFeedProps {
  /** Context line ("All places", "Tampa · Run Clubs", "Sun Cruiser World"). */
  title: string;
  events: SocialEvent[];
  startId: string | null;
  brandOf: (ev: SocialEvent) => Brand | null;
  colorOf: (ev: SocialEvent) => string;
  going: GoingState;
  now: number;
  /** "New" = created after this time. */
  newSince: number;
  topInset: number;
  onGoing: (ev: SocialEvent, on: boolean) => Promise<boolean>;
  /** Back to the map; the carousel lands on `currentId`. */
  onClose: (currentId: string | null) => void;
  /** The feed's current card changed (keeps the map carousel in sync). */
  onCurrent?: (id: string) => void;
}

/**
 * Full-screen vertical feed, one card per snap. Only a small window of
 * cards around the current one is rendered (others are same-height
 * placeholders), and the next two cards' images are preloaded.
 */
export function SocialFeed({ title, events, startId, brandOf, colorOf, going, now, newSince, topInset, onGoing, onClose, onCurrent }: SocialFeedProps) {
  const reduced = prefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const startIndex = Math.max(0, events.findIndex(e => e.id === startId));
  const [idx, setIdx] = useState(startIndex);
  const [detail, setDetail] = useState<SocialEvent | null>(null);
  const [pull, setPull] = useState(0);
  const [closing, setClosing] = useState(false);
  const frame = useRef(0);
  const touch = useRef<{ y: number; top: number } | null>(null);

  // Open on the card we came from.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = startIndex * el.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preload the next two cards' photos (covers are SVG — nothing to fetch).
  useEffect(() => {
    for (const e of events.slice(idx + 1, idx + 3)) {
      if (e.photo_url) { const img = new Image(); img.decoding = 'async'; img.src = e.photo_url; }
    }
  }, [idx, events]);

  const close = useCallback(() => {
    const id = events[idx]?.id ?? null;
    if (reduced) { onClose(id); return; }
    setClosing(true);
    window.setTimeout(() => onClose(id), 220);
  }, [events, idx, reduced, onClose]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const h = el.clientHeight || 1;
      const i = Math.max(0, Math.min(events.length - 1, Math.round(el.scrollTop / h)));
      if (i !== idx) { setIdx(i); hapticSelection(); onCurrent?.(events[i].id); }
      if (reduced) return;
      // Covers drift a little against the scroll (vertical parallax).
      for (const c of Array.from(el.children) as HTMLElement[]) {
        const off = (c.offsetTop - el.scrollTop) / h;
        if (Math.abs(off) <= 1.5) c.style.setProperty('--parallax', `${(-off * 36).toFixed(1)}px`);
      }
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Drag down on the first card → back to the map.
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { y: e.touches[0].clientY, top: ref.current?.scrollTop ?? 0 }; };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = touch.current;
    if (!t || t.top > 0) return;
    const dy = e.touches[0].clientY - t.y;
    setPull(dy > 0 ? dy : 0);
  };
  const onTouchEnd = () => {
    if (pull > CLOSE_PULL_PX) close();
    setPull(0);
    touch.current = null;
  };

  return (
    <div
      className={closing ? 'social-feed-out' : 'social-feed-in'}
      style={{
        position: 'absolute', inset: 0, zIndex: 15, background: 'var(--social-bg)',
        transform: pull ? `translateY(${pull * 0.5}px)` : undefined,
        opacity: pull ? Math.max(0.6, 1 - pull / 400) : undefined,
      }}
    >
      <div
        ref={ref}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="social-carousel"
        style={{
          position: 'absolute', left: 0, right: 0, top: topInset, bottom: 0,
          overflowY: 'auto', overflowX: 'hidden', scrollSnapType: 'y mandatory', overscrollBehaviorY: 'contain',
        }}
      >
        {events.map((ev, i) => (
          Math.abs(i - idx) <= RENDER_WINDOW ? (
            <FeedCard
              key={ev.id}
              event={ev}
              brand={brandOf(ev)}
              color={colorOf(ev)}
              going={going}
              live={isLive(ev, now)}
              fresh={!!ev.created_at && new Date(ev.created_at).getTime() > newSince}
              eager={i >= idx && i <= idx + 2}
              reduced={reduced}
              onGoing={onGoing}
              onOpen={() => setDetail(ev)}
            />
          ) : (
            <div key={ev.id} aria-hidden className="social-skeleton" style={{ height: '100%', scrollSnapAlign: 'start', '--shimmer': colorOf(ev) } as React.CSSProperties} />
          )
        ))}
        {events.length === 0 && (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 32, textAlign: 'center', fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>
            No events here yet. Check back soon.
          </div>
        )}
      </div>

      {/* Floating top: back to the map + context */}
      <div style={{ position: 'absolute', zIndex: 2, top: topInset + 12, left: 16, right: 16, display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
        <button
          className="social-press"
          aria-label="Back to the map"
          onClick={() => { hapticLight(); close(); }}
          style={{
            pointerEvents: 'auto', height: 44, padding: '0 14px', borderRadius: 22, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            background: 'rgba(11, 10, 9, 0.8)', border: '1px solid var(--social-hairline)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            fontFamily: FONT, fontSize: TEXT, fontWeight: 800, color: 'var(--text-primary)',
          }}
        >
          <MapIcon size={16} strokeWidth={2.25} /> Map
        </button>
        <span style={{ flex: 1, minWidth: 0, fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-primary)', textShadow: '0 1px 6px rgba(0,0,0,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {events.length > 0 && (
          <span className="social-num" style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>
            {idx + 1}/{events.length}
          </span>
        )}
      </div>

      {detail && (() => {
        const ev = events.find(e => e.id === detail.id) ?? detail;
        return <EventDetailSheet event={ev} brand={brandOf(ev)} onClose={() => setDetail(null)} />;
      })()}
    </div>
  );
}
