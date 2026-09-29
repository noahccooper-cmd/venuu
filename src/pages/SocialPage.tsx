import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { CityKey } from '../lib/constants';
import { SOCIAL_THEME, SOCIAL_CITY_LABEL, socialThemeVars } from '../lib/socialTheme';
import { countThisWeek } from '../lib/socialSections';
import { useSocialEvents } from '../hooks/useSocialEvents';
import { SocialGlobe } from '../components/Social/SocialGlobe';
import { PresentedBy } from '../components/Social/BrandMark';

const FONT = 'Satoshi, sans-serif';

interface SocialPageProps {
  /** True while the Social tab is the visible tab. */
  active: boolean;
}

/**
 * Social tab — see docs/social-tab-spec.md.
 * Screen 1 (world globe) → tap a city → Screen 2 (city map + list).
 * Theme is applied ONLY as CSS variables on this root element.
 */
export function SocialPage({ active }: SocialPageProps) {
  const theme = SOCIAL_THEME;
  const [city, setCity] = useState<CityKey | null>(null);

  const knoxville = useSocialEvents('knoxville');
  const tampa = useSocialEvents('tampa');
  const pinellas = useSocialEvents('st_petersburg');
  const counts = useMemo<Record<CityKey, number>>(() => ({
    knoxville: countThisWeek(knoxville.events),
    tampa: countThisWeek(tampa.events),
    st_petersburg: countThisWeek(pinellas.events),
  }), [knoxville.events, tampa.events, pinellas.events]);

  return (
    <div
      data-social-theme={theme.id}
      style={{
        ...socialThemeVars(theme, city),
        position: 'absolute',
        inset: 0,
        bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        background: 'var(--bg-page)',
        display: 'flex',
        flexDirection: 'column',
      } as React.CSSProperties}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          // Clears the app-level fixed Header — same offset as CommunityPage.
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0,
          minHeight: 20,
        }}
      >
        {city ? (
          <button
            onClick={() => setCity(null)}
            aria-label="Back to all cities"
            style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: -6, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <ChevronLeft size={20} color="var(--text-secondary)" />
            <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: 'var(--social-accent)', letterSpacing: '-0.01em' }}>
              {SOCIAL_CITY_LABEL[city]}
            </span>
          </button>
        ) : (
          <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Social
          </span>
        )}
        <div style={{ flex: 1 }} />
        {theme.presentedBy && <PresentedBy name={theme.presentedBy.name} logo={theme.presentedBy.logo} />}
      </header>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* World stays mounted behind the city screen so "back" is instant. */}
        <div style={{ position: 'absolute', inset: 0, visibility: city ? 'hidden' : 'visible' }}>
          <SocialGlobe theme={theme} counts={counts} visible={active && !city} onCityChosen={setCity} />
        </div>
        {city && <div style={{ position: 'absolute', inset: 0 }} />}
      </div>
    </div>
  );
}
