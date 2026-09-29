import { ArrowUpRight, ChevronLeft, Navigation } from 'lucide-react';
import { hapticLight } from '../../lib/haptics';
import type { CityKey } from '../../lib/constants';
import {
  brandPartnerFor, eventColor, SOCIAL_CITY_LABEL, type SocialPartner, type SocialTheme,
} from '../../lib/socialTheme';
import type { SocialEvent } from '../../lib/socialTypes';
import { groupSocialDays, type SocialGroup } from '../../lib/socialSections';
import { openAppleMapsDirections, openExternal } from '../../lib/socialLinks';
import { SOCIAL_CITIES, distanceKm } from '../../lib/socialGeo';
import { SocialEventList } from './SocialEventList';
import { PartnerTabs } from './PartnerTabs';
import { BrandMark } from './BrandMark';
import type { SocialLink } from './SocialMap';

const FONT = 'Satoshi, sans-serif';
const TITLE = 17;
const TEXT = 13;

// ── Header ────────────────────────────────────────────────────────

interface SheetHeaderProps {
  title: React.ReactNode;
  color?: string;
  onBack?: () => void;
  backLabel?: string;
  right?: React.ReactNode;
}

/** One header shape for every sheet state: optional one-tap back, title,
 *  optional right-side control. */
export function SheetHeader({ title, color = 'var(--text-primary)', onBack, backLabel = 'Back', right }: SheetHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 16px 12px' }}>
      {onBack && (
        <button
          className="social-press"
          aria-label={backLabel}
          onClick={() => { hapticLight(); onBack(); }}
          style={{ width: 44, height: 44, marginLeft: -12, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <ChevronLeft size={22} color="var(--text-secondary)" />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0, fontFamily: FONT, fontSize: TITLE, fontWeight: 800, letterSpacing: '-0.01em', color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </div>
      {right}
    </div>
  );
}

// ── World ─────────────────────────────────────────────────────────

interface WorldBodyProps {
  theme: SocialTheme;
  partners: SocialPartner[];
  thisWeek: Record<CityKey, SocialEvent[]>;
  filter: string | null;
  onFilter: (key: string | null) => void;
  onOpenPartnerPage: (key: string) => void;
  onEnterSunWorld: () => void;
  onCardTap: (ev: SocialEvent) => void;
}

export function WorldBody({ theme, partners, thisWeek, filter, onFilter, onOpenPartnerPage, onEnterSunWorld, onCardTap }: WorldBodyProps) {
  const presenter = theme.presentedBy
    ? theme.partners.find(p => p.key === theme.presentedBy!.partnerKey) ?? null
    : null;
  const groups: SocialGroup[] = SOCIAL_CITIES
    .map(c => ({ key: c, label: SOCIAL_CITY_LABEL[c], events: thisWeek[c] }))
    .filter(g => g.events.length > 0);
  const total = groups.reduce((n, g) => n + g.events.length, 0);

  return (
    <div>
      {presenter && theme.sun && (
        <button
          className="social-press"
          onClick={() => { hapticLight(); onEnterSunWorld(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 16, width: 'calc(100% - 32px)', margin: '0 16px 8px',
            padding: 16, borderRadius: 14, cursor: 'pointer', textAlign: 'left',
            background: 'var(--social-surface)', border: `1px solid ${theme.sun.mid}`,
            boxShadow: `0 0 24px -12px ${theme.sun.mid}`,
          }}
        >
          <span style={{ width: 52, height: 52, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: `radial-gradient(circle at 50% 45%, ${theme.sun.core}, ${theme.sun.mid})` }}>
            <BrandMark name={presenter.label} logo={presenter.logo} size={30} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: FONT, fontSize: TITLE, fontWeight: 800, color: 'var(--text-primary)' }}>Enter {presenter.label} World</span>
            <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>Their pop-ups across Tampa Bay and Knoxville</span>
          </span>
        </button>
      )}
      <PartnerTabs
        partners={partners}
        active={filter}
        onChange={key => (key && presenter && key === presenter.key ? onEnterSunWorld() : onFilter(key))}
        onOpenPage={onOpenPartnerPage}
      />
      <SocialEventList
        events={groups.flatMap(g => g.events)}
        groups={groups.map(g => ({ ...g, label: `${g.label} · this week` }))}
        theme={theme}
        link={null}
        emptyText={total === 0 ? 'Nothing on this week yet.' : ''}
        onCardTap={onCardTap}
      />
    </div>
  );
}

// ── City ──────────────────────────────────────────────────────────

interface CityBodyProps {
  theme: SocialTheme;
  city: CityKey;
  partners: SocialPartner[];
  events: SocialEvent[];
  active: string | null;
  link: SocialLink | null;
  onFilter: (key: string | null) => void;
  onOpenPartnerPage: (key: string) => void;
  onCardTap: (ev: SocialEvent) => void;
}

export function CityBody({ theme, city, partners, events, active, link, onFilter, onOpenPartnerPage, onCardTap }: CityBodyProps) {
  const activePartner = partners.find(p => p.key === active) ?? null;
  return (
    <div>
      <PartnerTabs partners={partners} active={active} onChange={onFilter} onOpenPage={onOpenPartnerPage} />
      <SocialEventList
        events={events}
        groups={groupSocialDays(events, Date.now(), true)}
        theme={theme}
        link={link}
        emptyText={activePartner
          ? `No ${activePartner.label} events in ${SOCIAL_CITY_LABEL[city]} right now.`
          : `No events in ${SOCIAL_CITY_LABEL[city]} right now.`}
        onCardTap={onCardTap}
      />
    </div>
  );
}

// ── Event detail ──────────────────────────────────────────────────

function pickImage(images: string[], id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return images[h % images.length];
}

function PartnerLinks({ partner }: { partner: SocialPartner }) {
  const { website, instagram, finder } = partner.links;
  if (!finder && !website && !instagram) return null;
  const link = (label: string, url: string, strong = false) => (
    <button
      key={label}
      className="social-press"
      onClick={() => { hapticLight(); openExternal(url); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44,
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: strong ? partner.color : 'var(--text-primary)',
      }}
    >
      {label} <ArrowUpRight size={13} strokeWidth={2} />
    </button>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 16 }}>
      {finder && link(finder.label, finder.url, true)}
      {website && link('Website', website)}
      {instagram && link('Instagram', instagram)}
    </div>
  );
}

