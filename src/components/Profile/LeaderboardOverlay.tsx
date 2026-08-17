import { useEffect, useState } from 'react';
import {
  X, Trophy, Crown, MapPin, Camera, Footprints, CalendarCheck,
  ChevronRight, ChevronLeft, Compass, Flame, TrendingUp, TrendingDown,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hapticLight } from '../../lib/haptics';

const FONT = 'Satoshi, sans-serif';

const CITY_TABS: Array<{ key: string; label: string }> = [
  { key: 'knoxville', label: 'Knoxville' },
  { key: 'tampa', label: 'Tampa' },
  { key: 'st_petersburg', label: 'St. Pete' },
];
const CITY_LABEL: Record<string, string> = { knoxville: 'Knoxville', tampa: 'Tampa', st_petersburg: 'St. Pete' };
const EXCLUDED_CATEGORIES = ['fraternity', 'frat', 'greek', 'sorority'];

function cityLabel(c: string): string { return CITY_LABEL[c] ?? c.replace(/_/g, ' '); }
function initialsOf(name: string): string { return (name || '?').slice(0, 2).toUpperCase(); }
function medalColor(rank: number): string {
  if (rank === 1) return '#FFD24A';
  if (rank === 2) return '#C7CBD1';
  if (rank === 3) return '#E08A4B';
  return 'var(--text-muted)';
}

// Small ▲/▼ movement chip used on the badge + hero.
function MovementChip({ delta, size = 11 }: { delta: number | null; size?: number }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: up ? '#37E1A0' : '#FF5E7A', fontFamily: FONT, fontSize: size, fontWeight: 800 }}>
      <Icon size={size + 1} strokeWidth={2.5} />{Math.abs(delta)}
    </span>
  );
}

// ── Glowing rainbow #X for the profile header — glistens like a trophy ──
export function RankBadge({ rank, excluded, delta, onTap }: {
  rank: number | null; totalRanked: number; excluded: boolean; delta?: number | null; onTap: () => void;
}) {
  if (excluded || rank == null) return null;
  return (
    <button type="button" onClick={onTap} aria-label="Open leaderboard"
      style={{ position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, background: 'transparent', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', padding: 0 }}>
      <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Rank</span>
      <span className="venuu-rank-number" style={{ fontFamily: FONT, fontSize: 30, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.03em' }}>#{rank.toLocaleString()}</span>
      <MovementChip delta={delta ?? null} size={10} />
    </button>
  );
}

interface GlobalRow { profile_id: string; username: string; display_name: string | null; home_city: string; avatar_color: string | null; venuu_score: number; global_rank: number; }
interface CityRow { profile_id: string; username: string; display_name: string | null; avatar_color: string | null; city_score: number; city_rank: number; city_total_ranked: number; venues_in_city: number; recaps_in_city: number; }
interface VenueRow { profile_id: string; username: string; display_name: string | null; avatar_color: string | null; venue_score: number; venue_rank: number; visit_count: number; recap_count: number; }
interface CityVenue { id: string; name: string; slug: string; image_url: string | null; }

interface Props {
  profileId: string; username: string; displayName: string; avatarColor: string;
  homeCity: string; myRank: number | null; myScore: number; totalRanked: number;
  delta?: number | null; excluded: boolean; onClose: () => void; onNavigateToVenue?: (venueId: string) => void;
}

function Avatar({ name, color, size = 34, ring }: { name: string; color: string | null; size?: number; ring?: string }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: color || '#FF8200', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontWeight: 800, fontSize: size * 0.38, color: 'white', boxShadow: ring ? `0 0 0 2px ${ring}, 0 0 12px ${ring}66` : undefined }}>{initialsOf(name)}</div>
  );
}

function RankRow({ rank, name, color, score, sub, isMe, crown }: { rank: number; name: string; color: string | null; score: number; sub?: string; isMe: boolean; crown?: boolean }) {
  const top3 = rank <= 3;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: top3 ? '11px 12px' : '9px 11px', borderRadius: 13, background: isMe ? 'var(--brand-orange-tint)' : top3 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.025)', border: `1px solid ${isMe ? 'var(--brand-orange-tint-strong)' : top3 ? 'rgba(255,210,74,0.22)' : 'var(--border-subtle)'}` }}>
      <span style={{ width: 26, textAlign: 'center', fontFamily: FONT, fontSize: top3 ? 17 : 14, fontWeight: 900, color: medalColor(rank), flexShrink: 0 }}>{rank}</span>
      <Avatar name={name} color={color} size={top3 ? 40 : 34} ring={top3 ? medalColor(rank) : undefined} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {crown && <Crown size={13} style={{ color: '#FFD24A', flexShrink: 0 }} />}
          <span style={{ fontFamily: FONT, fontSize: top3 ? 15 : 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}{isMe ? ' · you' : ''}</span>
        </div>
        {sub && <div style={{ fontFamily: FONT, fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
      </div>
      <span style={{ fontFamily: FONT, fontSize: top3 ? 15 : 13, fontWeight: 800, color: isMe ? 'var(--brand-orange)' : top3 ? '#FFE0B8' : 'var(--text-secondary)', flexShrink: 0 }}>{score.toLocaleString()}</span>
    </div>
  );
}

function SectionHeader({ icon: Icon, children, accent }: { icon: typeof Flame; children: React.ReactNode; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '20px 0 10px' }}>
      {accent && <span style={{ width: 3, height: 15, borderRadius: 2, background: 'var(--brand-orange)' }} />}
      <Icon size={14} style={{ color: 'var(--brand-orange)' }} />
      <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 800, letterSpacing: '0.13em', color: accent ? 'var(--text-primary)' : 'var(--text-muted)', textTransform: 'uppercase' }}>{children}</span>
    </div>
  );
}

