import { SOCIAL_THEME, socialThemeVars } from '../lib/socialTheme';

const FONT = 'Satoshi, sans-serif';

interface SocialPageProps {
  /** True while the Social tab is the visible tab. */
  active: boolean;
}

/**
 * Social tab — see docs/social-tab-spec.md.
 * Theme is applied ONLY as CSS variables on this root element.
 */
export function SocialPage({ active }: SocialPageProps) {
  const theme = SOCIAL_THEME;

  return (
    <div
      data-social-theme={theme.id}
      style={{
        ...socialThemeVars(theme, null),
        position: 'absolute',
        inset: 0,
        background: 'var(--bg-page)',
        display: 'flex',
        flexDirection: 'column',
      } as React.CSSProperties}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          // Clears the app-level fixed Header — same offset as CommunityPage.
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          Social
        </span>
      </div>
      <div style={{ flex: 1 }} data-active={active} />
    </div>
  );
}
