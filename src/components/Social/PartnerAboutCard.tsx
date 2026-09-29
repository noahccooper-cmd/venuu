import { useEffect, useState } from 'react';
import { Browser } from '@capacitor/browser';
import { hapticLight } from '../../lib/haptics';
import type { SocialPartner } from '../../lib/socialTheme';
import { prefersReducedMotion } from '../../lib/socialGeo';
import { BrandMark } from './BrandMark';

const FONT = 'Satoshi, sans-serif';

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

  const handle = partner.links.instagram?.replace(/\/+$/, '').split('/').pop();

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
        transition: reduced ? 'none' : 'opacity 200ms ease, transform 200ms ease',
      }}
    >
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, borderRadius: 1, background: partner.color }} />
      <BrandMark name={partner.label} logo={partner.logo} size={15} />
      <span style={{ fontFamily: FONT, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
        {partner.about}
      </span>
      {(partner.schedule || handle) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {partner.schedule && (
            <span className="social-num" style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {partner.schedule}
            </span>
          )}
          {handle && (
            <button
              className="social-press"
              onClick={() => { hapticLight(); Browser.open({ url: `https://instagram.com/${handle}` }).catch(() => {}); }}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700, color: partner.color }}
            >
              @{handle}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
