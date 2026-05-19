import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, MapPin, Footprints, Sparkles, Award, Star, Calendar, Crown, Trophy,
  type LucideIcon,
} from 'lucide-react';
import { supabase, envReady } from '../lib/supabase';
import { CITIES, type CityKey } from '../lib/constants';
import { hapticLight } from '../lib/haptics';

/**
 * PublicProfilePage — read-only profile view for /u/{share_token}.
 *
 * Reads from the public_profile_view introduced in migration 00031
 * which is itself gated on profiles.show_recaps_publicly OR
 * profiles.show_visits_publicly. If the row isn't in the view we
 * show the "not public" empty state regardless of whether the token
 * is valid.
 *
 * View tracking: a single insert into profile_share_views on mount
 * with the current viewer's profile.id when known (otherwise null
 * for anonymous loads). RLS on profile_share_views permits the
 * insert from anon + authenticated; only the profile owner can read.
 */

const FONT = 'Satoshi, sans-serif';

type AvatarColor =
  | 'orange' | 'cyan' | 'purple' | 'green'
  | 'pink'   | 'gold' | 'sienna' | 'wine'
  | string;

interface PublicProfileRow {
  profile_share_token: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  tagline: string | null;
  avatar_color: AvatarColor | null;
  home_city: string;
  member_since: string;
  nights_out: number;
  venues_discovered: number;
  total_recaps: number;
  taste_accuracy_pct: number;
  plans_completed: number;
}

type UserLevel = 'newcomer' | 'regular' | 'local' | 'local-legend' | 'hall-of-fame';

function computeLevel(nightsOut: number): UserLevel {
  if (nightsOut >= 100) return 'hall-of-fame';
  if (nightsOut >= 30)  return 'local-legend';
  if (nightsOut >= 15)  return 'local';
  if (nightsOut >= 5)   return 'regular';
  return 'newcomer';
}

function levelLabel(level: UserLevel): string {
  switch (level) {
    case 'newcomer':     return 'newcomer';
    case 'regular':      return 'regular';
    case 'local':        return 'local';
    case 'local-legend': return 'local legend';
    case 'hall-of-fame': return 'hall of fame';
  }
}

function levelIcon(level: UserLevel): LucideIcon {
  switch (level) {
    case 'newcomer':     return Award;
    case 'regular':      return Star;
    case 'local':        return Crown;
    case 'local-legend': return Trophy;
    case 'hall-of-fame': return Sparkles;
  }
}

function avatarHex(color: string | null | undefined): string {
  switch (color) {
    case 'cyan':   return '#00D4FF';
    case 'purple': return '#9B5EFF';
    case 'green':  return '#00CC66';
    case 'pink':   return '#FF5E9C';
    case 'gold':   return '#FFD700';
    case 'sienna': return '#B8623A';
    case 'wine':   return '#8B2543';
    case 'orange':
    default:       return '#FF8200';
  }
}

function getCityLabel(cityKey: string): string {
  const config = CITIES[cityKey as CityKey];
  if (config) return `${config.name}, ${config.state}`;
  return cityKey;
}

interface PublicProfilePageProps {
  shareToken: string;
  /** Optional: when running inside the app, lets the user dismiss
   *  the public view and drop into the main app. The /u/{token}
   *  route shouldn't render a Back button on the marketing web
   *  surface, so this is optional. */
  onClose?: () => void;
  /** When known (signed-in viewer), used as the viewer_user_id on
   *  the profile_share_views insert. */
  viewerProfileId?: string | null;
}

