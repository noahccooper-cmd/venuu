import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, LogOut, MapPin, Beer, Star, Ticket, Bell, Sparkles,
  Pencil, Share2, Map as MapIcon, Award, Heart,
  Crown, Trophy, Footprints, Calendar, Flame, LocateOff,
  type LucideIcon,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Browser } from '@capacitor/browser';
import { CITIES, type CityKey } from '../../lib/constants';
import { useVisitHistory } from '../../hooks/useVisitHistory';
import { useMyRecaps } from '../../hooks/useMyRecaps';
import MomentOrb from '../Moment/MomentOrb';
import MomentFullScreen from '../Moment/MomentFullScreen';
import { useUserAccountStats, type UserLevel } from '../../hooks/useUserAccountStats';
import { useUserVibe } from '../../hooks/useUserVibe';
import { useMyPlans, type MyPlan } from '../../hooks/useMyPlans';
import { useMyStamps, type Stamp } from '../../hooks/useMyStamps';
import { useCountUp } from '../../hooks/useCountUp';
import { hapticLight, hapticMedium } from '../../lib/haptics';
import { formatCoverPrice } from '../../lib/coverPricing';
import { supabase } from '../../lib/supabase';
import { generateProfileSnapshot } from '../../lib/profileSnapshot';
import type { Profile, AvatarColor } from '../../lib/types';
import { EditProfileSheet } from './EditProfileSheet';

interface ProfileScreenProps {
  profile: Profile;
  onClose: () => void;
  onSignOut: () => Promise<void>;
  onNavigateToVenue?: (venueId: string) => void;
  /** Called by parent (App.tsx) when the profile has been edited so
   *  it can refetch the row through useAuth.refreshProfile(). */
  onProfileRefresh?: () => Promise<void> | void;
  /** Tapping a plan card enters full-screen Plan Execution Mode
   *  (the time-aware companion that walks the user through stops). */
  onOpenPlanExecution?: (plan: MyPlan) => void;
  /** Tapping the "Talk to Venny" CTA opens Venny. Accepts an
   *  optional priming message that the sheet auto-sends on open. */
  onOpenVenny?: (initialMessage?: string) => void;
  /** "Quick setup" CTA on the missing-taste banner opens the
   *  Tinder-style structured taste flow. */
  onOpenTasteFlow?: () => void;
  /** Current GPS permission status (forwarded from useUserLocation
   *  via App.tsx) — drives the persistent "Location is off" banner
   *  at the top of the profile. */
  locationPermissionStatus?: 'unknown' | 'granted' | 'denied' | 'prompt';
  /** Tap on the "Enable →" CTA in the Location-off banner; the parent
   *  decides whether to call requestPermission() (when prompt/unknown)
   *  or open native settings (when denied). */
  onRequestLocationPermission?: () => Promise<void> | void;
}

const FONT = 'Satoshi, sans-serif';

// ─── Helpers ─────────────────────────────────────────────────────

function getCityLabel(cityKey: string): string {
  const config = CITIES[cityKey as CityKey];
  if (config) return `${config.name}, ${config.state}`;
  return cityKey;
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

/** lucide-react icon paired with each user level — used inside the
 *  level pill so the badge reads as an achievement, not a label. */
function levelIcon(level: UserLevel): LucideIcon {
  switch (level) {
    case 'newcomer':     return Award;
    case 'regular':      return Star;
    case 'local':        return Crown;
    case 'local-legend': return Trophy;
    case 'hall-of-fame': return Sparkles;
  }
}

function avatarHex(color: AvatarColor): string {
  switch (color) {
    case 'orange': return '#FF8200';
    case 'cyan':   return '#00D4FF';
    case 'purple': return '#9B5EFF';
    case 'green':  return '#00CC66';
    case 'pink':   return '#FF5E9C';
    case 'gold':   return '#FFD700';
    case 'sienna': return '#B8623A';
    case 'wine':   return '#8B2543';
    default:       return '#FF8200';
  }
}

/** Map a venue's city to an avatar palette color for stamp circles. */
function stampHexForCity(city: string): string {
  switch (city) {
    case 'knoxville':     return '#FF8200';
    case 'tampa':         return '#00D4FF';
    case 'st_petersburg': return '#9B5EFF';
    default:              return '#55555F';
  }
}

/** Base64-encode a Blob without the data: prefix. The native
 *  Filesystem plugin's writeFile expects the raw base64 body. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('read_not_string'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

// ─── Reusable building blocks ────────────────────────────────────

function GlassCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: 'var(--bg-glass)',
        border: '1px solid var(--brand-orange-tint)',
        borderRadius: 16,
        padding: 16,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  icon, title, subtitle, action,
}: { icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <h3 style={{
          fontFamily: FONT, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)',
          letterSpacing: '-0.01em',
        }}>
          {title}
        </h3>
        {subtitle && (
          <span style={{
            fontFamily: FONT, fontSize: 12, color: 'var(--text-muted)',
            fontWeight: 500,
          }}>
            {subtitle}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

function StatCard({
  value, label, onTap, icon, primary, suffix, sublabel, celebrating,
}: {
  value: number;
  label: string;
  onTap?: () => void;
  icon?: LucideIcon;
  /** When true, render the trophy variant: bigger card, glowing
   *  orange border, subtle ambient pulse on the number when > 0. */
  primary?: boolean;
  /** Optional suffix appended to the number (e.g. "%"). */
  suffix?: string;
  /** Optional small line under the label (e.g. "since Apr 2026"). */
  sublabel?: string;
  /** When true, overlay the milestone confetti burst + bump the
   *  number with a one-shot 1.2× scale spring. */
  celebrating?: boolean;
}) {
  const animated = useCountUp(value, 900);
  const Wrap = onTap ? 'button' : 'div';
  const Icon = icon;
  // Zero-state mutes the number so achieved stats visually win.
  const isZero = value === 0;
  const numberColor = isZero
    ? 'var(--text-muted)'
    : 'var(--brand-orange)';
  const numberSize = primary ? 44 : 28;
  // Brighten the orange glow on the primary card when we've earned it.
  const primaryShadow = primary
    ? (isZero
        ? '0 0 8px rgba(255, 130, 0, 0.08), 0 4px 16px rgba(0,0,0,0.25)'
        : '0 0 22px rgba(255, 130, 0, 0.28), 0 4px 16px rgba(0,0,0,0.25)')
    : '0 2px 10px rgba(0,0,0,0.2)';
  return (
    <Wrap
      type={onTap ? 'button' : undefined}
      onClick={onTap}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 70,
        background: 'var(--bg-glass)',
        border: primary
          ? '1px solid var(--brand-orange-tint-strong)'
          : '1px solid var(--brand-orange-tint)',
        borderRadius: 14,
        padding: primary ? '18px 12px 16px' : '12px 8px 10px',
        textAlign: 'center',
        cursor: onTap ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: primaryShadow,
        font: 'inherit',
        color: 'inherit',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Confetti — CSS-only orange dots fall from the top of the
       *  card on milestone moments. Each one has a unique delay and
       *  drift so the burst feels organic without a JS animation. */}
      {celebrating && (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          {[...Array(10)].map((_, i) => (
            <span
              key={i}
              className="profile-confetti-dot"
              style={{
                left: `${(i * 11) + 6}%`,
                animationDelay: `${(i % 5) * 80}ms`,
                background: i % 2 === 0 ? '#FF8200' : '#FFB888',
              }}
            />
          ))}
        </div>
      )}
      <span
        className={
          (celebrating ? 'profile-stat-burst ' : '') +
          (primary && !isZero ? 'profile-stat-pulse' : '')
        }
        style={{
          fontFamily: FONT, fontSize: numberSize, fontWeight: 800,
          color: numberColor, lineHeight: 1,
          letterSpacing: '-0.02em',
          display: 'inline-flex', alignItems: 'baseline', gap: 1,
        }}
      >
        {animated}{suffix && <span style={{ fontSize: numberSize * 0.55, fontWeight: 700 }}>{suffix}</span>}
      </span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: FONT, fontSize: primary ? 12 : 11, color: 'var(--text-secondary)',
        marginTop: 6, lineHeight: 1.2, letterSpacing: '0.01em',
      }}>
        {Icon && <Icon size={primary ? 13 : 11} strokeWidth={1.8} style={{ color: 'var(--text-secondary)' }} />}
        {label}
      </span>
      {sublabel && (
        <span style={{
          fontFamily: FONT, fontSize: 10, color: 'var(--text-muted)',
          marginTop: 2, letterSpacing: '0.02em',
        }}>
          {sublabel}
        </span>
      )}
    </Wrap>
  );
}

