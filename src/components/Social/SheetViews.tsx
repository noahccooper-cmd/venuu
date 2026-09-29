import { ArrowUpRight, ChevronLeft, Navigation } from 'lucide-react';
import { hapticLight } from '../../lib/haptics';
import type { CityKey } from '../../lib/constants';
import {
  brandPartnerFor, eventColor, SOCIAL_CITY_LABEL, type SocialPartner, type SocialTheme,
} from '../../lib/socialTheme';
import type { SocialEvent } from '../../lib/socialTypes';
import { groupSocialDays, type SocialGroup } from '../../lib/socialSections';
import { openAppleMapsDirections, openExternal } from '../../lib/socialLinks';
import { SOCIAL_CITIES } from '../../lib/socialGeo';
import { SocialEventList } from './SocialEventList';
import { PartnerTabs } from './PartnerTabs';
import { BrandMark } from './BrandMark';
import type { SocialLink } from './SocialMap';
import { LogoDisc } from './PartnerWorld';
import { brandColor, type Brand } from '../../lib/brands';

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
  /** Active partner brand rows — one World card each. */
  brands: Brand[];
  onFilter: (key: string | null) => void;
  /** Opens a partner's World (key = brand slug). */
  onOpenPartnerPage: (key: string) => void;
  onCardTap: (ev: SocialEvent) => void;
}

export function WorldBody({ theme, partners, thisWeek, filter, brands, onFilter, onOpenPartnerPage, onCardTap }: WorldBodyProps) {
  const groups: SocialGroup[] = SOCIAL_CITIES
    .map(c => ({ key: c, label: SOCIAL_CITY_LABEL[c], events: thisWeek[c] }))
    .filter(g => g.events.length > 0);
  const total = groups.reduce((n, g) => n + g.events.length, 0);

  return (
    <div>
      {brands.map(b => (
        <button
          key={b.slug}
          className="social-press"
          onClick={() => { hapticLight(); onOpenPartnerPage(b.slug); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 16, width: 'calc(100% - 32px)', margin: '0 16px 8px',
            padding: 16, borderRadius: 14, cursor: 'pointer', textAlign: 'left',
            background: 'var(--social-surface)', border: `1px solid ${brandColor(b)}`,
            boxShadow: `0 0 24px -14px ${brandColor(b)}`,
          }}
        >
          <LogoDisc brand={b} size={52} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span style={{ fontFamily: FONT, fontSize: TITLE, fontWeight: 800, color: 'var(--text-primary)' }}>{b.name} World</span>
            {(b.tagline ?? b.about) && (
              <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>{b.tagline ?? b.about}</span>
            )}
          </span>
        </button>
      ))}
      <PartnerTabs
        partners={partners}
        active={filter}
        onChange={onFilter}
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
  const image = event.photo_url ?? brand?.photos?.[0] ?? null;
  const place = brand?.locationNote ?? event.external_venue_name ?? event.address;
  const canDirect = !brand?.locationNote;

  return (
    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {image && (
        <div style={{ height: 180, borderRadius: 14, background: 'var(--social-surface)', border: '1px solid var(--social-hairline)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          <img src={image} alt="" style={{ height: 180, width: '100%', objectFit: 'cover', display: 'block' }} />
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
