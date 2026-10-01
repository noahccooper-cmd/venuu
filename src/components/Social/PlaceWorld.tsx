import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, BadgeCheck, Mail, Navigation, Share2, X } from 'lucide-react';
import { hapticLight, hapticSelection } from '../../lib/haptics';
import type { SocialEvent } from '../../lib/socialTypes';
import { brandColor, type Brand } from '../../lib/brands';
import { openAppleMapsDirections, openEmail, openExternal, shareEvent } from '../../lib/socialLinks';
import { prefersReducedMotion } from '../../lib/socialGeo';
import { BrandMark } from './BrandMark';
import { EventCover } from './EventCover';
import { FeedHandle } from './FeedHandle';
import { useDragUp } from '../../hooks/useDragUp';
import { WORLD_LAYOUT, rememberAge, applyCarouselParallax } from '../../lib/partnerWorld';

const FONT = 'Satoshi, sans-serif';
const TITLE = 17;
const TEXT = 13;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Layout (px). The Social root already ends above the tab bar + home
// indicator, so "bottom" here is clear of both.
const { BAR_GAP, BAR_H, SWITCH_GAP, SWITCH_H, CARD_H, CAROUSEL_BOTTOM, CARD_GAP } = WORLD_LAYOUT;

function whenLine(ev: SocialEvent): string {
  if (ev.date_tba) return 'Date TBA';
  const d = new Date(ev.start_time);
  const now = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today · ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} · ${time}`;
}

function fullWhen(ev: SocialEvent): string {
  if (ev.date_tba) return 'Date TBA';
  const d = new Date(ev.start_time);
  return `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

const placeOf = (ev: SocialEvent) => ev.external_venue_name ?? ev.address;

// ── Shared bits ───────────────────────────────────────────────────

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="social-press"
      aria-label={label}
      onClick={() => { hapticLight(); onClick(); }}
      style={{ width: 44, height: 44, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
    >
      {children}
    </button>
  );
}

function BrandLinks({ brand }: { brand: Brand }) {
  const items: { label: string; onTap: () => void; strong?: boolean; icon?: React.ReactNode }[] = [];
  if (brand.finder_url) items.push({ label: `Find ${brand.name} near you`, onTap: () => openExternal(brand.finder_url!), strong: true });
  if (brand.website_url) items.push({ label: 'Website', onTap: () => openExternal(brand.website_url!) });
  if (brand.instagram_url) items.push({ label: 'Instagram', onTap: () => openExternal(brand.instagram_url!) });
  if (brand.email) items.push({ label: 'Email', onTap: () => openEmail(brand.email!), icon: <Mail size={13} strokeWidth={2} /> });
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 20 }}>
      {items.map(it => (
        <button
          key={it.label}
          className="social-press"
          onClick={() => { hapticLight(); it.onTap(); }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: FONT, fontSize: TEXT, fontWeight: 700,
            color: it.strong ? brandColor(brand) : 'var(--text-primary)',
          }}
        >
          {it.label} {it.icon ?? <ArrowUpRight size={13} strokeWidth={2} />}
        </button>
      ))}
    </div>
  );
}

function AgeLine({ brand }: { brand: Brand }) {
  if (!brand.age_gate) return null;
  return (
    <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
      21+ · Please drink responsibly
    </span>
  );
}

/** The one sheet style in a Partner World: full-height-capable, scrolls,
 *  close button, ends above the tab bar. */
function WorldSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  // preventScroll: the panel starts off-screen (slide-in), and a plain
  // focus() would scroll the Social root to reveal it.
  useEffect(() => { panelRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
      <div className="social-fade-in" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.55)' }} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="social-sheet-in"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: 'calc(100% - 24px)',
          display: 'flex', flexDirection: 'column', outline: 'none',
          background: 'var(--social-bg)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          borderTop: '1px solid var(--social-hairline)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 4px 0', flexShrink: 0 }}>
          <IconButton label="Close" onClick={onClose}><X size={20} color="var(--text-secondary)" /></IconButton>
        </div>
        <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 16px 24px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** ONE badge per event: its partner mark, else Verified / Community. */
export function EventBadge({ brand, event, size = TEXT }: { brand: Brand | null; event: SocialEvent; size?: number }) {
  if (brand) return <BrandMark name={brand.name} logo={brand.logo_url} size={size} color="var(--text-secondary)" />;
  const verified = event.verification !== 'community';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT, fontSize: Math.max(11, size - 2), fontWeight: 700, letterSpacing: '0.02em', color: verified ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
      {verified && <BadgeCheck size={size} strokeWidth={2} />}
      {verified ? 'Verified' : 'Community'}
    </span>
  );
}

