import { useEffect, useLayoutEffect, useRef } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { hapticLight, hapticMedium, hapticSelection } from '../../lib/haptics';
import { brandColor, SUN_BRAND_SLUG, type Brand } from '../../lib/brands';
import { CITY_CODE, countdown, type Place, type PlaceKey, type PlaceStatus } from '../../lib/socialPlaces';
import { prefersReducedMotion } from '../../lib/socialGeo';
import { WORLD_LAYOUT } from '../../lib/partnerWorld';
import { LogoDisc, CityBadge } from './PlaceWorld';
import { Odometer } from './Odometer';
import { FeedHandle } from './FeedHandle';
import { useDragUp } from '../../hooks/useDragUp';

const FONT = 'Satoshi, sans-serif';
const TEXT = 13;
const { CARD_H, CAROUSEL_BOTTOM, CARD_GAP } = WORLD_LAYOUT;

// ── Story rings ────────────────────────────────────────────────────

export const RING = 60;
export const RINGS_H = RING + 30;

function Ring({ label, color, bright, onTap, children }: {
  label: string; color: string; bright: boolean; onTap: () => void; children: React.ReactNode;
}) {
  return (
    <button
      className="social-press"
      onClick={onTap}
      aria-label={bright ? `${label}, new events` : label}
      style={{ flexShrink: 0, width: RING + 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
    >
      <span
        style={{
          width: RING, height: RING, borderRadius: '50%', boxSizing: 'border-box', padding: 3, display: 'grid', placeItems: 'center',
          border: `2.5px solid ${bright ? color : `color-mix(in srgb, ${color} 32%, transparent)`}`,
          boxShadow: bright ? `0 0 14px -3px ${color}` : 'none',
          background: 'rgba(11, 10, 9, 0.7)',
          transition: 'border-color 250ms ease-out, box-shadow 250ms ease-out',
        }}
      >
        {children}
      </span>
      <span style={{ maxWidth: RING + 12, fontFamily: FONT, fontSize: 11, fontWeight: 700, color: bright ? 'var(--text-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>
        {label}
      </span>
    </button>
  );
}

interface StoryRingsProps {
  brands: Brand[];
  /** slug → has events created since this device last opened the World. */
  fresh: Record<string, boolean>;
  top: number;
  onPost: (() => void) | null;
  onOpen: (slug: string) => void;

  /** Pull-to-refresh handlers (vertical drags on this row). */
  pull: React.HTMLAttributes<HTMLDivElement>;
  /** Admins: the review queue ring (bright while something is waiting). */
  review: { count: number; onOpen: () => void } | null;
}

/** One ring per active partner (from brands), plus "Post" first. Bright =
 *  something new since last visit; dim once seen. */
export function StoryRings({ brands, fresh, top, onPost, onOpen, pull, review }: StoryRingsProps) {
  return (
    <div
      {...pull}
      className="social-carousel"
      style={{
        position: 'absolute', zIndex: 6, top, left: 0, right: 0, height: RINGS_H,
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px 0', boxSizing: 'border-box',
        overflowX: 'auto', overflowY: 'hidden', touchAction: 'pan-x',
      }}
    >
      {onPost && (
        <Ring label="Post" color="rgba(255,255,255,0.7)" bright={false} onTap={() => { hapticLight(); onPost(); }}>
          <span style={{ width: RING - 12, height: RING - 12, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--social-surface-raised)' }}>
            <Plus size={22} color="var(--text-primary)" strokeWidth={2.25} />
          </span>
        </Ring>
      )}
      {review && (
        <Ring label={review.count ? `Review · ${review.count}` : 'Review'} color="#E5484D" bright={review.count > 0} onTap={review.onOpen}>
          <span style={{ width: RING - 12, height: RING - 12, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--social-surface-raised)' }}>
            <ShieldCheck size={22} color="var(--text-primary)" strokeWidth={2} />
          </span>
        </Ring>
      )}
      {brands.map(b => (
        <Ring key={b.slug} label={b.name} color={brandColor(b)} bright={!!fresh[b.slug]} onTap={() => { hapticMedium(); onOpen(b.slug); }}>
          <LogoDisc brand={b} size={RING - 12} />
        </Ring>
      ))}
    </div>
  );
}

// ── Place carousel ─────────────────────────────────────────────────

function PlaceCard({ place, status, now, selected, reduced, run, onTap, onPost }: {
  place: Place; status: PlaceStatus; now: number; selected: boolean; reduced: boolean; run: boolean;
  onTap: () => void; onPost: (() => void) | null;
}) {
  const b = place.brand;
  const isSun = b?.slug === SUN_BRAND_SLUG;
  const [core, mid] = b?.accent_hexes ?? [];
  const next = status.next;
  return (
    <div
      data-key={place.key}
      style={{
        position: 'relative', flex: '0 0 85%', height: CARD_H, scrollSnapAlign: 'start', boxSizing: 'border-box',
        borderRadius: 16, overflow: 'hidden', background: '#141210',
        border: `1px solid ${selected ? place.color : 'var(--social-hairline)'}`,
        boxShadow: selected ? `0 0 22px -8px ${place.color}` : '0 8px 24px -12px rgba(0,0,0,0.6)',
        transition: 'border-color 200ms ease-out, box-shadow 200ms ease-out',
      }}
    >
      {/* Place color wash + mark */}
      <span aria-hidden style={{ position: 'absolute', inset: 0, background: `linear-gradient(115deg, color-mix(in srgb, ${place.color} 30%, transparent) 0%, transparent 62%)` }} />
      {isSun && core && mid ? (
        <span aria-hidden style={{ position: 'absolute', right: -22, top: -22, width: 76, height: 76, borderRadius: '50%', background: `radial-gradient(circle at 45% 55%, ${core}, ${mid})`, boxShadow: `0 0 36px 8px ${mid}55` }} />
      ) : b ? (
        <span aria-hidden style={{ position: 'absolute', right: 12, top: 12 }}><LogoDisc brand={b} size={32} /></span>
      ) : place.city ? (
        <span aria-hidden style={{ position: 'absolute', right: 12, top: 12 }}><CityBadge code={CITY_CODE[place.city]} accent={place.color} size={32} /></span>
      ) : null}

      {/* Whole card = enter the place */}
      <button
        className="social-press"
        onClick={() => { hapticMedium(); onTap(); }}
        aria-label={`${place.name}, ${status.weekCount} this week${next ? `, next: ${next.title}` : ''}`}
        style={{ position: 'absolute', inset: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      />

      <div style={{ position: 'relative', height: '100%', boxSizing: 'border-box', padding: 16, paddingRight: 56, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</div>
          <div style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 2 }}>
            <Odometer value={status.weekCount} run={run} reduced={reduced} /> this week
          </div>
        </div>
        {next ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{next.title}</span>
            {status.live ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: TEXT, fontWeight: 800, color: place.color }}>
                <span className={reduced ? undefined : 'social-live-dot'} style={{ width: 8, height: 8, borderRadius: 4, background: place.color }} />
                Now
              </span>
            ) : (
              <span className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: place.color }}>{countdown(next, now)}</span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>
            Nothing scheduled yet
            {onPost && (
              <>
                <span aria-hidden>·</span>
                <button
                  className="social-press"
                  onClick={() => { hapticLight(); onPost(); }}
                  style={{ pointerEvents: 'auto', position: 'relative', minHeight: 44, margin: '-14px 0', padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: TEXT, fontWeight: 800, color: 'var(--text-primary)' }}
                >
                  Post an event
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface PlaceCarouselProps {
  places: Place[];
  status: Record<string, PlaceStatus>;
  now: number;
  selected: PlaceKey | null;
  /** Odometers roll once the globe has arrived. */
  run: boolean;
  /** FLIP-animate a reorder (idle reshuffle / return) vs. jump (arrival). */
  animateReorder: boolean;
  onSelect: (key: PlaceKey) => void;
  onOpen: (key: PlaceKey) => void;
  onPost: (() => void) | null;
  /** Feed handle / drag the carousel up → full-screen feed. */
  onOpenFeed: (() => void) | null;
}

/**
 * Home's place carousel. Snap per card; settling selects (the globe turns
 * to it). Reordering animates each card from its old spot (FLIP) while
 * the selected card stays put.
 */
export function PlaceCarousel({ places, status, now, selected, run, animateReorder, onSelect, onOpen, onPost, onOpenFeed }: PlaceCarouselProps) {
  const dragUp = useDragUp(onOpenFeed);
  const reduced = prefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef(0);
  const rects = useRef(new Map<string, number>());
  const order = places.map(p => p.key).join('|');
  const prevOrder = useRef(order);

  const step = () => {
    const first = ref.current?.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + CARD_GAP : 1;
  };
  const snapshot = () => {
    const el = ref.current;
    if (!el) return;
    const next = new Map<string, number>();
    for (const c of Array.from(el.children) as HTMLElement[]) {
      if (c.dataset.key) next.set(c.dataset.key, c.getBoundingClientRect().left);
    }
    rects.current = next;
  };

  // Selection from outside (a dot tap) or a reorder: keep the selected
  // card snapped in place; FLIP the others from where they were.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const i = Math.max(0, places.findIndex(p => p.key === selected));
    const reordered = prevOrder.current !== order;
    prevOrder.current = order;
    const left = i * step();
    if (Math.abs(el.scrollLeft - left) > 2) {
      el.scrollTo({ left, behavior: reordered || reduced ? 'auto' : 'smooth' });
    }
    if (reordered && animateReorder && !reduced) {
      for (const c of Array.from(el.children) as HTMLElement[]) {
        const was = c.dataset.key ? rects.current.get(c.dataset.key) : undefined;
        if (was === undefined) continue;
        const dx = was - c.getBoundingClientRect().left;
        if (Math.abs(dx) > 1) {
          c.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        }
      }
    }
    snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, order, reduced]);

  const onScroll = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el || places.length === 0) return;
      const i = Math.min(places.length - 1, Math.max(0, Math.round(el.scrollLeft / step())));
      snapshot();
      if (places[i].key !== selected) { hapticSelection(); onSelect(places[i].key); }
    }, 90);
  };
  useEffect(() => () => window.clearTimeout(settle.current), []);

  return (
    <>
    {onOpenFeed && <FeedHandle bottom={CAROUSEL_BOTTOM + CARD_H} onOpen={onOpenFeed} />}
    <div
      ref={ref}
      className="social-carousel"
      onScroll={onScroll}
      {...dragUp}
      style={{
        position: 'absolute', zIndex: 6, left: 0, right: 0, bottom: CAROUSEL_BOTTOM,
        display: 'flex', gap: CARD_GAP, overflowX: 'auto', overflowY: 'hidden',
        padding: '0 0 0 16px', scrollSnapType: 'x mandatory', scrollPaddingLeft: 16, overscrollBehaviorX: 'contain',
      }}
    >
      {places.map(p => (
        <PlaceCard
          key={p.key}
          place={p}
          status={status[p.key]}
          now={now}
          selected={p.key === selected}
          reduced={reduced}
          run={run}
          onTap={() => onOpen(p.key)}
          onPost={onPost}
        />
      ))}
      <span aria-hidden style={{ flex: `0 0 calc(15% + ${16 - CARD_GAP}px)` }} />
    </div>
    </>
  );
}

/** Loading state for home: ring and card shapes with a soft shimmer. */
export function HomeSkeleton({ top }: { top: number }) {
  return (
    <div aria-busy="true" aria-label="Loading events">
      <div style={{ position: 'absolute', zIndex: 6, top, left: 0, right: 0, height: RINGS_H, display: 'flex', gap: 8, padding: '8px 12px 0', boxSizing: 'border-box' }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{ width: RING + 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span className="social-skeleton" style={{ width: RING, height: RING, borderRadius: '50%' }} />
            <span className="social-skeleton" style={{ width: 44, height: 8, borderRadius: 4 }} />
          </span>
        ))}
      </div>
      <div style={{ position: 'absolute', zIndex: 6, left: 0, right: 0, bottom: CAROUSEL_BOTTOM, display: 'flex', gap: CARD_GAP, paddingLeft: 16, overflow: 'hidden' }}>
        {['var(--social-accent-tampa)', 'var(--social-accent-st_petersburg)'].map(c => (
          <span key={c} className="social-skeleton" style={{ flex: '0 0 85%', height: CARD_H, borderRadius: 16, border: '1px solid var(--social-hairline)', '--shimmer': c } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}
