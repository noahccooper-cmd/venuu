import { useState, useEffect } from 'react';
import { ArrowLeft, LogOut, MapPin, Beer, Star, Ticket, Bell } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Browser } from '@capacitor/browser';
import { CITIES, type CityKey } from '../../lib/constants';
import { useVisitHistory } from '../../hooks/useVisitHistory';
import { useMyRecaps } from '../../hooks/useMyRecaps';
import { timeAgo } from '../../lib/utils';
import { formatCoverPrice } from '../../lib/coverPricing';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../lib/types';

interface ProfileScreenProps {
  profile: Profile;
  onClose: () => void;
  onSignOut: () => Promise<void>;
  onNavigateToVenue?: (venueId: string) => void;
}

const FONT = 'Satoshi, sans-serif';

function formatMemberSince(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getCityLabel(cityKey: string): string {
  const config = CITIES[cityKey as CityKey];
  if (config) return `${config.name}, ${config.state}`;
  return cityKey;
}

/* ── Mini punch card dots ── */
function MiniPunchDots({ filled, total }: { filled: number; total: number }) {
  const dots = [];
  for (let i = 0; i < total; i++) {
    const isFilled = i < filled;
    dots.push(
      <div
        key={i}
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: isFilled ? '#FF8200' : 'rgba(255,255,255,0.08)',
          border: isFilled ? '1.5px solid #FF8200' : '1.5px solid rgba(255,255,255,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 8,
          color: 'white',
        }}
      >
        {isFilled ? '\u2713' : ''}
      </div>
    );
  }
  return <div style={{ display: 'flex', gap: 3 }}>{dots}</div>;
}

/* ── Stat card ── */
function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: '#111114',
        border: '1px solid #2A2A30',
        borderRadius: 12,
        padding: '16px 8px',
        textAlign: 'center',
      }}
    >
      <p style={{ fontFamily: FONT, fontSize: 26, fontWeight: 800, color: '#FF8200', lineHeight: 1 }}>
        {value}
      </p>
      <p style={{ fontFamily: FONT, fontSize: 11, color: '#8A8A95', marginTop: 6, lineHeight: 1.2 }}>
        {label}
      </p>
    </div>
  );
}