// ── Detail + About ────────────────────────────────────────────────

/** The event detail sheet (shared by places and the feed). */
export function EventDetailSheet({ event, brand, onClose }: { event: SocialEvent; brand: Brand | null; onClose: () => void }) {
  return (
    <WorldSheet title={event.title} onClose={onClose}>
      <WorldEventDetail brand={brand} event={event} />
    </WorldSheet>
  );
}

function WorldEventDetail({ brand, event }: { brand: Brand | null; event: SocialEvent }) {
  const [shareNote, setShareNote] = useState<string | null>(null);
  const place = placeOf(event);
  const showAddress = !!event.address && event.address !== place;
  const canDirect = !event.date_tba;
  const share = async () => {
    const r = await shareEvent(event);
    setShareNote(r === 'copied' ? 'Copied to clipboard' : r === 'failed' ? 'Couldn’t share — try again' : null);
  };
  const btn: React.CSSProperties = {
    flex: 1, height: 48, borderRadius: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    fontFamily: FONT, fontSize: 15, fontWeight: 800,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {event.photo_url && (
        <img src={event.photo_url} alt="" style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 14, display: 'block' }} />
      )}
      <div>
        <EventBadge brand={brand} event={event} />
        <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginTop: 8 }}>{event.title}</div>
        <div className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-primary)', marginTop: 8 }}>{fullWhen(event)}</div>
        <div style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-primary)', marginTop: 4 }}>{place}</div>
        {showAddress && <div style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)', marginTop: 2 }}>{event.address}</div>}
        {event.description && (
          <div style={{ fontFamily: FONT, fontSize: TEXT, lineHeight: 1.5, color: 'var(--text-secondary)', marginTop: 12 }}>{event.description}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        {canDirect && (
          <button
            className="social-press"
            onClick={() => { hapticLight(); openAppleMapsDirections(event.latitude, event.longitude, place); }}
            style={{ ...btn, background: 'var(--text-primary)', color: '#0B0A09', border: 'none' }}
          >
            <Navigation size={16} strokeWidth={2.25} /> Directions
          </button>
        )}
        <button
          className="social-press"
          onClick={() => { hapticLight(); void share(); }}
          style={{ ...btn, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--social-hairline)' }}
        >
          <Share2 size={16} strokeWidth={2.25} /> Share
        </button>
      </div>
      {shareNote && <div role="status" style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)', marginTop: -8 }}>{shareNote}</div>}
      {brand && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8, borderTop: '1px solid var(--social-hairline)' }}>
          <BrandLinks brand={brand} />
          <AgeLine brand={brand} />
        </div>
      )}
    </div>
  );
}