function VibePill({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '5px 10px', borderRadius: 999,
      background: accent ? 'var(--brand-orange-tint)' : 'rgba(255,255,255,0.05)',
      border: accent ? '1px solid var(--brand-orange-tint-strong)' : '1px solid var(--border-subtle)',
      color: accent ? '#FFD9B8' : 'rgba(255,255,255,0.85)',
      fontFamily: FONT, fontSize: 12, fontWeight: 600,
      letterSpacing: '-0.01em',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

/** Mini punch card dots — preserved from v1 visual */
function MiniPunchDots({ filled, total }: { filled: number; total: number }) {
  const dots = [];
  for (let i = 0; i < total; i++) {
    const isFilled = i < filled;
    dots.push(
      <div
        key={i}
        style={{
          width: 16, height: 16, borderRadius: '50%',
          background: isFilled ? '#FF8200' : 'rgba(255,255,255,0.08)',
          border: isFilled ? '1.5px solid #FF8200' : '1.5px solid rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 8, color: 'white',
        }}
      >
        {isFilled ? '✓' : ''}
      </div>
    );
  }
  return <div style={{ display: 'flex', gap: 3 }}>{dots}</div>;
}

// ─── Main component ─────────────────────────────────────────────

export function ProfileScreen({
  profile,
  onClose,
  onSignOut,
  onNavigateToVenue,
  onProfileRefresh,
  onOpenPlanExecution,
  onOpenVenny,
  onOpenTasteFlow,
  locationPermissionStatus,
  onRequestLocationPermission,
}: ProfileScreenProps) {
  // ── Existing data (preserved) ──
  const { bars, loading: barsLoading } = useVisitHistory(profile.auth_id);
  const { recaps: myMoments, loading: momentsLoading } = useMyRecaps(profile.username);
  const [openMomentId, setOpenMomentId] = useState<string | null>(null);
  const openMoment = useMemo(
    () => myMoments?.find(m => m.id === openMomentId) ?? null,
    [myMoments, openMomentId],
  );

  // ── New data sources ──
  const stats = useUserAccountStats({
    profileId: profile.id,
    authId: profile.auth_id,
    profileCreatedAt: profile.created_at,
  });
  const vibe  = useUserVibe(profile.auth_id);
  const { plans, loading: plansLoading } = useMyPlans(profile.id);
  // user_visits keys on profile.id (NOT auth.users.id) — stamps now
  // pull from the new confirmed-visits table that aggregates passive
  // GPS + NFC + cover + plan-stop sources.
  const { stamps, visitedCount: stampsVisited, cityTotal: stampsCityTotal } = useMyStamps(profile.id, profile.city);

  // ── Defensive diagnostic for the v1.2 plans visibility bug.
  //    Kept in for one release so any future user_id/profile.id
  //    drift between save_plan (writes profiles.id) and useMyPlans
  //    (reads where user_id = profile.id) is immediately visible
  //    in the console. Remove in a follow-up release if no recurrence.
  useEffect(() => {
    if (plansLoading) return;
    console.log('[my_plans] hydrated', {
      authUserId: profile.auth_id,
      profileId: profile.id,
      plansReturned: plans.length,
    });
  }, [plansLoading, plans.length, profile.auth_id, profile.id]);

  // ── UI state ──
  const [showAllStamps, setShowAllStamps] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // ── Nights-Out milestone celebration ─────────────────────────────
  // Fires a confetti burst + haptic + spring-bump when nightsOut
  // crosses a threshold for the first time. localStorage flag per
  // milestone prevents replay on every reload.
  const [celebrateNights, setCelebrateNights] = useState(false);
  useEffect(() => {
    if (stats.loading) return;
    if (stats.nightsOut <= 0) return;
    const milestones = [1, 5, 10, 25, 50, 100];
    // Highest milestone that the current value qualifies for. We don't
    // fire for every threshold passed — just the most impressive one
    // the user has yet to see.
    let earned: number | null = null;
    for (const m of milestones) {
      if (stats.nightsOut >= m) earned = m;
    }
    if (earned == null) return;
    const key = `venuu_milestone_seen_${earned}`;
    try {
      if (localStorage.getItem(key) === 'true') return;
      localStorage.setItem(key, 'true');
    } catch { /* private mode */ }
    setCelebrateNights(true);
    void hapticMedium();
    const t = window.setTimeout(() => setCelebrateNights(false), 1700);
    return () => window.clearTimeout(t);
  }, [stats.loading, stats.nightsOut]);

  // ── Plan-completion dopamine listener.
  //    PlanSheet's completePlan dispatches venuu-plan-completed-
  //    celebrate. The streak chip glows + the Plans Run stat card
  //    fires its built-in `celebrating` confetti for a brief beat.
  //    Independent state flags so they can run together without
  //    one cutting the other short.
  const [streakBursting, setStreakBursting] = useState(false);
  const [celebratePlans, setCelebratePlans] = useState(false);
  const [celebrateTaste, setCelebrateTaste] = useState(false);
  useEffect(() => {
    function handle() {
      setStreakBursting(true);
      setCelebratePlans(true);
      window.setTimeout(() => setStreakBursting(false), 1600);
      window.setTimeout(() => setCelebratePlans(false), 1400);
      // Refetch stats so the Plans Run number ticks up — the realtime
      // sub on user_visits doesn't fire for night_plans status flips.
      stats.refetch?.();
    }
    window.addEventListener('venuu-plan-completed-celebrate', handle as EventListener);
    return () => window.removeEventListener('venuu-plan-completed-celebrate', handle as EventListener);
  }, [stats]);

  // When a user finishes the rate flow, Taste % gets new data — burst
  // the stat card so the increment reads as a reward, not a quiet
  // tick. Hook refetches via its own listener too; the burst here is
  // the visual companion.
  useEffect(() => {
    function handle() {
      setCelebrateTaste(true);
      window.setTimeout(() => setCelebrateTaste(false), 1400);
    }
    window.addEventListener('venuu-night-rated', handle as EventListener);
    return () => window.removeEventListener('venuu-night-rated', handle as EventListener);
  }, []);

  // ── "since {Mon YYYY}" sublabel under the Nights Out stat.
  //    accountSince is computed inside useUserAccountStats now —
  //    earliest user_visits.first_seen_at, falling back to the
  //    profile's created_at.
  const sinceLabel = useMemo(() => {
    if (!stats.accountSince) return undefined;
    const d = new Date(stats.accountSince);
    if (Number.isNaN(d.getTime())) return undefined;
    const fmt = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `since ${fmt}`;
  }, [stats.accountSince]);

  // ── Privacy toggles — local mirror so the switch is instant; the
  //    canonical state lives on profile.show_*_publicly. Sync when the
  //    profile prop changes. Saved on toggle via supabase update + parent refresh.
  const [showRecaps, setShowRecaps] = useState<boolean>(profile.show_recaps_publicly ?? true);
  const [showVisits, setShowVisits] = useState<boolean>(profile.show_visits_publicly ?? true);
  useEffect(() => {
    setShowRecaps(profile.show_recaps_publicly ?? true);
    setShowVisits(profile.show_visits_publicly ?? true);
  }, [profile.show_recaps_publicly, profile.show_visits_publicly]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  // ── My Covers (preserved query) ──
  const [myCovers, setMyCovers] = useState<{ id: string; venue_name: string; price_paid: number; qr_code: string; status: string; purchased_at: string }[]>([]);
  const [showQR, setShowQR] = useState<string | null>(null);
  useEffect(() => {
    if (!profile.auth_id) return;
    (async () => {
      const { data } = await supabase
        .from('cover_purchases')
        .select('id, price_paid, qr_code, status, purchased_at, venues!inner(name)')
        .eq('user_id', profile.auth_id)
        .in('status', ['completed', 'used'])
        .order('purchased_at', { ascending: false })
        .limit(10);
      if (data) {
        setMyCovers(data.map((d: Record<string, unknown>) => ({
          id: d.id as string,
          venue_name: (d.venues as { name: string })?.name ?? '',
          price_paid: d.price_paid as number,
          qr_code: d.qr_code as string,
          status: d.status as string,
          purchased_at: d.purchased_at as string,
        })));
      }
    })();
  }, [profile.auth_id]);

  // ── My Tickets (preserved query) ──
  const [myTickets, setMyTickets] = useState<{
    id: string; qr_code: string; status: string; price_paid: number;
    purchased_at: string; event_title: string; event_start_time: string;
    event_end_time: string | null; venue_name: string | null;
  }[]>([]);
  const [showTicketQR, setShowTicketQR] = useState<string | null>(null);
  useEffect(() => {
    if (!profile.auth_id) return;
    (async () => {
      const { data } = await supabase
        .from('event_tickets')
        .select('id, qr_code, status, price_paid, purchased_at, events!inner(title, start_time, end_time, venues(name))')
        .eq('user_id', profile.auth_id)
        .in('status', ['completed', 'used'])
        .order('purchased_at', { ascending: false })
        .limit(20);
      if (data) {
        setMyTickets(data.map((d: Record<string, unknown>) => {
          const evt = d.events as { title: string; start_time: string; end_time: string | null; venues: { name: string } | null } | null;
          return {
            id: d.id as string,
            qr_code: d.qr_code as string,
            status: d.status as string,
            price_paid: d.price_paid as number,
            purchased_at: d.purchased_at as string,
            event_title: evt?.title ?? '',
            event_start_time: evt?.start_time ?? '',
            event_end_time: evt?.end_time ?? null,
            venue_name: evt?.venues?.name ?? null,
          };
        }));
      }
    })();
  }, [profile.auth_id]);

  // ── Push notification permission (native only, preserved) ──
  const [pushPermission, setPushPermission] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    PushNotifications.checkPermissions()
      .then(result => setPushPermission(result.receive as 'granted' | 'denied' | 'prompt'))
      .catch(() => setPushPermission('unknown'));
  }, []);
  const handleOpenNotificationSettings = async () => {
    try { await Browser.open({ url: 'app-settings:' }); }
    catch { window.location.href = 'app-settings:'; }
  };

  // ── Intro animation toggle (preserved) ──
  const [introEnabled, setIntroEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('venuu_intro_enabled') !== 'false'; }
    catch { return true; }
  });
  const handleToggleIntro = () => {
    const next = !introEnabled;
    setIntroEnabled(next);
    try {
      localStorage.setItem('venuu_intro_enabled', String(next));
      if (!next) localStorage.removeItem('venuu_intro_last_seen');
    } catch { /* private mode */ }
  };
  const handleReplayIntro = () => {
    try { localStorage.removeItem('venuu_intro_last_seen'); } catch { /* ignore */ }
    onClose();
    setTimeout(() => window.location.reload(), 50);
  };

  // ── Privacy toggle persist ──
  const persistPrivacyToggle = useCallback(async (
    column: 'show_recaps_publicly' | 'show_visits_publicly',
    next: boolean,
  ) => {
    const { error } = await supabase
      .from('profiles')
      .update({ [column]: next, updated_at: new Date().toISOString() })
      .eq('id', profile.id);
    if (error) {
      showToast('couldn’t save — try again');
      // Revert local mirror.
      if (column === 'show_recaps_publicly') setShowRecaps(!next);
      else setShowVisits(!next);
      return;
    }
    void onProfileRefresh?.();
  }, [profile.id, onProfileRefresh, showToast]);

  // ── Sign out / delete (preserved) ──
  const handleSignOut = async () => { await onSignOut(); onClose(); };
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await supabase.rpc('delete_user_account');
    } catch {
      const uid = profile.auth_id;
      if (uid) {
        await supabase.from('loyalty_visits').delete().eq('user_id', uid);
        await supabase.from('cover_purchases').delete().eq('user_id', uid);
        await supabase.from('loyalty_redemptions').delete().eq('user_id', uid);
        await supabase.from('push_tokens').delete().eq('user_id', uid);
        await supabase.from('profiles').delete().eq('auth_id', uid);
      }
    }
    await supabase.auth.signOut();
    localStorage.clear();
    setDeleting(false);
    setShowDeleteConfirm(false);
    onClose();
  };

  const handleBarTap = (venueId: string) => {
    if (onNavigateToVenue) onNavigateToVenue(venueId);
    onClose();
  };

  // Generating-state for the Share button. The actual share handler
  // is defined further down — it needs displayName / initials /
  // avatarBg in scope, which haven't been computed yet at this point
  // in the component body.
  const [sharingSnapshot, setSharingSnapshot] = useState(false);

  // ── Edit profile open/close + post-save ──
  const handleEditTap = () => { hapticLight(); setEditOpen(true); };
  const handleEditSaved = useCallback(async () => {
    setEditOpen(false);
    await onProfileRefresh?.();
    showToast('profile updated');
  }, [onProfileRefresh, showToast]);

  // ── Derived UI bits ──
  const displayName = profile.display_name || profile.username;
  const initials = useMemo(() => displayName.slice(0, 2).toUpperCase(), [displayName]);
  const avatarBg = avatarHex(profile.avatar_color ?? 'orange');
  const visibleStamps = showAllStamps ? stamps : stamps.slice(0, 12);

  // ── Profile share — generates a 1080×1080 PNG snapshot then routes
  //    through the native share sheet (iOS) or a download + link copy
  //    (web). Defined here (not above) so displayName/initials/
  //    avatarBg are in scope.
  const handleShareProfile = useCallback(async () => {
    if (sharingSnapshot) return;
    hapticLight();
    const token = profile.profile_share_token;
    if (!token) {
      showToast('share link not ready yet');
      return;
    }
    setSharingSnapshot(true);
    try {
      const blob = await generateProfileSnapshot({
        displayName,
        username: profile.username,
        city: profile.city,
        level: levelLabel(stats.level),
        avatarColor: avatarBg,
        initials,
        nightsOut: stats.nightsOut,
        venuesDiscovered: stats.venuesDiscovered,
        tasteAccuracy: stats.tasteAccuracyPct,
        vibesLiked: (vibe.vibesLiked ?? []).slice(0, 5),
        shareToken: token,
      });
      const shareUrl = `https://venuu.app/u/${token}`;

      if (Capacitor.isNativePlatform()) {
        // Save PNG to the device cache, then hand the URI to the
        // native share sheet. @capacitor/filesystem + @capacitor/share
        // are already in package.json (8.x).
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import('@capacitor/filesystem'),
          import('@capacitor/share'),
        ]);
        const base64 = await blobToBase64(blob);
        const path = `venuu-${token}.png`;
        const file = await Filesystem.writeFile({
          path,
          data: base64,
          directory: Directory.Cache,
        });
        await Share.share({
          title: `${displayName} on venuu`,
          text: `My venuu — ${shareUrl}`,
          url: file.uri,
          dialogTitle: 'Share your venuu',
        });
        showToast('shared');
      } else {
        // Web: trigger a download AND copy the URL to clipboard so
        // the user gets both the artifact and the link in one tap.
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `venuu-${profile.username || 'profile'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        try {
          await navigator.clipboard.writeText(shareUrl);
          showToast('snapshot downloaded · link copied');
        } catch {
          showToast('snapshot downloaded');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'share failed';
      console.warn('[profile_share] failed:', msg);
      showToast('share failed');
    } finally {
      setSharingSnapshot(false);
    }
  }, [
    sharingSnapshot,
    profile.profile_share_token,
    profile.username,
    profile.city,
    displayName,
    stats.level,
    stats.nightsOut,
    stats.venuesDiscovered,
    stats.tasteAccuracyPct,
    avatarBg,
    initials,
    vibe.vibesLiked,
    showToast,
  ]);

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg-page)',
        display: 'flex',
        flexDirection: 'column',
        // When mounted as the 'you' tab, the bottom nav sits below us;
        // when used as legacy overlay, the parent positions us fullscreen.
      }}
    >
      {/* ── Header bar (preserved) ── */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          background: 'var(--bg-page)',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0,
          zIndex: 2,
        }}
      >
        <button
          type="button"
          onClick={() => { hapticLight(); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none',
            color: 'var(--text-secondary)',
            fontFamily: FONT, fontSize: 14, fontWeight: 500,
            cursor: 'pointer', padding: '8px 4px', minHeight: 44,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <ArrowLeft size={18} strokeWidth={1.5} />
          Back
        </button>
        <p style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
          Profile
        </p>
        <div style={{ width: 60 }} />
      </div>

      {/* ── Floating toast ── */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 'calc(80px + env(safe-area-inset-top, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            borderRadius: 18,
            background: 'rgba(10, 10, 14, 0.95)',
            border: '1px solid var(--brand-orange-tint-strong)',
            color: '#FFD9B8',
            fontFamily: FONT, fontSize: 13, fontWeight: 600,
            boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
            zIndex: 2200, pointerEvents: 'none',
          }}
        >
          {toast}
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)',
        }}
      >
        {/* ── 0. LOCATION OFF BANNER — re-engagement path for users
         *  whose GPS permission is denied or who dismissed the on-map
         *  prompt. Persistent (no per-session flag) so the user has
         *  a reliable surface to flip it back on. ───────────────── */}
        {(locationPermissionStatus === 'denied'
          || locationPermissionStatus === 'prompt'
          || locationPermissionStatus === 'unknown') && (
          <div style={{ padding: '20px 16px 0' }}>
            <button
              type="button"
              onClick={() => {
                hapticLight();
                void onRequestLocationPermission?.();
              }}
              style={{
                width: '100%',
                background: 'var(--bg-glass)',
                border: '1px solid rgba(255, 80, 80, 0.32)',
                borderRadius: 16,
                padding: '14px 16px',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                boxShadow: '0 0 18px rgba(255, 80, 80, 0.10)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                textAlign: 'left',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                font: 'inherit', color: 'inherit',
              }}
            >
              <div style={{
                flexShrink: 0,
                width: 36, height: 36, borderRadius: 18,
                background: 'rgba(255, 80, 80, 0.14)',
                border: '1px solid rgba(255, 80, 80, 0.28)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <LocateOff size={16} strokeWidth={1.8} style={{ color: '#FF8080' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontFamily: FONT, fontSize: 14, fontWeight: 700,
                  color: 'var(--text-primary)', margin: 0,
                  letterSpacing: '-0.01em',
                }}>
                  Location is off
                </p>
                <p style={{
                  fontFamily: FONT, fontSize: 12,
                  color: 'var(--text-secondary)', margin: '2px 0 0',
                  lineHeight: 1.4,
                }}>
                  Your nights aren't being tracked automatically. Enable location to count visits and unlock stamps.
                </p>
              </div>
              <span style={{
                fontFamily: FONT, fontSize: 12, fontWeight: 700,
                color: '#FF8080',
                background: 'rgba(255, 80, 80, 0.14)',
                border: '1px solid rgba(255, 80, 80, 0.32)',
                borderRadius: 999,
                padding: '6px 12px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>
                Enable →
              </span>
            </button>
          </div>
        )}

        {/* ── 1. HERO CARD ─────────────────────────────────── */}
        <div style={{ padding: '20px 16px 0' }}>
          <GlassCard style={{ padding: '28px 20px 22px' }}>
            {(() => {
              const LevelIcon = levelIcon(stats.level);
              const bothEmpty = !profile.tagline && !profile.bio;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* Avatar */}
                  <div
                    style={{
                      width: 96, height: 96, borderRadius: '50%',
                      background: avatarBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 14,
                      boxShadow: `0 0 0 4px rgba(255, 130, 0, 0.18), 0 8px 32px ${avatarBg}55`,
                    }}
                  >
                    <span style={{
                      fontFamily: FONT, fontSize: 36, fontWeight: 800,
                      color: 'white', letterSpacing: '-0.02em',
                    }}>
                      {initials}
                    </span>
                  </div>

                  {/* Name */}
                  <p style={{
                    fontFamily: FONT, fontSize: 28, fontWeight: 800,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.02em', lineHeight: 1.1,
                    margin: 0,
                  }}>
                    {displayName}
                  </p>

                  <p style={{
                    fontFamily: FONT, fontSize: 13, color: 'var(--text-secondary)',
                    marginTop: 4, marginBottom: 12, margin: '4px 0 12px',
                  }}>
                    @{profile.username} · {getCityLabel(profile.city)}
                  </p>

                  {/* Level pill — gradient bg, icon, presence (Fix 7) */}
                  <div className="profile-level-pill" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 14px',
                    borderRadius: 999,
                    background: 'linear-gradient(135deg, var(--brand-orange-tint), rgba(255, 130, 0, 0.04))',
                    border: '1px solid var(--brand-orange-tint-strong)',
                    color: '#FFD9B8',
                    boxShadow: '0 0 12px var(--brand-orange-glow)',
                    fontFamily: FONT, fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>
                    <LevelIcon size={12} strokeWidth={2} style={{ color: 'var(--brand-orange)' }} />
                    {levelLabel(stats.level)}
                  </div>

                  {/* Conditional content — empty-state collapse (Fix 1) */}
                  {bothEmpty ? (
                    <button
                      type="button"
                      onClick={handleEditTap}
                      className="profile-make-yours"
                      style={{
                        marginTop: 14,
                        background: 'transparent', border: 'none',
                        color: 'var(--brand-orange)',
                        fontFamily: FONT, fontSize: 13, fontWeight: 600,
                        fontStyle: 'italic',
                        cursor: 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                        padding: '4px 8px',
                      }}
                    >
                      ✨ make this yours
                    </button>
                  ) : (
                    <>
                      {profile.tagline && (
                        <p style={{
                          marginTop: 14,
                          fontFamily: FONT, fontSize: 14, fontStyle: 'italic',
                          color: 'var(--text-secondary)',
                          textAlign: 'center',
                          lineHeight: 1.4,
                          margin: '14px 0 0',
                        }}>
                          {profile.tagline}
                        </p>
                      )}
                      {profile.bio && (
                        <p style={{
                          marginTop: 8,
                          fontFamily: FONT, fontSize: 13,
                          color: 'var(--text-secondary)',
                          textAlign: 'center',
                          lineHeight: 1.5,
                          maxWidth: 320,
                          display: '-webkit-box',
                          WebkitLineClamp: 4 as unknown as undefined,
                          WebkitBoxOrient: 'vertical' as unknown as undefined,
                          overflow: 'hidden',
                          margin: '8px 0 0',
                        }}>
                          {profile.bio}
                        </p>
                      )}
                      {/* If only one of the two is set, expose a small
                       *  inline link to add the other rather than a
                       *  full placeholder line. */}
                      {profile.bio && !profile.tagline && (
                        <button
                          type="button"
                          onClick={handleEditTap}
                          style={{
                            marginTop: 6,
                            background: 'transparent', border: 'none',
                            color: 'var(--text-muted)',
                            fontFamily: FONT, fontSize: 12, fontWeight: 500,
                            cursor: 'pointer', padding: 0,
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          + add a tagline
                        </button>
                      )}
                    </>
                  )}

                  {/* Confident Edit + Share row — Fix 2 (labelled pair) */}
                  <div style={{
                    display: 'flex', gap: 10,
                    marginTop: 18,
                  }}>
                    <button
                      type="button"
                      onClick={handleEditTap}
                      aria-label="Edit profile"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '9px 16px',
                        borderRadius: 999,
                        background: 'var(--brand-orange-tint)',
                        border: '1px solid var(--brand-orange-tint-strong)',
                        color: 'var(--brand-orange)',
                        fontFamily: FONT, fontSize: 13, fontWeight: 700,
                        cursor: 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      <Pencil size={14} strokeWidth={1.8} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={handleShareProfile}
                      disabled={sharingSnapshot}
                      aria-label={sharingSnapshot ? 'Generating snapshot' : 'Share profile'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '9px 16px',
                        borderRadius: 999,
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-subtle)',
                        color: sharingSnapshot ? 'var(--text-muted)' : 'var(--text-primary)',
                        fontFamily: FONT, fontSize: 13, fontWeight: 600,
                        cursor: sharingSnapshot ? 'default' : 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      <Share2 size={14} strokeWidth={1.8} />
                      {sharingSnapshot ? 'Generating…' : 'Share'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </GlassCard>
        </div>

        {/* ── 2. STATS HERO — trophy treatment (Fix 3) ───────── */}
        <div style={{ padding: '14px 16px 0' }}>
          {/* Top row: Nights Out as the standalone hero stat */}
          <div style={{ marginBottom: 8 }}>
            <StatCard
              value={stats.nightsOut}
              label="Nights Out"
              icon={Footprints}
              primary
              sublabel={sinceLabel}
              celebrating={celebrateNights}
              onTap={() => { hapticLight(); console.log('[stat] nightsOut tapped'); }}
            />
          </div>
          {/* Bottom row — peer stats. Two columns until the user has
           *  rated at least one stop, then Taste % unlocks as a third
           *  card. Each card has its own celebration hook so the
           *  visual signal is different per stat. */}
          {(() => {
            const tasteHasData = (stats.tasteAccuracyPct ?? 0) > 0;
            return (
              <div
                className="profile-stats-grid"
                style={{ ['--cols' as string]: tasteHasData ? 3 : 2 } as React.CSSProperties}
              >
                <StatCard
                  value={stats.venuesDiscovered}
                  label="Venues"
                  icon={MapPin}
                  onTap={() => { hapticLight(); console.log('[stat] venues tapped'); }}
                />
                <StatCard
                  value={stats.plansCompleted}
                  label="Plans Run"
                  icon={Calendar}
                  celebrating={celebratePlans}
                  onTap={() => { hapticLight(); console.log('[stat] plans tapped'); }}
                />
                {tasteHasData && (
                  <StatCard
                    value={stats.tasteAccuracyPct}
                    label="Taste"
                    icon={Sparkles}
                    suffix="%"
                    celebrating={celebrateTaste}
                    onTap={() => { hapticLight(); console.log('[stat] taste tapped'); }}
                  />
                )}
              </div>
            );
          })()}

          {/* Weekend streak (Fix 6) */}
          <div
            className={`profile-streak${streakBursting ? ' profile-streak--bursting' : ''}`}
            style={{
              marginTop: 12,
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px',
              background: 'var(--bg-glass)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <Flame
              size={18}
              strokeWidth={1.8}
              className={stats.weekendStreak >= 5 ? 'profile-streak-glow' : undefined}
              style={{
                color: stats.weekendStreak > 0 ? '#FF8200' : 'rgba(255, 130, 0, 0.3)',
                flexShrink: 0,
              }}
            />
            {stats.weekendStreak > 0 ? (
              <p style={{
                fontFamily: FONT, fontSize: 13,
                color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35,
              }}>
                <span style={{ color: 'var(--brand-orange)', fontWeight: 800 }}>
                  {stats.weekendStreak}
                </span>
                {' '}
                weekend{stats.weekendStreak === 1 ? '' : 's'} in a row
              </p>
            ) : (
              <p style={{
                fontFamily: FONT, fontSize: 12,
                color: 'var(--text-muted)', margin: 0, lineHeight: 1.35,
              }}>
                No streak yet — show up Fri/Sat to start one
              </p>
            )}
          </div>
        </div>

        {/* ── 3. MY VIBE ────────────────────────────────────── */}
        <div style={{ padding: '20px 16px 0' }}>
          {vibe.hasAnyData ? (
            <GlassCard>
              <SectionHeader
                icon={<Sparkles size={16} strokeWidth={1.8} style={{ color: 'var(--brand-orange)' }} />}
                title="My Vibe"
                subtitle="Venny knows"
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {vibe.age != null && <VibePill>{vibe.age} years old</VibePill>}
                {vibe.typicalBudget && <VibePill accent>{vibe.typicalBudget}</VibePill>}
                {/* Dress pill — prefixed with a clothing emoji and
                 *  relabeled to avoid the "chill" overlap with the
                 *  vibes_liked array. */}
                {vibe.dressStyle && (() => {
                  const ds = vibe.dressStyle.toLowerCase();
                  const label =
                    ds === 'chill'  ? '👕 casual' :
                    ds === 'smart'  ? '👔 smart'  :
                    ds === 'dressy' ? '🥂 dressy' :
                    ds;
                  return <VibePill>{label}</VibePill>;
                })()}
                {vibe.groupSizeTypical != null && (
                  <VibePill>
                    {vibe.groupSizeTypical === 1
                      ? 'solo'
                      : vibe.groupSizeTypical === 2
                        ? 'couple'
                        : vibe.groupSizeTypical <= 4
                          ? 'small group'
                          : `group of ${vibe.groupSizeTypical}`}
                  </VibePill>
                )}
                {/* Music — split on comma so each genre is its own
                 *  pill rather than one ugly "edm,rock,hip-hop". */}
                {vibe.musicTaste && vibe.musicTaste.split(',')
                  .map(g => g.trim())
                  .filter(g => g.length > 0)
                  .map(genre => (
                    <VibePill key={`music-${genre}`}>♪ {genre}</VibePill>
                  ))
                }
                {vibe.vibesLiked.map(v => (
                  <VibePill key={`liked-${v}`} accent>{v}</VibePill>
                ))}
              </div>
              {vibe.homeCity && (
                <p style={{
                  marginTop: 10,
                  fontFamily: FONT, fontSize: 12, color: 'var(--text-muted)',
                }}>
                  Home: {vibe.homeCity}
                </p>
              )}
              {/* Two ways to refine: re-do the structured flow, or
               *  keep talking to Venny conversationally. */}
              <div style={{
                marginTop: 12,
                display: 'flex', flexWrap: 'wrap', gap: 14,
              }}>
                <button
                  type="button"
                  onClick={() => { hapticLight(); onOpenVenny?.(); }}
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--brand-orange)',
                    fontFamily: FONT, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', padding: 0,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  Tell Venny more →
                </button>
                {onOpenTasteFlow && (
                  <button
                    type="button"
                    onClick={() => { hapticLight(); onOpenTasteFlow(); }}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--text-muted)',
                      fontFamily: FONT, fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', padding: 0,
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    Re-do my taste
                  </button>
                )}
              </div>
            </GlassCard>
          ) : (
            <div style={{
              background: 'var(--bg-glass)',
              border: '1px solid var(--brand-orange-tint-strong)',
              borderRadius: 16,
              padding: '14px 16px',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 0 18px rgba(255, 130, 0, 0.12)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Sparkles
                  size={20}
                  strokeWidth={1.7}
                  style={{ color: 'var(--brand-orange)', flexShrink: 0, marginTop: 2 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontFamily: FONT, fontSize: 14, fontWeight: 700,
                    color: 'var(--text-primary)', margin: 0,
                    letterSpacing: '-0.01em',
                  }}>
                    Tell Venny your taste
                  </p>
                  <p style={{
                    fontFamily: FONT, fontSize: 12,
                    color: 'var(--text-secondary)', margin: '2px 0 0',
                    lineHeight: 1.4,
                  }}>
                    She’ll plan way better when she knows your vibe.
                  </p>
                </div>
              </div>
              {/* Two paths, two costs. Quick setup is primary (the
               *  structured 6-step flow); Talk to Venny is the
               *  conversational fallback. */}
              <div style={{
                marginTop: 12,
                display: 'flex', gap: 8, flexWrap: 'wrap',
              }}>
                <button
                  type="button"
                  onClick={() => {
                    hapticLight();
                    onOpenTasteFlow?.();
                  }}
                  disabled={!onOpenTasteFlow}
                  style={{
                    flex: '1 1 140px',
                    padding: '10px 14px',
                    borderRadius: 999,
                    background: 'var(--brand-orange)',
                    border: 'none',
                    color: 'white',
                    fontFamily: FONT, fontSize: 13, fontWeight: 700,
                    cursor: onOpenTasteFlow ? 'pointer' : 'default',
                    WebkitTapHighlightColor: 'transparent',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Quick setup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    hapticLight();
                    onOpenVenny?.(
                      'ask me what kind of places I like, my budget, and my style — i want to set up my taste profile'
                    );
                  }}
                  style={{
                    flex: '1 1 140px',
                    padding: '10px 14px',
                    borderRadius: 999,
                    background: 'transparent',
                    border: '1px solid var(--brand-orange-tint-strong)',
                    color: 'var(--brand-orange)',
                    fontFamily: FONT, fontSize: 13, fontWeight: 700,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Talk to Venny
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── 4. MY PLANS — renders unconditionally so users get
         *    visible feedback even before they save anything (Fix 5
         *    + Fix 8). The empty-state CTA opens Venny. ─────────── */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ paddingRight: 4 }}>
            <SectionHeader
              icon={<MapIcon size={16} strokeWidth={1.8} style={{ color: 'var(--brand-orange)' }} />}
              title="My Plans"
              subtitle={plans.length ? `${plans.length}` : undefined}
              action={plans.length > 0 ? (
                <button
                  type="button"
                  onClick={() => showToast('all plans view coming soon')}
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--brand-orange)',
                    fontFamily: FONT, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', padding: 0,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  See all
                </button>
              ) : undefined}
            />
          </div>
          {plansLoading ? (
            <GlassCard style={{ display: 'flex', justifyContent: 'center', padding: '28px 16px' }}>
              <div className="w-6 h-6 border-2 border-[#FF8200] border-t-transparent rounded-full animate-spin" />
            </GlassCard>
          ) : plans.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No plans yet"
              body="Ask Venny to make you one — she's good at this."
              ctaLabel="Talk to Venny →"
              onCta={() => { hapticLight(); onOpenVenny?.(); }}
            />
          ) : (
            <div
              style={{
                display: 'flex', gap: 12,
                overflowX: 'auto', WebkitOverflowScrolling: 'touch',
                scrollSnapType: 'x mandatory',
                paddingBottom: 4,
                marginLeft: -16, marginRight: -16,
                paddingLeft: 16, paddingRight: 16,
              }}
            >
              {plans.slice(0, 5).map(plan => (
                <PlanMiniCard key={plan.id} plan={plan} onTap={() => {
                  hapticLight();
                  onOpenPlanExecution?.(plan);
                }} />
              ))}
            </div>
          )}
        </div>

        {/* ── 6. STAMPS GRID — Venues Discovered (Ship 3 ordering:
         *  passive exploration leads, active rewards follows). Reads
         *  user_visits via useMyStamps so passive presence + NFC +
         *  cover + plan stops all light up the dots. Faded outlines
         *  are the city's unvisited venues. ─────────────────────── */}
        <div style={{ padding: '20px 16px 0' }}>
          <SectionHeader
            icon={<Award size={16} strokeWidth={1.8} style={{ color: 'var(--brand-orange)' }} />}
            title="Venues discovered"
            subtitle={stampsCityTotal > 0 ? `${stampsVisited}/${stampsCityTotal}` : undefined}
          />
          {stamps.length === 0 ? (
            <GlassCard style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Award size={20} strokeWidth={1.6} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <p style={{
                fontFamily: FONT, fontSize: 13,
                color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4,
              }}>
                Walk into your first bar — venuu fills this in automatically.
              </p>
            </GlassCard>
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 12,
                }}
              >
                {visibleStamps.map(s => <StampDot key={s.venueId} stamp={s} onTap={() => handleBarTap(s.venueId)} />)}
              </div>
              {stamps.length > 12 && !showAllStamps && (
                <button
                  type="button"
                  onClick={() => setShowAllStamps(true)}
                  style={{
                    marginTop: 12, width: '100%', padding: '10px',
                    background: 'transparent',
                    border: '1px solid var(--border-card)',
                    borderRadius: 12,
                    color: 'var(--brand-orange)',
                    fontFamily: FONT, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  Show all ({stamps.length})
                </button>
              )}
            </>
          )}
        </div>

        {/* ── 7. MY REWARDS (was "My Bars") — loyalty progress, driven
         *  by NFC taps (loyalty_visits). Sits below the passive
         *  exploration track because rewards are an active opt-in
         *  per bar. ─────────────────────────────────────────────── */}
        <div style={{ padding: '20px 16px 0' }}>
          <SectionHeader
            icon={<Beer size={16} strokeWidth={1.8} style={{ color: 'var(--brand-orange)' }} />}
            title="My Rewards"
          />
          <GlassCard style={{ padding: 0 }}>
            {barsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                <div className="w-6 h-6 border-2 border-[#FF8200] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : bars.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '28px 20px', textAlign: 'center',
              }}>
                <div className="profile-empty-glow" style={{
                  width: 44, height: 44, borderRadius: 22,
                  background: 'rgba(255, 130, 0, 0.08)',
                  border: '1px solid var(--brand-orange-tint)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 12,
                }}>
                  <Beer size={20} strokeWidth={1.6} style={{ color: 'var(--brand-orange)' }} />
                </div>
                <p style={{
                  fontFamily: FONT, fontSize: 15, fontWeight: 700,
                  color: 'var(--text-primary)', margin: '0 0 4px',
                }}>
                  no rewards yet
                </p>
                <p style={{
                  fontFamily: FONT, fontSize: 12,
                  color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45,
                  maxWidth: 280,
                }}>
                  Tap an NFC tag at a participating bar to start collecting rewards. Free drinks, ahoy.
                </p>
              </div>
            ) : (
              <div>
                {bars.map((bar, idx) => {
                  const effective = bar.visitCount % bar.visitsRequired || (bar.canRedeem ? bar.visitsRequired : 0);
                  const remaining = bar.visitsRequired - effective;
                  return (
                    <button
                      type="button"
                      key={bar.venueId}
                      onClick={() => handleBarTap(bar.venueId)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', padding: '14px 16px',
                        background: 'transparent', border: 'none',
                        borderBottom: idx < bars.length - 1 ? '1px solid var(--border-hairline)' : 'none',
                        cursor: 'pointer', textAlign: 'left',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontFamily: FONT, fontSize: 15, fontWeight: 700,
                          color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          margin: 0,
                        }}>
                          {bar.venueName}
                        </p>
                        <p style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-muted)', marginTop: 2, margin: 0 }}>
                          {bar.venueCity || 'Unknown'}
                        </p>
                        <p style={{
                          fontFamily: FONT, fontSize: 11,
                          color: bar.canRedeem ? 'var(--brand-orange)' : 'var(--text-secondary)',
                          fontWeight: bar.canRedeem ? 700 : 400,
                          marginTop: 4, margin: 0,
                        }}>
                          {bar.canRedeem
                            ? 'Reward ready!'
                            : `${effective}/${bar.visitsRequired} — ${remaining} more for ${bar.rewardText ?? 'a free drink'}`
                          }
                        </p>
                      </div>
                      <div style={{ marginLeft: 12, flexShrink: 0 }}>
                        <MiniPunchDots filled={effective} total={bar.visitsRequired} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>

        {/* ── 7. MY COVERS (preserved) ─────────────────────── */}
        {myCovers.length > 0 && (
          <div style={{ padding: '20px 16px 0' }}>
            <SectionHeader
              icon={<Ticket size={16} strokeWidth={1.8} style={{ color: 'var(--brand-orange)' }} />}
              title="My Covers"
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myCovers.map(cover => (
                <button
                  key={cover.id}
                  onClick={() => setShowQR(showQR === cover.id ? null : cover.id)}
                  style={{
                    background: 'var(--bg-glass)',
                    border: '1px solid var(--brand-orange-tint)',
                    borderRadius: 12,
                    padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                    borderLeftWidth: 3,
                    borderLeftColor: cover.status === 'used' ? '#22C55E' : '#FF8200',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    WebkitTapHighlightColor: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px' }}>
                        {cover.venue_name}
                      </p>
                      <p style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                        {formatCoverPrice(cover.price_paid)} · {cover.status === 'used' ? 'Used' : 'Active'}
                      </p>
                    </div>
                    <span style={{ fontFamily: FONT, fontSize: 11, color: 'var(--brand-orange)', fontWeight: 600 }}>
                      {showQR === cover.id ? 'Hide' : 'Show QR'}
                    </span>
                  </div>
                  {showQR === cover.id && (
                    <div style={{
                      marginTop: 10, background: 'white', borderRadius: 10, padding: 14, textAlign: 'center',
                    }}>
                      <p style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#000', wordBreak: 'break-all', margin: 0 }}>
                        {cover.qr_code}
                      </p>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 8. MY TICKETS (preserved) ────────────────────── */}
        {myTickets.length > 0 && (
          <div style={{ padding: '20px 16px 0' }}>
            <SectionHeader
              icon={<Ticket size={16} strokeWidth={1.8} style={{ color: '#00D4FF' }} />}
              title="My Tickets"
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myTickets.map(ticket => {
                const isPast = new Date(ticket.event_start_time) < new Date();
                const start = new Date(ticket.event_start_time);
                const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                return (
                  <button
                    key={ticket.id}
                    onClick={() => setShowTicketQR(showTicketQR === ticket.id ? null : ticket.id)}
                    style={{
                      background: 'var(--bg-glass)',
                      border: '1px solid rgba(0, 212, 255, 0.18)',
                      borderRadius: 12,
                      padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                      borderLeftWidth: 3,
                      borderLeftColor: ticket.status === 'used' ? '#22C55E' : isPast ? '#55555F' : '#00D4FF',
                      opacity: isPast ? 0.65 : 1,
                      backdropFilter: 'blur(12px)',
                      WebkitBackdropFilter: 'blur(12px)',
                      WebkitTapHighlightColor: 'transparent',
                      color: 'inherit',
                      font: 'inherit',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontFamily: FONT, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
                          margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {ticket.event_title}
                        </p>
                        {ticket.venue_name && (
                          <p style={{ fontFamily: FONT, fontSize: 12, color: '#00D4FF', margin: '0 0 2px' }}>
                            {ticket.venue_name}
                          </p>
                        )}
                        <p style={{ fontFamily: FONT, fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                          {dateStr} at {timeStr} · {formatCoverPrice(ticket.price_paid)}
                          {ticket.status === 'used' ? ' · Used' : isPast ? ' · Past' : ' · Active'}
                        </p>
                      </div>
                      <span style={{ fontFamily: FONT, fontSize: 11, color: '#00D4FF', fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>
                        {showTicketQR === ticket.id ? 'Hide' : 'QR'}
                      </span>
                    </div>
                    {showTicketQR === ticket.id && (
                      <div style={{ marginTop: 10, background: 'white', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                        <p style={{ fontFamily: FONT, fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6 }}>
                          Show this at the door
                        </p>
                        <p style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#000', wordBreak: 'break-all', margin: 0 }}>
                          {ticket.qr_code}
                        </p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 9. MY VENUES (moments trophy case) ───────────────── */}
        <div style={{ padding: '20px 16px 0' }}>
          <SectionHeader
            icon={<span style={{ fontSize: 16, color: 'var(--brand-orange)' }}>{'✨'}</span>}
            title="My Venues"
            subtitle={
              momentsLoading
                ? 'loading…'
                : myMoments && myMoments.length > 0
                  ? `${myMoments.length} crowned`
                  : 'crown your first venue'
            }
          />
          <div style={{ padding: '12px 0 4px' }}>
            {momentsLoading ? (
              <div style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: 'rgba(255,255,255,0.3)',
                fontFamily: 'Satoshi, sans-serif',
                fontSize: '12px',
              }}>
                loading your venues…
              </div>
            ) : !myMoments || myMoments.length === 0 ? (
              <div style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: 'rgba(255,255,255,0.4)',
                fontFamily: 'Satoshi, sans-serif',
                fontSize: '13px',
              }}>
                <div style={{ marginBottom: 6 }}>
                  paint + capture a venue
                </div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  your moments will live here forever
                </div>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '14px',
                padding: '4px 4px 12px',
                justifyItems: 'center',
              }}>
                {myMoments.map(m => (
                  <MomentOrb
                    key={m.id}
                    moment={m}
                    size="profile"
                    onTap={() => setOpenMomentId(m.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── 10. SETTINGS ─────────────────────────────────── */}
        <div style={{ padding: '20px 16px 0' }}>
          <SectionHeader
            icon={<Bell size={16} strokeWidth={1.8} style={{ color: 'var(--brand-orange)' }} />}
            title="Settings"
          />
          <GlassCard style={{ padding: 0 }}>
            {/* Intro animation toggle */}
            <SettingsRow
              title="Show intro animation"
              hint="Cinematic globe-to-city open at every launch"
              right={<Switch checked={introEnabled} onChange={handleToggleIntro} />}
            />
            <SettingsRow
              title=""
              hint=""
              right={
                <button
                  type="button"
                  onClick={handleReplayIntro}
                  disabled={!introEnabled}
                  style={{
                    background: 'transparent', border: '1px solid var(--border-card)',
                    borderRadius: 10, padding: '8px 14px',
                    color: introEnabled ? 'var(--brand-orange)' : 'rgba(255,255,255,0.25)',
                    fontFamily: FONT, fontSize: 12, fontWeight: 600,
                    cursor: introEnabled ? 'pointer' : 'not-allowed',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  Replay intro
                </button>
              }
              hideTitleWhenEmpty
            />

            {/* Push notifications (native only) */}
            {Capacitor.isNativePlatform() && pushPermission !== 'unknown' && (
              <SettingsRow
                title="Push notifications"
                hint={pushPermission === 'granted' ? 'Enabled' : 'Disabled — tap to enable'}
                hintColor={pushPermission === 'granted' ? '#22C55E' : '#FF4444'}
                right={
                  pushPermission !== 'granted' && (
                    <button
                      type="button"
                      onClick={handleOpenNotificationSettings}
                      style={{
                        background: 'var(--brand-orange)', border: 'none',
                        borderRadius: 10, padding: '8px 14px',
                        color: 'white', fontFamily: FONT, fontSize: 12, fontWeight: 700,
                        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      Open settings
                    </button>
                  )
                }
              />
            )}

            {/* Privacy section */}
            <div style={{
              padding: '10px 16px 4px',
              borderTop: '1px solid var(--border-hairline)',
            }}>
              <span style={{
                fontFamily: FONT, fontSize: 11, fontWeight: 700,
                color: 'var(--text-muted)',
                letterSpacing: '0.08em', textTransform: 'uppercase',
              }}>
                Privacy
              </span>
            </div>
            <SettingsRow
              title="Show my recaps publicly"
              hint="Your recaps appear under each bar's recap feed"
              icon={<Heart size={14} strokeWidth={1.6} style={{ color: 'var(--text-secondary)' }} />}
              right={
                <Switch
                  checked={showRecaps}
                  onChange={() => {
                    const next = !showRecaps;
                    setShowRecaps(next);
                    void persistPrivacyToggle('show_recaps_publicly', next);
                  }}
                />
              }
            />
            <SettingsRow
              title="Show my visits to friends"
              hint="(Friends arrive in a later release)"
              icon={<MapPin size={14} strokeWidth={1.6} style={{ color: 'var(--text-secondary)' }} />}
              right={
                <Switch
                  checked={showVisits}
                  onChange={() => {
                    const next = !showVisits;
                    setShowVisits(next);
                    void persistPrivacyToggle('show_visits_publicly', next);
                  }}
                />
              }
            />
          </GlassCard>
        </div>

        {/* ── 11. ACCOUNT ──────────────────────────────────── */}
        <div style={{ padding: '24px 20px 0', textAlign: 'center' }}>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none',
              color: 'var(--text-muted)',
              fontFamily: FONT, fontSize: 14, fontWeight: 500,
              cursor: 'pointer', padding: '12px 24px', minHeight: 44,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <LogOut size={14} strokeWidth={1.5} />
            Sign Out
          </button>
        </div>

        <div style={{ padding: '12px 20px 24px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              width: '100%', maxWidth: 280, padding: '12px 20px',
              background: 'transparent', border: '1px solid #FF4444',
              borderRadius: 10, color: '#FF4444',
              fontFamily: FONT, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            Delete Account
          </button>
          <p style={{ fontFamily: FONT, fontSize: 11, color: 'var(--text-faded)', marginTop: 8, lineHeight: 1.4 }}>
            This will permanently delete your account and all associated data.
          </p>
        </div>
      </div>

      {/* ── Edit profile sheet ── */}
      <EditProfileSheet
        open={editOpen}
        profile={profile}
        onClose={() => setEditOpen(false)}
        onSaved={handleEditSaved}
      />

      {/* ── Delete confirmation ── */}
      {showDeleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            background: '#111118', borderRadius: 16, padding: '24px 20px',
            maxWidth: 320, width: '100%', textAlign: 'center',
          }}>
            <p style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: 'white', margin: '0 0 8px' }}>
              Delete Account?
            </p>
            <p style={{ fontFamily: FONT, fontSize: 13, color: '#888', margin: '0 0 24px', lineHeight: 1.5 }}>
              This will permanently delete your account, check-in history, and all associated data. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  flex: 1, height: 44, borderRadius: 10,
                  background: '#1C1C2E', border: 'none', color: 'white',
                  fontFamily: FONT, fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                style={{
                  flex: 1, height: 44, borderRadius: 10,
                  background: '#FF4444', border: 'none', color: 'white',
                  fontFamily: FONT, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <MomentFullScreen
        open={openMomentId !== null}
        moment={openMoment}
        onClose={() => setOpenMomentId(null)}
      />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function PlanMiniCard({ plan, onTap }: { plan: MyPlan; onTap: () => void }) {
  const stopsToShow = plan.stops.slice(0, 3);
  const totalCost = plan.totalEstimatedCost != null ? `~$${plan.totalEstimatedCost}` : null;
  const duration = plan.totalDurationMin != null
    ? `${Math.floor(plan.totalDurationMin / 60)}h${plan.totalDurationMin % 60 ? ` ${plan.totalDurationMin % 60}m` : ''}`
    : null;
  // Status pill colors aligned with the doctrine palette.
  const statusColor: Record<string, string> = {
    planned:    '#FF8200',  // brand orange
    active:     '#FFB050',  // active = orange-yellow
    completed:  '#00CC66',  // green for closed-out runs
    abandoned:  '#55555F',  // muted grey
  };
  const sc = statusColor[plan.status] ?? '#FF8200';
  // "ran [date]" subtitle for completed plans — falls back to created
  // when completed_at is missing (legacy rows pre-migration 00033).
  const completedLabel = (() => {
    if (plan.status !== 'completed') return null;
    const iso = plan.completedAt ?? plan.createdAt;
    if (!iso) return null;
    try {
      const d = new Date(iso);
      return `ran ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    } catch {
      return null;
    }
  })();
  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        flexShrink: 0,
        width: 240,
        padding: 14,
        borderRadius: 16,
        background: 'var(--bg-glass)',
        border: '1px solid var(--brand-orange-tint)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        scrollSnapAlign: 'start',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex', flexDirection: 'column', gap: 8,
        color: 'inherit', font: 'inherit',
      }}
    >
      <div style={{
        fontFamily: FONT, fontSize: 15, fontWeight: 700,
        color: 'var(--text-primary)', letterSpacing: '-0.01em',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {plan.title}
      </div>
      <div style={{
        fontFamily: FONT, fontSize: 11, color: 'var(--text-secondary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {[plan.city, totalCost, duration, completedLabel].filter(Boolean).join(' · ')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {stopsToShow.map((s, i) => (
          <div key={`${s.venue_id}-${i}`} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: FONT, fontSize: 12,
            color: 'rgba(255,255,255,0.78)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 3,
              background: '#FF8200', flexShrink: 0,
            }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.venue_name}
            </span>
          </div>
        ))}
      </div>
      <span style={{
        display: 'inline-flex', alignSelf: 'flex-start',
        padding: '3px 8px', borderRadius: 999,
        background: `${sc}22`, border: `1px solid ${sc}44`,
        color: sc, fontFamily: FONT, fontSize: 10, fontWeight: 700,
        letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
        {plan.status}
      </span>
    </button>
  );
}