export function ProfileScreen({ profile, onClose, onSignOut, onNavigateToVenue }: ProfileScreenProps) {
  const [closing, setClosing] = useState(false);

  const { totalVisits, uniqueVenues, totalRewards, bars, loading } = useVisitHistory(profile.auth_id);
  const { recaps: myRecaps, loading: recapsLoading } = useMyRecaps(profile.username);
  const [showAllRecaps, setShowAllRecaps] = useState(false);

  // My Covers — tonight's purchased covers
  const [myCovers, setMyCovers] = useState<{ id: string; venue_name: string; price_paid: number; qr_code: string; status: string; purchased_at: string }[]>([]);
  const [showQR, setShowQR] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.auth_id) return;
    const load = async () => {
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
    };
    load();
  }, [profile.auth_id]);

  // My Tickets — upcoming and past event tickets
  const [myTickets, setMyTickets] = useState<{
    id: string;
    qr_code: string;
    status: string;
    price_paid: number;
    purchased_at: string;
    event_title: string;
    event_start_time: string;
    event_end_time: string | null;
    venue_name: string | null;
  }[]>([]);
  const [showTicketQR, setShowTicketQR] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.auth_id) return;
    const load = async () => {
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
    };
    load();
  }, [profile.auth_id]);

  // Push notification permission status (native only)
  const [pushPermission, setPushPermission] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    PushNotifications.checkPermissions().then(result => {
      setPushPermission(result.receive as 'granted' | 'denied' | 'prompt');
    }).catch(() => setPushPermission('unknown'));
  }, []);

  const handleOpenNotificationSettings = async () => {
    try {
      await Browser.open({ url: 'app-settings:' });
    } catch {
      // fallback — iOS will handle the scheme even without Browser plugin
      window.location.href = 'app-settings:';
    }
  };

  const displayName = profile.display_name || profile.username;

  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 280);
  };

  const handleSignOut = async () => {
    await onSignOut();
    onClose();
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      // Delete user data via RPC (runs as SECURITY DEFINER)
      await supabase.rpc('delete_user_account');
    } catch {
      // RPC may not exist yet — delete what we can client-side
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
    if (onNavigateToVenue) {
      onNavigateToVenue(venueId);
    }
    handleClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: '#050507',
        display: 'flex',
        flexDirection: 'column',
        animation: closing
          ? 'profile-slide-down 0.28s ease-in forwards'
          : 'profile-slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1) forwards',
      }}
    >
      {/* ── Header bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          background: '#050507',
          borderBottom: '1px solid #1a1a1e',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={handleClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            color: '#8A8A95',
            fontFamily: FONT,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            padding: '8px 4px',
            minHeight: 44,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <ArrowLeft size={18} strokeWidth={1.5} />
          Back
        </button>
        <p style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: 'white' }}>
          Profile
        </p>
        {/* Spacer to keep title centered */}
        <div style={{ width: 60 }} />
      </div>

      {/* ── Scrollable content ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        {/* ── User card ── */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 20px 20px' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#FF8200',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <span style={{ fontFamily: FONT, fontSize: 24, fontWeight: 800, color: 'white' }}>
              {displayName.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <p style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, color: 'white', marginBottom: 4 }}>
            {displayName}
          </p>
          <p style={{ fontFamily: FONT, fontSize: 14, color: '#8A8A95', marginBottom: 2 }}>
            {getCityLabel(profile.city)}
          </p>
          <p style={{ fontFamily: FONT, fontSize: 12, color: '#55555F' }}>
            Member since {formatMemberSince(profile.created_at)}
          </p>
        </div>

        {/* ── Stats row ── */}
        <div style={{ display: 'flex', gap: 10, padding: '0 20px', marginBottom: 24 }}>
          <StatCard value={totalVisits} label="Total Visits" />
          <StatCard value={uniqueVenues} label="Bars Visited" />
          <StatCard value={totalRewards} label="Rewards Earned" />
        </div>

        {/* ── My Bars ── */}
        <div style={{ padding: '0 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Beer size={16} strokeWidth={1.5} style={{ color: '#FF8200' }} />
            <h3 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: 'white' }}>
              My Bars
            </h3>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <div className="w-6 h-6 border-2 border-[#FF8200] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : bars.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '40px 20px',
                textAlign: 'center',
              }}
            >
              <MapPin size={32} strokeWidth={1} style={{ color: '#2A2A30', marginBottom: 12 }} />
              <p style={{ fontFamily: FONT, fontSize: 14, color: '#55555F', lineHeight: 1.5 }}>
                Check in at your first bar to start tracking!
              </p>
            </div>
          ) : (
            <div style={{ borderRadius: 14, overflow: 'hidden' }}>
              {bars.map((bar, idx) => {
                const effective = bar.visitCount % bar.visitsRequired || (bar.canRedeem ? bar.visitsRequired : 0);
                const remaining = bar.visitsRequired - effective;
                return (
                  <button
                    type="button"
                    key={bar.venueId}
                    onClick={() => handleBarTap(bar.venueId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '14px 16px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: idx < bars.length - 1 ? '1px solid #1a1a1e' : 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {/* Left: venue info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontFamily: FONT,
                        fontSize: 15,
                        fontWeight: 700,
                        color: 'white',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {bar.venueName}
                      </p>
                      <p style={{ fontFamily: FONT, fontSize: 12, color: '#55555F', marginTop: 2 }}>
                        {bar.venueCity || 'Unknown'}
                      </p>
                      <p style={{
                        fontFamily: FONT,
                        fontSize: 11,
                        color: bar.canRedeem ? '#FF8200' : '#8A8A95',
                        fontWeight: bar.canRedeem ? 700 : 400,
                        marginTop: 4,
                      }}>
                        {bar.canRedeem
                          ? 'Reward ready!'
                          : `${effective}/${bar.visitsRequired} — ${remaining} more for ${bar.rewardText ?? 'a free drink'}`
                        }
                      </p>
                    </div>

                    {/* Right: punch dots */}
                    <div style={{ marginLeft: 12, flexShrink: 0 }}>
                      <MiniPunchDots filled={effective} total={bar.visitsRequired} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── My Covers ── */}
        {myCovers.length > 0 && (
          <div style={{ padding: '24px 20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Ticket size={16} strokeWidth={1.5} style={{ color: '#FF8200' }} />
              <h3 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: 'white' }}>
                My Covers
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myCovers.map(cover => (
                <button
                  key={cover.id}
                  onClick={() => setShowQR(showQR === cover.id ? null : cover.id)}
                  style={{
                    background: '#111114', border: '1px solid #2A2A30', borderRadius: 12,
                    padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                    borderLeftWidth: 3, borderLeftColor: cover.status === 'used' ? '#22C55E' : '#FF8200',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: 'white', margin: '0 0 2px' }}>
                        {cover.venue_name}
                      </p>
                      <p style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95', margin: 0 }}>
                        {formatCoverPrice(cover.price_paid)} &middot; {cover.status === 'used' ? 'Used' : 'Active'}
                      </p>
                    </div>
                    <span style={{ fontFamily: FONT, fontSize: 11, color: '#FF8200', fontWeight: 600 }}>
                      {showQR === cover.id ? 'Hide' : 'Show QR'}
                    </span>
                  </div>
                  {showQR === cover.id && (
                    <div style={{
                      marginTop: 10, background: 'white', borderRadius: 10, padding: '14px',
                      textAlign: 'center',
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

        {/* ── My Tickets ── */}
        {myTickets.length > 0 && (
          <div style={{ padding: '24px 20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Ticket size={16} strokeWidth={1.5} style={{ color: '#00D4FF' }} />
              <h3 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: 'white' }}>
                My Tickets
              </h3>
            </div>
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
                      background: '#111114',
                      border: '1px solid #2A2A30',
                      borderRadius: 12,
                      padding: '12px 14px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderLeftWidth: 3,
                      borderLeftColor: ticket.status === 'used' ? '#22C55E' : isPast ? '#55555F' : '#00D4FF',
                      opacity: isPast ? 0.65 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontFamily: FONT, fontSize: 14, fontWeight: 700, color: 'white',
                          margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {ticket.event_title}
                        </p>
                        {ticket.venue_name && (
                          <p style={{ fontFamily: FONT, fontSize: 12, color: '#00D4FF', margin: '0 0 2px' }}>
                            {ticket.venue_name}
                          </p>
                        )}
                        <p style={{ fontFamily: FONT, fontSize: 11, color: '#55555F', margin: 0 }}>
                          {dateStr} at {timeStr} · {formatCoverPrice(ticket.price_paid)}
                          {ticket.status === 'used' ? ' · Used' : isPast ? ' · Past' : ' · Active'}
                        </p>
                      </div>
                      <span style={{ fontFamily: FONT, fontSize: 11, color: '#00D4FF', fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>
                        {showTicketQR === ticket.id ? 'Hide' : 'QR'}
                      </span>
                    </div>
                    {showTicketQR === ticket.id && (
                      <div style={{
                        marginTop: 10, background: 'white', borderRadius: 10,
                        padding: '14px', textAlign: 'center',
                      }}>
                        <p style={{ fontFamily: FONT, fontSize: 10, color: '#8A8A95', marginBottom: 6 }}>
                          Show this at the door
                        </p>
                        <p style={{
                          fontFamily: 'monospace', fontSize: 13, fontWeight: 700,
                          color: '#000', wordBreak: 'break-all', margin: 0,
                        }}>
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

        {/* ── My Recaps ── */}
        <div style={{ padding: '24px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Star size={16} strokeWidth={1.5} style={{ color: '#FF8200' }} />
            <h3 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: 'white' }}>
              My Recaps
            </h3>
          </div>

          {recapsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <div className="w-6 h-6 border-2 border-[#FF8200] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : myRecaps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <p style={{ fontFamily: FONT, fontSize: 14, color: '#55555F', lineHeight: 1.5 }}>
                Leave your first recap at any bar!
              </p>
            </div>
          ) : (
            <div style={{ borderRadius: 14, overflow: 'hidden' }}>
              {(showAllRecaps ? myRecaps : myRecaps.slice(0, 10)).map((recap, idx, arr) => (
                <div
                  key={recap.id}
                  style={{
                    padding: '12px 16px',
                    borderBottom: idx < arr.length - 1 ? '1px solid #1a1a1e' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <p style={{
                      fontFamily: FONT,
                      fontSize: 14,
                      fontWeight: 700,
                      color: 'white',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                    }}>
                      {recap.venue_name}
                    </p>
                    <span style={{ fontFamily: FONT, fontSize: 11, color: '#55555F', marginLeft: 8, flexShrink: 0 }}>
                      {timeAgo(recap.created_at)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 4 }}>
                    {[1, 2, 3, 4, 5].map(s => (
                      <span key={s} style={{ fontSize: 12, color: s <= recap.stars ? '#FF8200' : '#2A2A30' }}>
                        {'\u2605'}
                      </span>
                    ))}
                  </div>
                  <p style={{
                    fontFamily: FONT,
                    fontSize: 13,
                    color: '#8A8A95',
                    lineHeight: 1.4,
                    margin: 0,
                  }}>
                    {recap.body}
                  </p>
                </div>
              ))}
              {myRecaps.length > 10 && !showAllRecaps && (
                <button
                  type="button"
                  onClick={() => setShowAllRecaps(true)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'transparent',
                    border: 'none',
                    color: '#FF8200',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: FONT,
                    cursor: 'pointer',
                    borderTop: '1px solid #1a1a1e',
                  }}
                >
                  Show more recaps
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Notifications ── */}
        {Capacitor.isNativePlatform() && pushPermission !== 'unknown' && (
          <div style={{ padding: '24px 20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Bell size={16} strokeWidth={1.5} style={{ color: '#FF8200' }} />
              <h3 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: 'white' }}>
                Notifications
              </h3>
            </div>
            <div style={{
              background: '#111114',
              border: '1px solid #2A2A30',
              borderRadius: 12,
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <p style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: 'white', margin: '0 0 2px' }}>
                  Push Notifications
                </p>
                <p style={{
                  fontFamily: FONT, fontSize: 12, margin: 0,
                  color: pushPermission === 'granted' ? '#22C55E' : '#FF4444',
                  fontWeight: 500,
                }}>
                  {pushPermission === 'granted' ? 'Enabled' : 'Disabled — tap to enable'}
                </p>
              </div>
              {pushPermission !== 'granted' && (
                <button
                  type="button"
                  onClick={handleOpenNotificationSettings}
                  style={{
                    background: '#FF8200',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 14px',
                    fontFamily: FONT,
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'white',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    flexShrink: 0,
                    marginLeft: 12,
                  }}
                >
                  Settings
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Sign Out ── */}
        <div style={{ padding: '32px 20px 0', textAlign: 'center' }}>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              color: '#55555F',
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              padding: '12px 24px',
              minHeight: 44,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <LogOut size={14} strokeWidth={1.5} />
            Sign Out
          </button>
        </div>

        {/* ── Delete Account ── */}
        <div style={{ padding: '32px 20px 40px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              width: '100%',
              maxWidth: 280,
              padding: '12px 20px',
              background: 'transparent',
              border: '1px solid #FF4444',
              borderRadius: 8,
              color: '#FF4444',
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Delete Account
          </button>
          <p style={{ fontFamily: FONT, fontSize: 11, color: '#444', marginTop: 8, lineHeight: 1.4 }}>
            This will permanently delete your account and all associated data.
          </p>
        </div>

        {/* Delete confirmation overlay */}
        {showDeleteConfirm && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes profile-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes profile-slide-down {
          from { transform: translateY(0); }
          to { transform: translateY(100%); }
        }
      `}</style>
    </div>
  );
}