export function PublicProfilePage({ shareToken, onClose, viewerProfileId }: PublicProfilePageProps) {
  const [row, setRow] = useState<PublicProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Fetch the public profile row.
  useEffect(() => {
    if (!envReady || !shareToken) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('public_profile_view')
        .select('*')
        .eq('profile_share_token', shareToken)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        if (error && error.code !== 'PGRST116') {
          console.warn('[public_profile] fetch failed:', error.message);
        }
        setNotFound(true);
        setRow(null);
      } else {
        setRow(data as PublicProfileRow);
        setNotFound(false);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [shareToken]);

  // Log a view. Best-effort fire-and-forget — owner reads via RLS.
  useEffect(() => {
    if (!envReady || !row) return;
    // Lookup the profile.id behind the token so the FK lands cleanly.
    let cancelled = false;
    (async () => {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('id')
        .eq('profile_share_token', shareToken)
        .maybeSingle();
      if (cancelled || !profileRow) return;
      const { error } = await supabase
        .from('profile_share_views')
        .insert({
          profile_id: (profileRow as { id: string }).id,
          viewer_user_id: viewerProfileId ?? null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          referrer: typeof document !== 'undefined' ? (document.referrer || null) : null,
          viewer_ip_hash: null,
        });
      if (error) {
        console.warn('[public_profile] view-log failed:', error.message);
      }
    })();
    return () => { cancelled = true; };
  }, [row, shareToken, viewerProfileId]);

  const display = useMemo(() => {
    if (!row) return null;
    const level = computeLevel(row.nights_out);
    return {
      ...row,
      level,
      displayName: row.display_name || row.username,
      initials: (row.display_name || row.username || '?').slice(0, 2).toUpperCase(),
      avatarBg: avatarHex(row.avatar_color),
      memberSince: new Date(row.member_since).toLocaleDateString(
        'en-US', { month: 'long', year: 'numeric' },
      ),
    };
  }, [row]);

  const downloadAppHref = 'https://venuu.app';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: 'var(--bg-page, #050507)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        fontFamily: FONT,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          background: 'rgba(5, 5, 7, 0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          zIndex: 5,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
        }}>
          {onClose ? (
            <button
              type="button"
              onClick={() => { hapticLight(); onClose(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none',
                color: 'var(--text-secondary, #8A8A95)',
                fontFamily: FONT, fontSize: 14, fontWeight: 500,
                cursor: 'pointer',
                padding: '8px 4px', minHeight: 44,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <ArrowLeft size={18} strokeWidth={1.5} />
              Back
            </button>
          ) : (
            <span style={{ width: 60 }} />
          )}
          <h1 style={{
            fontFamily: FONT, fontSize: 22,
            fontWeight: 800, color: '#FF8200',
            letterSpacing: '-0.5px',
            margin: 0, lineHeight: 1,
          }}>
            venuu
          </h1>
          <span style={{ width: 60 }} />
        </div>
      </div>

      {/* Content */}
      <div style={{
        padding: '0 16px',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 40px)',
      }}>
        {loading && (
          <div style={{
            display: 'flex', justifyContent: 'center',
            padding: '80px 0',
          }}>
            <div className="w-7 h-7 border-2 border-[#FF8200] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && notFound && (
          <NotPublicEmpty downloadAppHref={downloadAppHref} />
        )}

        {!loading && display && (
          <>
            {/* Hero card */}
            <div style={{ padding: '20px 0 0' }}>
              <div style={{
                background: 'rgba(15, 15, 22, 0.92)',
                border: '1px solid rgba(255, 130, 0, 0.18)',
                borderRadius: 16,
                padding: '28px 20px 22px',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
                <div
                  style={{
                    width: 96, height: 96, borderRadius: '50%',
                    background: display.avatarBg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 14,
                    boxShadow: `0 0 0 4px rgba(255, 130, 0, 0.18), 0 8px 32px ${display.avatarBg}55`,
                  }}
                >
                  <span style={{
                    fontFamily: FONT, fontSize: 36, fontWeight: 800,
                    color: 'white', letterSpacing: '-0.02em',
                  }}>
                    {display.initials}
                  </span>
                </div>

                <p style={{
                  fontFamily: FONT, fontSize: 28, fontWeight: 800,
                  color: 'var(--text-primary, #FFFFFF)',
                  letterSpacing: '-0.02em', lineHeight: 1.1,
                  margin: 0, textAlign: 'center',
                }}>
                  {display.displayName}
                </p>

                <p style={{
                  fontFamily: FONT, fontSize: 13,
                  color: 'var(--text-secondary, #8A8A95)',
                  margin: '4px 0 12px',
                  textAlign: 'center',
                }}>
                  @{display.username} · {getCityLabel(display.home_city)}
                </p>

                {(() => {
                  const Icon = levelIcon(display.level);
                  return (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '5px 14px',
                      borderRadius: 999,
                      background: 'linear-gradient(135deg, rgba(255, 130, 0, 0.18), rgba(255, 130, 0, 0.04))',
                      border: '1px solid rgba(255, 130, 0, 0.45)',
                      color: '#FFD9B8',
                      boxShadow: '0 0 12px rgba(255, 130, 0, 0.35)',
                      fontFamily: FONT, fontSize: 11, fontWeight: 700,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}>
                      <Icon size={12} strokeWidth={2} style={{ color: '#FF8200' }} />
                      {levelLabel(display.level)}
                    </div>
                  );
                })()}

                {display.tagline && (
                  <p style={{
                    marginTop: 14,
                    fontFamily: FONT, fontSize: 14, fontStyle: 'italic',
                    color: 'var(--text-secondary, #8A8A95)',
                    textAlign: 'center', lineHeight: 1.4,
                  }}>
                    {display.tagline}
                  </p>
                )}
                {display.bio && (
                  <p style={{
                    marginTop: 8,
                    fontFamily: FONT, fontSize: 13,
                    color: 'var(--text-secondary, #8A8A95)',
                    textAlign: 'center', lineHeight: 1.5,
                    maxWidth: 320,
                    display: '-webkit-box',
                    WebkitLineClamp: 4 as unknown as undefined,
                    WebkitBoxOrient: 'vertical' as unknown as undefined,
                    overflow: 'hidden',
                  }}>
                    {display.bio}
                  </p>
                )}
                <p style={{
                  marginTop: 10,
                  fontFamily: FONT, fontSize: 11,
                  color: 'var(--text-muted, #55555F)',
                }}>
                  Member since {display.memberSince}
                </p>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ padding: '14px 0 0' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
              }}>
                <PublicStatCard
                  icon={Footprints}
                  label="Nights Out"
                  value={String(display.nights_out)}
                  primary
                />
                <PublicStatCard
                  icon={MapPin}
                  label="Venues"
                  value={String(display.venues_discovered)}
                />
                <PublicStatCard
                  icon={Sparkles}
                  label="Taste"
                  value={`${display.taste_accuracy_pct}%`}
                />
              </div>
            </div>

            {/* Plans summary */}
            {display.plans_completed > 0 && (
              <div style={{
                marginTop: 14,
                padding: '12px 14px',
                background: 'rgba(15, 15, 22, 0.92)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Calendar size={16} strokeWidth={1.8} style={{ color: '#FF8200' }} />
                <p style={{
                  fontFamily: FONT, fontSize: 13,
                  color: 'var(--text-secondary, #8A8A95)', margin: 0,
                }}>
                  {display.plans_completed} {display.plans_completed === 1 ? 'plan' : 'plans'} completed
                </p>
              </div>
            )}

            {/* CTA — download the app */}
            <div style={{ marginTop: 28, textAlign: 'center' }}>
              <p style={{
                fontFamily: FONT, fontSize: 13,
                color: 'var(--text-muted, #55555F)',
                margin: '0 0 10px',
              }}>
                Want your own venuu profile?
              </p>
              <a
                href={downloadAppHref}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '12px 22px',
                  borderRadius: 999,
                  background: '#FF8200',
                  color: 'white',
                  fontFamily: FONT, fontSize: 14, fontWeight: 700,
                  textDecoration: 'none',
                  letterSpacing: '-0.01em',
                }}
              >
                Download venuu →
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PublicStatCard({
  icon: Icon, label, value, primary,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  primary?: boolean;
}) {
  const fontSize = primary ? 36 : 28;
  return (
    <div style={{
      background: 'rgba(15, 15, 22, 0.92)',
      border: primary
        ? '1px solid rgba(255, 130, 0, 0.45)'
        : '1px solid rgba(255, 130, 0, 0.18)',
      borderRadius: 14,
      padding: '14px 8px 12px',
      textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      boxShadow: primary
        ? '0 0 22px rgba(255, 130, 0, 0.28), 0 4px 16px rgba(0,0,0,0.25)'
        : '0 2px 10px rgba(0,0,0,0.2)',
    }}>
      <span style={{
        fontFamily: FONT, fontSize, fontWeight: 800,
        color: '#FF8200', lineHeight: 1,
        letterSpacing: '-0.02em',
      }}>
        {value}
      </span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: FONT, fontSize: 11,
        color: 'var(--text-secondary, #8A8A95)',
        marginTop: 6, lineHeight: 1.2,
      }}>
        <Icon size={11} strokeWidth={1.8} style={{ color: 'var(--text-secondary, #8A8A95)' }} />
        {label}
      </span>
    </div>
  );
}

function NotPublicEmpty({ downloadAppHref }: { downloadAppHref: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '80px 24px 40px',
      textAlign: 'center',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 28,
        background: 'rgba(255, 130, 0, 0.08)',
        border: '1px solid rgba(255, 130, 0, 0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
      }}>
        <Sparkles size={22} strokeWidth={1.6} style={{ color: '#FF8200' }} />
      </div>
      <p style={{
        fontFamily: FONT, fontSize: 18, fontWeight: 700,
        color: 'var(--text-primary, #FFFFFF)', margin: 0,
      }}>
        This profile isn't shared publicly
      </p>
      <p style={{
        fontFamily: FONT, fontSize: 13,
        color: 'var(--text-secondary, #8A8A95)',
        margin: '8px 0 24px', lineHeight: 1.5,
        maxWidth: 320,
      }}>
        The link may be old, or the user turned off public sharing in their settings.
      </p>
      <a
        href={downloadAppHref}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '12px 22px',
          borderRadius: 999,
          background: '#FF8200',
          color: 'white',
          fontFamily: FONT, fontSize: 14, fontWeight: 700,
          textDecoration: 'none',
          letterSpacing: '-0.01em',
        }}
      >
        Download venuu →
      </a>
    </div>
  );
}