export function LeaderboardOverlay({ profileId, myRank, myScore, totalRanked, delta, excluded, onClose, onNavigateToVenue }: Props) {
  const [tab, setTab] = useState<string>('global');
  const [globalRows, setGlobalRows] = useState<GlobalRow[]>([]);
  const [cityCache, setCityCache] = useState<Record<string, { leaders: CityRow[]; venues: CityVenue[] }>>({});
  const [myVenueRanks, setMyVenueRanks] = useState<Record<string, number>>({});
  const [selectedVenue, setSelectedVenue] = useState<CityVenue | null>(null);
  const [venueRows, setVenueRows] = useState<VenueRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [g, mvr] = await Promise.all([
        supabase.from('user_venuu_rank').select('profile_id,username,display_name,home_city,avatar_color,venuu_score,global_rank').order('global_rank', { ascending: true }).limit(25),
        supabase.from('venue_leaderboard').select('venue_id,venue_rank').eq('profile_id', profileId),
      ]);
      if (!alive) return;
      setGlobalRows((g.data ?? []) as GlobalRow[]);
      const m: Record<string, number> = {};
      for (const r of (mvr.data ?? []) as Array<{ venue_id: string; venue_rank: number }>) m[r.venue_id] = r.venue_rank;
      setMyVenueRanks(m);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [profileId]);

  useEffect(() => {
    if (tab === 'global' || cityCache[tab]) return;
    let alive = true;
    (async () => {
      const [leaders, venues] = await Promise.all([
        supabase.from('city_leaderboard').select('profile_id,username,display_name,avatar_color,city_score,city_rank,city_total_ranked,venues_in_city,recaps_in_city').eq('city', tab).order('city_rank', { ascending: true }).limit(25),
        supabase.from('venues').select('id,name,slug,image_url,category').eq('city', tab).eq('is_active', true).order('name', { ascending: true }),
      ]);
      if (!alive) return;
      const vrows = ((venues.data ?? []) as Array<CityVenue & { category: string | null }>)
        .filter(v => !EXCLUDED_CATEGORIES.includes((v.category ?? '').toLowerCase()))
        .map(({ id, name, slug, image_url }) => ({ id, name, slug, image_url }));
      setCityCache(prev => ({ ...prev, [tab]: { leaders: (leaders.data ?? []) as CityRow[], venues: vrows } }));
    })();
    return () => { alive = false; };
  }, [tab, cityCache]);

  useEffect(() => {
    if (!selectedVenue) { setVenueRows([]); return; }
    let alive = true;
    (async () => {
      const v = await supabase.from('venue_leaderboard').select('profile_id,username,display_name,avatar_color,venue_score,venue_rank,visit_count,recap_count').eq('venue_id', selectedVenue.id).order('venue_rank', { ascending: true }).limit(50);
      if (!alive) return;
      setVenueRows((v.data ?? []) as VenueRow[]);
    })();
    return () => { alive = false; };
  }, [selectedVenue]);

  const isCity = tab !== 'global';
  const cityData = isCity ? cityCache[tab] : undefined;
  const cityLeaders = cityData?.leaders ?? [];
  const cityVenues = cityData?.venues ?? [];
  const myCityRow = cityLeaders.find(r => r.profile_id === profileId);
  const discoveredInCity = cityVenues.filter(v => myVenueRanks[v.id] != null).length;
  const ownedCount = cityVenues.filter(v => myVenueRanks[v.id] === 1).length;

  let heroRank: number | null = null, heroTotal = 0, heroScore = 0, heroLabel = 'Your venuu rank';
  if (isCity) {
    heroLabel = `Your ${cityLabel(tab)} rank`;
    heroRank = myCityRow ? myCityRow.city_rank : null;
    heroTotal = myCityRow ? myCityRow.city_total_ranked : (cityLeaders.length || 0);
    heroScore = myCityRow ? myCityRow.city_score : 0;
  } else {
    heroRank = myRank; heroTotal = totalRanked; heroScore = myScore;
  }

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5,5,7,0.74)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 'auto', maxHeight: '93vh', background: 'linear-gradient(180deg, #0E0E14 0%, #08080C 100%)', borderRadius: '22px 22px 0 0', border: '1px solid var(--border-subtle)', borderBottom: 'none', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{ position: 'relative', padding: '12px 16px 4px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-subtle)', margin: '0 auto 10px' }} />
          <button type="button" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 10, right: 14, width: 32, height: 32, borderRadius: 16, background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={17} /></button>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <Trophy size={16} style={{ color: 'var(--brand-orange)' }} />
            <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Leaderboard</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '8px 16px 0', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {[{ key: 'global', label: 'Global' }, ...CITY_TABS].map((t) => {
            const active = tab === t.key;
            return (
              <button key={t.key} type="button" onClick={() => { hapticLight(); setTab(t.key); setSelectedVenue(null); }} style={{ flex: '0 0 auto', padding: '9px 16px', borderRadius: 11, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em', border: '1px solid', WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap', borderColor: active ? 'var(--brand-orange-tint-strong)' : 'var(--border-subtle)', background: active ? 'var(--brand-orange-tint)' : 'rgba(255,255,255,0.03)', color: active ? 'var(--brand-orange)' : 'var(--text-secondary)' }}>{t.label}</button>
            );
          })}
        </div>

        <div style={{ overflowY: 'auto', padding: '14px 16px 28px', flex: 1 }}>
          <div style={{ textAlign: 'center', padding: '14px 0 16px', borderBottom: '1px solid var(--border-subtle)' }}>
            {excluded ? (
              <>
                <Crown size={26} style={{ color: '#FFD24A', marginBottom: 6 }} />
                <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>You're the host</div>
                <div style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Hidden · {totalRanked.toLocaleString()} ranked</div>
              </>
            ) : heroRank != null ? (
              <>
                <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{heroLabel}</div>
                <div className="venuu-rank-number" style={{ fontFamily: FONT, fontSize: 52, fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.03em', marginTop: 2 }}>#{heroRank.toLocaleString()}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-secondary)' }}>of {heroTotal.toLocaleString()} · {heroScore.toLocaleString()} pts</span>
                  {!isCity && <MovementChip delta={delta ?? null} size={12} />}
                </div>
              </>
            ) : (
              <>
                <Compass size={24} style={{ color: 'var(--brand-orange)', marginBottom: 6 }} />
                <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{isCity ? `Not ranked in ${cityLabel(tab)} yet` : 'Get on the board'}</div>
                <div style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Discover a venue or capture a photo here</div>
              </>
            )}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>Loading…</div>
          ) : !isCity ? (
            <>
              <SectionHeader icon={Trophy} accent>Top 10 · Global</SectionHeader>
              {globalRows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>No one ranked yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {globalRows.slice(0, 10).map((r) => (
                    <RankRow key={r.profile_id} rank={r.global_rank} name={r.display_name || r.username} color={r.avatar_color} score={r.venuu_score} sub={cityLabel(r.home_city)} isMe={r.profile_id === profileId} crown={r.global_rank === 1} />
                  ))}
                </div>
              )}
              <ClimbStrip />
            </>
          ) : selectedVenue ? (
            <VenueBoard venue={selectedVenue} rows={venueRows} meId={profileId} onBack={() => setSelectedVenue(null)} onNavigateToVenue={onNavigateToVenue} />
          ) : (
            <>
              {ownedCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', margin: '4px 0 2px', borderRadius: 13, border: '1px solid rgba(255,210,74,0.35)', background: 'linear-gradient(135deg, rgba(255,210,74,0.14), rgba(255,130,0,0.04))' }}>
                  <Crown size={20} style={{ color: '#FFD24A', flexShrink: 0 }} />
                  <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 800, color: '#FFE0B8' }}>You own {ownedCount} {ownedCount === 1 ? 'bar' : 'bars'} in {cityLabel(tab)}</span>
                </div>
              )}

              <SectionHeader icon={Flame} accent>Your rank at each venue</SectionHeader>
              {cityVenues.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>No venues yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {cityVenues.map((v) => {
                    const myV = myVenueRanks[v.id];
                    const owns = myV === 1;
                    return (
                      <button key={v.id} type="button" onClick={() => { hapticLight(); setSelectedVenue(v); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 11px 8px 8px', borderRadius: 13, cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent', background: owns ? 'linear-gradient(135deg, rgba(255,210,74,0.12), rgba(255,130,0,0.04))' : myV != null ? 'var(--brand-orange-tint)' : 'rgba(255,255,255,0.03)', border: `1px solid ${owns ? 'rgba(255,210,74,0.4)' : myV != null ? 'var(--brand-orange-tint-strong)' : 'var(--border-subtle)'}` }}>
                        <div style={{ width: 46, height: 46, borderRadius: 10, flexShrink: 0, overflow: 'hidden', background: '#1A1A22', backgroundImage: v.image_url ? `url(${v.image_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center 35%' }} />
                        <span style={{ flex: 1, minWidth: 0, fontFamily: FONT, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</span>
                        {owns ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT, fontSize: 12, fontWeight: 800, color: '#FFD24A', flexShrink: 0 }}><Crown size={14} /> You own this</span>
                        ) : myV != null ? (
                          <span className={myV <= 3 ? 'venuu-rank-number' : undefined} style={{ fontFamily: FONT, fontSize: 20, fontWeight: 900, color: myV <= 3 ? undefined : 'var(--brand-orange)', flexShrink: 0, letterSpacing: '-0.02em' }}>#{myV}</span>
                        ) : (
                          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>claim it</span>
                        )}
                        <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ margin: '18px 0 4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Discovered in {cityLabel(tab)}</span>
                  <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 800, color: 'var(--brand-orange)' }}>{discoveredInCity}/{cityVenues.length}</span>
                </div>
                <div style={{ height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 4, width: `${cityVenues.length ? Math.round((discoveredInCity / cityVenues.length) * 100) : 0}%`, background: 'linear-gradient(90deg, #FF8200, #FFD24A)' }} />
                </div>
              </div>

              <SectionHeader icon={Crown}>Top 10 · {cityLabel(tab)}</SectionHeader>
              {cityLeaders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>No one ranked here yet — be the first.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {cityLeaders.slice(0, 10).map((r) => (
                    <RankRow key={r.profile_id} rank={r.city_rank} name={r.display_name || r.username} color={r.avatar_color} score={r.city_score} sub={`${r.venues_in_city} venues`} isMe={r.profile_id === profileId} crown={r.city_rank === 1} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ClimbStrip() {
  const items = [
    { icon: MapPin, label: 'Discover a venue', pts: '+100', hint: "can't be faked" },
    { icon: Camera, label: 'Capture a photo', pts: '+60', hint: "can't be faked" },
    { icon: Footprints, label: 'Night out', pts: '+50', hint: 'per night' },
    { icon: CalendarCheck, label: 'Complete a plan', pts: '+40', hint: 'finish a run' },
  ];
  return (
    <>
      <SectionHeader icon={Flame}>How to climb</SectionHeader>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 11px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)' }}>
              <Icon size={16} style={{ color: 'var(--brand-orange)', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
                <div style={{ fontFamily: FONT, fontSize: 10, color: 'var(--text-muted)' }}><span style={{ color: 'var(--brand-orange)', fontWeight: 800 }}>{it.pts}</span> · {it.hint}</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function VenueBoard({ venue, rows, meId, onBack, onNavigateToVenue }: { venue: CityVenue; rows: VenueRow[]; meId: string; onBack: () => void; onNavigateToVenue?: (venueId: string) => void }) {
  const iOwn = rows.find(r => r.profile_id === meId)?.venue_rank === 1;
  return (
    <div>
      <button type="button" onClick={() => { hapticLight(); onBack(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '4px 0 12px', WebkitTapHighlightColor: 'transparent' }}><ChevronLeft size={16} /> All venues</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, flexShrink: 0, overflow: 'hidden', background: '#1A1A22', backgroundImage: venue.image_url ? `url(${venue.image_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center 35%' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{venue.name}</div>
          <div style={{ fontFamily: FONT, fontSize: 11, color: iOwn ? '#FFD24A' : 'var(--text-muted)', fontWeight: iOwn ? 800 : 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{iOwn && <Crown size={12} />}{iOwn ? 'You own this bar' : 'Who owns this bar'}</div>
        </div>
        {onNavigateToVenue && (
          <button type="button" onClick={() => { hapticLight(); onNavigateToVenue(venue.id); }} style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: 'var(--brand-orange)', background: 'var(--brand-orange-tint)', border: 'none', borderRadius: 999, padding: '6px 12px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', flexShrink: 0 }}>View</button>
        )}
      </div>
      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '10px 0 14px' }} />
      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>No regulars yet — be the first to own it.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map((r) => (
            <RankRow key={r.profile_id} rank={r.venue_rank} name={r.display_name || r.username} color={r.avatar_color} score={r.venue_score} sub={`${r.visit_count} visits · ${r.recap_count} photos`} isMe={r.profile_id === meId} crown={r.venue_rank === 1} />
          ))}
        </div>
      )}
    </div>
  );
}
