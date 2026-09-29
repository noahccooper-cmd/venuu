const FONT = 'Satoshi, sans-serif';

interface BrandMarkProps {
  name: string;
  /** Official logo file URL, if one exists in src/assets/social/. */
  logo: string | null;
  size?: number;
  color?: string;
}

/**
 * A brand's official logo file, or — when there isn't one — the brand
 * name as a plain wordmark in the app font. Never draws or imitates a logo.
 */
export function BrandMark({ name, logo, size = 14, color = 'var(--text-primary)' }: BrandMarkProps) {
  if (logo) {
    return <img src={logo} alt={name} style={{ height: size * 1.4, width: 'auto', display: 'block' }} />;
  }
  return (
    <span style={{ fontFamily: FONT, fontSize: size, fontWeight: 800, color, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
      {name}
    </span>
  );
}

/** "Presented by <brand>" — only rendered when the theme has a presenter. */
export function PresentedBy({ name, logo }: { name: string; logo: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.02em' }}>
        Presented by
      </span>
      <BrandMark name={name} logo={logo} size={13} />
    </div>
  );
}