function StampDot({ stamp, onTap }: { stamp: Stamp; onTap: () => void }) {
  const color = stampHexForCity(stamp.city);
  const letter = (stamp.venueName.trim()[0] ?? '?').toUpperCase();
  const visited = stamp.visited;
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${visited ? 'Open' : 'Discover'} ${stamp.venueName}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 4, background: 'transparent', border: 'none',
        padding: 0, cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {visited ? (
        <div style={{
          width: 64, height: 64, borderRadius: 32,
          background: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 14px ${color}55, inset 0 0 0 2px rgba(255,255,255,0.18)`,
        }}>
          <span style={{
            fontFamily: FONT, fontSize: 24, fontWeight: 800,
            color: 'white', letterSpacing: '-0.02em',
          }}>
            {letter}
          </span>
        </div>
      ) : (
        <div style={{
          width: 64, height: 64, borderRadius: 32,
          background: 'transparent',
          border: '1px dashed var(--text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontFamily: FONT, fontSize: 24, fontWeight: 800,
            color: 'var(--text-muted)',
            opacity: 0.4,
            letterSpacing: '-0.02em',
          }}>
            {letter}
          </span>
        </div>
      )}
      <span style={{
        fontFamily: FONT, fontSize: 10, fontWeight: 600,
        color: 'var(--text-secondary)',
        opacity: visited ? 1 : 0.4,
        textAlign: 'center',
        width: '100%',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {stamp.venueName}
      </span>
    </button>
  );
}

function EmptyState({
  icon: Icon, title, body, ctaLabel, onCta,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <GlassCard style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '24px 20px', textAlign: 'center',
    }}>
      <div className="profile-empty-glow" style={{
        width: 44, height: 44, borderRadius: 22,
        background: 'rgba(255, 130, 0, 0.08)',
        border: '1px solid var(--brand-orange-tint)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 12,
      }}>
        <Icon size={20} strokeWidth={1.6} style={{ color: 'var(--brand-orange)' }} />
      </div>
      <p style={{
        fontFamily: FONT, fontSize: 15, fontWeight: 700,
        color: 'var(--text-primary)', margin: '0 0 4px',
      }}>
        {title}
      </p>
      <p style={{
        fontFamily: FONT, fontSize: 12,
        color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.45,
        maxWidth: 300,
      }}>
        {body}
      </p>
      {ctaLabel && onCta && (
        <button
          type="button"
          onClick={onCta}
          style={{
            padding: '9px 16px',
            borderRadius: 999,
            background: 'var(--brand-orange)',
            border: 'none',
            color: 'white',
            fontFamily: FONT, fontSize: 13, fontWeight: 700,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
            letterSpacing: '-0.01em',
          }}
        >
          {ctaLabel}
        </button>
      )}
    </GlassCard>
  );
}

function SettingsRow({
  title, hint, hintColor, icon, right, hideTitleWhenEmpty,
}: {
  title: string;
  hint?: string;
  hintColor?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  hideTitleWhenEmpty?: boolean;
}) {
  if (hideTitleWhenEmpty && !title) {
    return (
      <div style={{
        padding: '0 16px 14px',
        display: 'flex', justifyContent: 'flex-end',
      }}>
        {right}
      </div>
    );
  }
  return (
    <div style={{
      padding: '14px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      borderBottom: '1px solid var(--border-hairline)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        {icon}
        <div style={{ minWidth: 0 }}>
          <p style={{
            fontFamily: FONT, fontSize: 14, fontWeight: 600,
            color: 'var(--text-primary)', margin: '0 0 2px',
            letterSpacing: '-0.01em',
          }}>
            {title}
          </p>
          {hint && (
            <p style={{
              fontFamily: FONT, fontSize: 12, margin: 0,
              color: hintColor ?? 'var(--text-secondary)',
              lineHeight: 1.35,
            }}>
              {hint}
            </p>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => { hapticLight(); onChange(); }}
      style={{
        width: 46, height: 28, borderRadius: 14,
        border: 'none',
        background: checked ? '#FF8200' : '#2A2A30',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 180ms var(--ease-out)',
        WebkitTapHighlightColor: 'transparent',
        flexShrink: 0, padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 21 : 3,
          width: 22, height: 22, borderRadius: 11,
          background: 'white',
          transition: 'left 180ms var(--ease-out)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
        }}
      />
    </button>
  );
}
