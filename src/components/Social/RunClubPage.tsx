import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { hapticLight } from '../../lib/haptics';
import { partnerLogo, type SocialPartner } from '../../lib/socialTheme';
import { openExternal } from '../../lib/socialLinks';
import type { SocialEvent } from '../../lib/socialTypes';

const FONT = 'Satoshi, sans-serif';
// Three sizes: hero, row titles, everything else.
const HERO = 34;
const TITLE = 17;
const TEXT = 13;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const UPCOMING_COUNT = 8;

function timeOf(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "in 3 hours" / "tomorrow" / "in 2 days" — calendar-day based. */
function countdown(start: Date, now: Date): string {
  const ms = start.getTime() - now.getTime();
  if (ms <= 0) return 'happening now';
  const hours = Math.round(ms / 3_600_000);
  const dayDiff = Math.round(
    (new Date(start).setHours(12, 0, 0, 0) - new Date(now).setHours(12, 0, 0, 0)) / 86_400_000,
  );
  if (dayDiff === 0) return hours <= 1 ? 'within the hour' : `in ${hours} hours`;
  if (dayDiff === 1) return 'tomorrow';
  return `in ${dayDiff} days`;
}

interface RunClubPageProps {
  partner: SocialPartner;
  /** The club's future runs, sorted by start. */
  runs: SocialEvent[];
}

/**
 * A run club's own page — next run, schedule, upcoming dates. Opened from
 * the club's medallion on the globe or a city screen. The space below the
 * list is intentionally left open for social features later.
 */
export function RunClubPage({ partner, runs }: RunClubPageProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const next = runs[0] ?? null;
  const nextStart = next ? new Date(next.start_time) : null;
  const upcoming = runs.slice(0, UPCOMING_COUNT);
  const instagram = partner.links.instagram;
  const fuel = partner.fueledBy ? partnerLogo(partner.fueledBy.key) : null;

  return (
    <div style={{ padding: '0 16px 24px' }}>
      {/* Next run hero */}
      <section
        style={{
          position: 'relative',
          padding: '24px 16px 24px 18px',
          borderRadius: 16,
          background: 'var(--social-surface)',
          border: '1px solid var(--social-hairline)',
          boxShadow: `0 0 32px -16px ${partner.color}`,
        }}
      >
        <span aria-hidden style={{ position: 'absolute', left: 0, top: 16, bottom: 16, width: 2, borderRadius: 1, background: partner.color }} />
        <span className="social-label" style={{ fontFamily: FONT, color: partner.color }}>Next run</span>
        {next && nextStart ? (
          <>
            <div className="social-num" style={{ fontFamily: FONT, fontSize: HERO, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginTop: 8 }}>
              {nextStart.toLocaleDateString('en-US', { weekday: 'long' })}
            </div>
            <div className="social-num" style={{ fontFamily: FONT, fontSize: HERO, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              {timeOf(nextStart)}
            </div>
            <div className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: partner.color, marginTop: 8 }}>
              {countdown(nextStart, now)} · {nextStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
              <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>
                {partner.locationNote ?? next.external_venue_name ?? next.address}
              </span>
              {instagram && (
                <button
                  className="social-press"
                  onClick={() => { hapticLight(); openExternal(instagram); }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 0',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-primary)',
                  }}
                >
                  Instagram <ArrowUpRight size={13} strokeWidth={2} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)', marginTop: 8 }}>
            No runs scheduled right now.
          </div>
        )}
      </section>

      {partner.schedule && (
        <div className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-primary)', margin: '24px 0 0' }}>
          {partner.schedule}
        </div>
      )}

      {/* Upcoming runs */}
      {upcoming.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h3 className="social-label" style={{ margin: '0 0 8px', fontFamily: FONT, color: 'var(--text-muted)' }}>Upcoming runs</h3>
          <div style={{ borderTop: '1px solid var(--social-hairline)' }}>
            {upcoming.map(run => {
              const d = new Date(run.start_time);
              return (
                <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderBottom: '1px solid var(--social-hairline)' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 40, flexShrink: 0 }}>
                    <span className="social-num" style={{ fontFamily: FONT, fontSize: TITLE, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{d.getDate()}</span>
                    <span style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text-secondary)', marginTop: 4 }}>{MONTHS[d.getMonth()]}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span style={{ fontFamily: FONT, fontSize: TITLE, fontWeight: 800, color: 'var(--text-primary)' }}>{run.title}</span>
                    <span className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>
                      {d.toLocaleDateString('en-US', { weekday: 'short' })} · {timeOf(d)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Fueled by — only when that partner's logo file exists. */}
      {partner.fueledBy && fuel && (
        <section style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="social-label" style={{ fontFamily: FONT, color: 'var(--text-muted)' }}>Fueled by</span>
          <img src={fuel} alt={partner.fueledBy.name} style={{ height: 28, width: 'auto' }} />
        </section>
      )}
    </div>
  );
}