export function EventDetail({ theme, event }: { theme: SocialTheme; event: SocialEvent }) {
  const brand = brandPartnerFor(theme, event);
  const color = eventColor(theme, event);
  const start = new Date(event.start_time);
  const image = brand?.images?.length ? pickImage(brand.images, event.id) : brand?.photos?.[0] ?? null;
  const place = brand?.locationNote ?? event.external_venue_name ?? event.address;
  const canDirect = !brand?.locationNote;

  return (
    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {image && (
        <div style={{ height: 180, borderRadius: 14, background: 'var(--social-surface)', border: '1px solid var(--social-hairline)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          {brand?.images?.length
            ? <img src={image} alt="" style={{ height: 156, width: 'auto', display: 'block' }} />
            : <img src={image} alt="" style={{ height: 180, width: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>
      )}
      <div style={{ position: 'relative', paddingLeft: 14 }}>
        <span aria-hidden style={{ position: 'absolute', left: 0, top: 2, bottom: 2, width: 2, borderRadius: 1, background: color }} />
        <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: `var(--social-accent-${event.city})` }}>
          {SOCIAL_CITY_LABEL[event.city]}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginTop: 4 }}>{event.title}</div>
        <div className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-primary)', marginTop: 8 }}>
          {start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} · {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </div>
        <div style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)', marginTop: 4 }}>{place}</div>
        {event.description && (
          <div style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)', marginTop: 8 }}>{event.description}</div>
        )}
      </div>
      {canDirect && (
        <button
          className="social-press"
          onClick={() => { hapticLight(); openAppleMapsDirections(event.latitude, event.longitude, place); }}
          style={{
            height: 48, borderRadius: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'var(--text-primary)', color: '#0B0A09', border: 'none',
            fontFamily: FONT, fontSize: 15, fontWeight: 800,
          }}
        >
          <Navigation size={16} strokeWidth={2.25} /> Directions
        </button>
      )}
      {brand && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid var(--social-hairline)' }}>
          <BrandMark name={brand.label} logo={brand.logo} size={24} />
          <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>{brand.about}</span>
          <PartnerLinks partner={brand} />
          {brand.disclaimer && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{brand.disclaimer}</span>}
        </div>
      )}
    </div>
  );
}