function WorldAbout({ brand }: { brand: Brand }) {
  const products = brand.products;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <LogoDisc brand={brand} size={56} />
        <span style={{ fontFamily: FONT, fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{brand.name}</span>
      </div>
      {(brand.tagline || brand.about) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {brand.tagline && <span style={{ fontFamily: FONT, fontSize: TITLE, fontWeight: 800, color: brandColor(brand) }}>{brand.tagline}</span>}
          {brand.about && <span style={{ fontFamily: FONT, fontSize: TEXT, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{brand.about}</span>}
        </div>
      )}
      {products.length > 0 && (
        // Evenly spaced across the full width, caption under each.
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${products.length}, minmax(0, 1fr))`, gap: 8 }}>
          {products.map(p => (
            <figure key={p.name} style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              {p.image_url && (
                // Light tile: product shots usually ship on white, so the
                // image edge disappears instead of boxing on the dark sheet.
                <div style={{ height: 148, width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 12, background: '#FFFFFF', display: 'grid', placeItems: 'center' }}>
                  <img src={p.image_url} alt="" style={{ maxHeight: 132, maxWidth: '100%', objectFit: 'contain', display: 'block' }} />
                </div>
              )}
              <figcaption style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, textAlign: 'center', lineHeight: 1.3, color: 'var(--text-primary)' }}>
                {p.name}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8, borderTop: '1px solid var(--social-hairline)' }}>
        <BrandLinks brand={brand} />
        <AgeLine brand={brand} />
      </div>
    </div>
  );
}

export function LogoDisc({ brand, size }: { brand: Brand; size: number }) {
  const [a, b] = brand.accent_hexes;
  const bg = a && b ? `radial-gradient(circle at 50% 45%, ${a}, ${b})` : 'var(--social-surface-raised)';
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: bg, border: `1.5px solid ${brandColor(brand)}`, overflow: 'hidden' }}>
      {brand.logo_url
        ? <img src={brand.logo_url} alt="" style={{ width: size * 0.74, height: size * 0.74, objectFit: 'contain' }} />
        : <span style={{ fontFamily: FONT, fontSize: size * 0.34, fontWeight: 800, color: brandColor(brand) }}>{brand.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3)}</span>}
    </span>
  );
}

// ── Carousel card ─────────────────────────────────────────────────

/** Carousel-size event card: cover (or photo) behind, text on a scrim. */
function WorldCard({ brand, event, accent, selected, fresh = false, eager, onTap }: {
  brand: Brand | null; event: SocialEvent; accent: string; selected: boolean; fresh?: boolean; eager: boolean; onTap: () => void;
}) {
  const d = new Date(event.start_time);
  return (
    <button
      className={`social-press social-world-card${fresh ? ' social-card-new' : ''}`}
      onClick={() => { hapticLight(); onTap(); }}
      aria-label={`${event.title}, ${whenLine(event)}, ${placeOf(event)}`}
      style={{
        position: 'relative', overflow: 'hidden',
        flex: '0 0 85%', height: CARD_H, scrollSnapAlign: 'start', boxSizing: 'border-box',
        display: 'flex', alignItems: 'stretch', gap: 16, padding: 16, textAlign: 'left', cursor: 'pointer',
        borderRadius: 16, background: '#141210',
        border: `1px solid ${selected ? accent : 'var(--social-hairline)'}`,
        boxShadow: selected ? `0 0 22px -8px ${accent}` : '0 8px 24px -12px rgba(0,0,0,0.6)',
        transition: 'border-color 200ms ease-out, box-shadow 200ms ease-out',
        '--glow': accent,
      } as React.CSSProperties}
    >
      <EventCover event={event} eager={eager} />
      {/* Scrim: text stays legible over any cover or photo. */}
      <span aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(11,10,9,0.92) 0%, rgba(11,10,9,0.8) 55%, rgba(11,10,9,0.35) 100%)' }} />
      <span style={{ position: 'relative', width: 52, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {event.date_tba ? (
          <span style={{ fontFamily: FONT, fontSize: TITLE, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-primary)' }}>TBA</span>
        ) : (
          <>
            <span className="social-num" style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, lineHeight: 1, color: 'var(--text-primary)' }}>{d.getDate()}</span>
            <span style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, letterSpacing: '0.12em', marginTop: 6, color: accent }}>{MONTHS[d.getMonth()]}</span>
          </>
        )}
      </span>
      <span style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <span className="social-clamp-2" style={{ fontFamily: FONT, fontSize: TITLE, fontWeight: 800, lineHeight: 1.25, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
          {event.title}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{placeOf(event)}</span>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{whenLine(event)}</span>
            <span style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', display: 'flex', justifyContent: 'flex-end' }}>
              <EventBadge brand={brand} event={event} size={11} />
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}

/** Honest empty state: one card, no fake date. */
function EmptyCard({ title, line, action }: { title: string; line: string; action?: { label: string; onTap: () => void } }) {
  return (
    <div
      style={{
        flex: '0 0 calc(100% - 16px)', height: CARD_H, boxSizing: 'border-box', scrollSnapAlign: 'start',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '16px 20px',
        borderRadius: 16, background: 'rgba(20, 18, 16, 0.94)', border: '1px solid var(--social-hairline)',
      }}
    >
      <span style={{ fontFamily: FONT, fontSize: TITLE, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</span>
      <span style={{ fontFamily: FONT, fontSize: TEXT, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{line}</span>
      {action && (
        <button
          className="social-press"
          onClick={() => { hapticLight(); action.onTap(); }}
          style={{ alignSelf: 'flex-start', minHeight: 44, marginBottom: -12, padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: TEXT, fontWeight: 800, color: 'var(--text-primary)' }}
        >
          {action.label} →
        </button>
      )}
    </div>
  );
}

// ── 21+ gate ──────────────────────────────────────────────────────

export function AgeGate({ brand, onYes, onNo }: { brand: Brand; onYes: () => void; onNo: () => void }) {
  const btn: React.CSSProperties = {
    width: '100%', height: 48, borderRadius: 12, cursor: 'pointer', fontFamily: FONT, fontSize: 15, fontWeight: 800,
  };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="social-fade-in" style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.72)' }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Age check"
        className="social-fade-in"
        style={{
          position: 'relative', width: '100%', maxWidth: 340, boxSizing: 'border-box', padding: 24, borderRadius: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center',
          background: 'var(--social-bg)', border: '1px solid var(--social-hairline)',
        }}
      >
        <LogoDisc brand={brand} size={64} />
        <span style={{ fontFamily: FONT, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Are you 21 or older?</span>
        <span style={{ fontFamily: FONT, fontSize: TEXT, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
          {brand.name} World is for adults of legal drinking age.
        </span>
        <button className="social-press" onClick={() => { hapticLight(); rememberAge(brand.slug); onYes(); }} style={{ ...btn, background: 'var(--text-primary)', color: '#0B0A09', border: 'none' }}>
          Yes, I’m 21+
        </button>
        <button className="social-press" onClick={() => { hapticLight(); onNo(); }} style={{ ...btn, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--social-hairline)' }}>
          No
        </button>
      </div>
    </div>
  );
}

// ── The template ──────────────────────────────────────────────────

export interface PlaceTab { key: string; label: string }

interface PlaceWorldProps {
  /** Top-bar mark (logo disc / city badge). */
  mark: React.ReactNode;
  title: React.ReactNode;
  /** Plain-text name for labels ("Sun Cruiser World", "Tampa"). */
  name: string;
  accent: string;
  /** Brand row → the mark opens its About sheet. */
  about: Brand | null;
  /** City switch (a World) or filter switch (a city). */
  tabs: PlaceTab[];
  tab: string;
  tabsLabel: string;
  onTab: (key: string) => void;
  /** Events in the current tab, in worldOrder. */
  events: SocialEvent[];
  brandOf: (ev: SocialEvent) => Brand | null;
  selectedId: string | null;
  empty: { title: string; line: string; action?: { label: string; onTap: () => void } };
  /** Top of the usable area (the app header's bottom edge). */
  topInset: number;
  /** The carousel settled on a card (swipe). */
  onSelect: (ev: SocialEvent) => void;
  onClose: () => void;
  /** Feed handle / drag the carousel up → full-screen feed. */
  onOpenFeed: (() => void) | null;
  /** A just-posted event: its card slides in with a glow. */
  highlightId?: string | null;
}

/**
 * One template for every place — a partner World or a city: full-screen
 * map (SocialMap underneath), floating top bar, a switch, and a
 * date-ordered carousel synced with the pins. The detail and About sheets
 * are the only sheets.
 */
export function PlaceWorld({
  mark, title, name, accent, about, tabs, tab, tabsLabel, onTab, events, brandOf, selectedId, empty, topInset, onSelect, onClose, onOpenFeed, highlightId = null,
}: PlaceWorldProps) {
  const dragUp = useDragUp(onOpenFeed);
  const reduced = prefersReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef(0);
  const frame = useRef(0);
  const [detail, setDetail] = useState<SocialEvent | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const step = useCallback(() => {
    const first = scrollerRef.current?.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + CARD_GAP : 1;
  }, []);

  // Keep the carousel on the selected card (pin taps, tab changes).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const i = Math.max(0, events.findIndex(e => e.id === selectedId));
    const left = i * step();
    if (Math.abs(el.scrollLeft - left) > 2) el.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
    applyCarouselParallax(el, reduced);
  }, [selectedId, events, step, reduced]);

  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => applyCarouselParallax(scrollerRef.current, reduced));
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = scrollerRef.current;
      if (!el || events.length === 0) return;
      const i = Math.min(events.length - 1, Math.max(0, Math.round(el.scrollLeft / step())));
      if (events[i].id !== selectedId) { hapticSelection(); onSelect(events[i]); }
    }, 90);
  };
  useEffect(() => () => { window.clearTimeout(settleTimer.current); cancelAnimationFrame(frame.current); }, []);

  const selIndex = Math.max(0, events.findIndex(e => e.id === selectedId));

  return (
    <>
      {/* Top bar */}
      <div
        style={{
          position: 'absolute', zIndex: 10, top: topInset + BAR_GAP, left: 16, right: 16, height: BAR_H, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px',
          borderRadius: BAR_H / 2, background: 'rgba(11, 10, 9, 0.88)', border: '1px solid var(--social-hairline)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {about ? (
          <button
            className="social-press"
            aria-label={`About ${about.name}`}
            onClick={() => { hapticLight(); setAboutOpen(true); }}
            style={{ width: 44, height: 44, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            {mark}
          </button>
        ) : (
          <span style={{ width: 44, height: 44, flexShrink: 0, display: 'grid', placeItems: 'center' }}>{mark}</span>
        )}
        <span style={{ flex: 1, minWidth: 0, fontFamily: FONT, fontSize: TITLE, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <IconButton label={`Leave ${name}`} onClick={onClose}><X size={20} color="var(--text-primary)" /></IconButton>
      </div>

      {/* Switch (scrolls sideways when it doesn't fit, e.g. 5 filters at 375pt) */}
      <div style={{ position: 'absolute', zIndex: 10, top: topInset + BAR_GAP + BAR_H + SWITCH_GAP, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
        <div
          role="tablist"
          aria-label={tabsLabel}
          className="social-carousel"
          style={{
            display: 'flex', height: SWITCH_H, maxWidth: 'calc(100% - 32px)', overflowX: 'auto', padding: 3, boxSizing: 'border-box',
            borderRadius: SWITCH_H / 2, pointerEvents: 'auto',
            background: 'rgba(11, 10, 9, 0.88)', border: '1px solid var(--social-hairline)',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          {tabs.map(t => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={on}
                className="social-press"
                onClick={() => { if (!on) { hapticSelection(); onTab(t.key); } }}
                style={{
                  flexShrink: 0, minWidth: 64, padding: '0 14px', borderRadius: (SWITCH_H - 6) / 2, border: 'none', cursor: 'pointer',
                  background: on ? accent : 'transparent',
                  fontFamily: FONT, fontSize: TEXT, fontWeight: 800, whiteSpace: 'nowrap',
                  color: on ? '#0B0A09' : 'var(--text-secondary)',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {onOpenFeed && events.length > 0 && <FeedHandle bottom={CAROUSEL_BOTTOM + CARD_H} onOpen={onOpenFeed} />}

      {/* Carousel */}
      <div
        key={tab}
        ref={scrollerRef}
        className="social-carousel"
        onScroll={onScroll}
        {...dragUp}
        style={{
          position: 'absolute', zIndex: 10, left: 0, right: 0, bottom: CAROUSEL_BOTTOM,
          display: 'flex', gap: CARD_GAP, overflowX: 'auto', overflowY: 'hidden',
          padding: '0 0 0 16px', scrollSnapType: 'x mandatory', scrollPaddingLeft: 16,
          overscrollBehaviorX: 'contain',
        }}
      >
        {events.length === 0 ? (
          <>
            <EmptyCard {...empty} />
            <span aria-hidden style={{ flex: '0 0 4px' }} />
          </>
        ) : (
          <>
            {events.map((ev, i) => (
              <WorldCard
                key={ev.id}
                brand={brandOf(ev)}
                event={ev}
                accent={accent}
                selected={ev.id === selectedId}
                fresh={ev.id === highlightId}
                eager={Math.abs(i - selIndex) <= 2}
                onTap={() => setDetail(ev)}
              />
            ))}
            {/* Lets the last card snap to the left edge like the others. */}
            <span aria-hidden style={{ flex: `0 0 calc(15% + ${16 - CARD_GAP}px)` }} />
          </>
        )}
      </div>

      {detail && <EventDetailSheet event={detail} brand={brandOf(detail)} onClose={() => setDetail(null)} />}
      {aboutOpen && about && (
        <WorldSheet title={`About ${about.name}`} onClose={() => setAboutOpen(false)}>
          <WorldAbout brand={about} />
        </WorldSheet>
      )}
    </>
  );
}

/** A city's mark in the top bar and on story rings: its accent ring with
 *  a short code — a label, not a logo. */
export function CityBadge({ code, accent, size = 40 }: { code: string; accent: string; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: 'var(--social-surface-raised)', border: `1.5px solid ${accent}` }}>
      <span style={{ fontFamily: FONT, fontSize: size * 0.3, fontWeight: 800, letterSpacing: '0.04em', color: accent }}>{code}</span>
    </span>
  );
}
