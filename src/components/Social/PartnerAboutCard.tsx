import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { hapticLight } from '../../lib/haptics';
import type { SocialPartner } from '../../lib/socialTheme';
import { prefersReducedMotion } from '../../lib/socialGeo';
import { openExternal } from '../../lib/socialLinks';
import { BrandMark } from './BrandMark';

const FONT = 'Satoshi, sans-serif';

function LinkButton({ label, url, color, strong = false }: { label: string; url: string; color: string; strong?: boolean }) {
  return (
    <button
      className="social-press"
      onClick={() => { hapticLight(); openExternal(url); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 0',
        background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: FONT, fontSize: 13, fontWeight: 700, color: strong ? color : 'var(--text-primary)',
      }}
    >
      {label}
      <ArrowUpRight size={13} strokeWidth={2} />
    </button>
  );
}

/** About card for the active partner — slides in under the tabs. */
export function PartnerAboutCard({ partner }: { partner: SocialPartner }) {
  const [shown, setShown] = useState(false);
  const reduced = prefersReducedMotion();

  // Re-run the entrance whenever the partner changes.
  useEffect(() => {
    setShown(false);
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [partner.key]);

  const { website, instagram, finder } = partner.links;

  return (
    <div
      style={{
        position: 'relative',
        margin: '0 16px 8px',
        padding: '16px 16px 16px 18px',
        borderRadius: 12,
        background: 'var(--social-surface)',
        border: '1px solid var(--social-hairline)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
        opacity: shown || reduced ? 1 : 0,
        transform: shown || reduced ? 'none' : 'translateY(-6px)',
        transition: reduced ? 'none' : 'opacity 250ms ease-out, transform 250ms ease-out',
      }}
    >
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, borderRadius: 1, background: partner.color }} />
      <BrandMark name={partner.label} logo={partner.logo} size={24} />
      <span style={{ fontFamily: FONT, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
        {partner.about}
      </span>
      {partner.schedule && (
        <span className="social-num" style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          {partner.schedule}
        </span>
      )}
      {(finder || website || instagram) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {finder && <LinkButton label={finder.label} url={finder.url} color={partner.color} strong />}
          {website && <LinkButton label="Website" url={website} color={partner.color} />}
          {instagram && <LinkButton label="Instagram" url={instagram} color={partner.color} />}
        </div>
      )}
      {partner.disclaimer && (
        <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
          {partner.disclaimer}
        </span>
      )}
    </div>
  );
}