// ── Sun Cruiser World ─────────────────────────────────────────────

export function SunWorldHeader({ partner, sun, onLeave }: {
  partner: SocialPartner;
  sun: { core: string; mid: string };
  onLeave: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, margin: '0 16px 12px', padding: '8px 12px',
        borderRadius: 14, background: `${sun.mid}1F`,
        border: `1px solid ${sun.mid}66`,
      }}
    >
      <span style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: `radial-gradient(circle at 50% 45%, ${sun.core}, ${sun.mid})` }}>
        <BrandMark name={partner.label} logo={partner.logo} size={26} />
      </span>
      <span style={{ flex: 1, fontFamily: FONT, fontSize: TITLE, fontWeight: 800, color: 'var(--text-primary)' }}>{partner.label} World</span>
      <button
        className="social-press"
        onClick={() => { hapticLight(); onLeave(); }}
        style={{ minHeight: 44, padding: '0 4px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-secondary)' }}
      >
        Leave
      </button>
    </div>
  );
}

interface SunWorldBodyProps {
  theme: SocialTheme;
  partner: SocialPartner;
  events: SocialEvent[];
  city: CityKey | null;
  origin: [number, number] | null;
  onCity: (c: CityKey) => void;
  onCardTap: (ev: SocialEvent) => void;
}

export function SunWorldBody({ theme, partner, events, city, origin, onCity, onCardTap }: SunWorldBodyProps) {
  const dist = (e: SocialEvent) => (origin ? distanceKm(origin, [e.longitude, e.latitude]) : 0);
  // Nearest first, then soonest — each card carries its city tag.
  const sorted = [...events].sort((a, b) => dist(a) - dist(b) || a.start_time.localeCompare(b.start_time));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {partner.images && partner.images.length > 0 && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '0 16px', scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}>
          {partner.images.map(src => (
            <div key={src} style={{ flexShrink: 0, width: 96, height: 150, borderRadius: 12, scrollSnapAlign: 'start', background: 'var(--social-surface)', border: '1px solid var(--social-hairline)', display: 'grid', placeItems: 'center' }}>
              <img src={src} alt="" style={{ height: 132, width: 'auto', display: 'block' }} />
            </div>
          ))}
        </div>
      )}

      <div role="tablist" aria-label="City" style={{ display: 'flex', gap: 8, padding: '0 16px' }}>
        {SOCIAL_CITIES.map(c => {
          const on = c === city;
          return (
            <button
              key={c}
              role="tab"
              aria-selected={on}
              className="social-press"
              onClick={() => { hapticLight(); onCity(c); }}
              style={{
                flex: 1, minHeight: 44, borderRadius: 22, cursor: 'pointer', background: 'transparent',
                border: `1px solid ${on ? partner.color : 'var(--social-hairline)'}`,
                boxShadow: on ? `0 0 12px -4px ${partner.color}` : 'none',
                fontFamily: FONT, fontSize: TEXT, fontWeight: 700,
                color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {SOCIAL_CITY_LABEL[c]}
            </button>
          );
        })}
      </div>

      <div>
        {sorted.length === 0 ? (
          <div style={{ padding: '8px 16px', fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>No upcoming {partner.label} events.</div>
        ) : (
          <SocialEventList
            events={sorted}
            groups={[{ key: 'near', label: origin ? 'Nearest first' : 'Upcoming', events: sorted }]}
            theme={theme}
            link={null}
            showCity
            emptyText=""
            onCardTap={onCardTap}
          />
        )}
      </div>

      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PartnerLinks partner={partner} />
        {partner.disclaimer && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{partner.disclaimer}</span>}
      </div>
    </div>
  );
}
