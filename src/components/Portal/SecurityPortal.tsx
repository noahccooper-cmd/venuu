import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { supabase, envReady } from '../../lib/supabase';
import { getNightOf } from '../../lib/utils';
import { hapticLight } from '../../lib/haptics';
import { formatCoverPriceShort, formatCoverPrice } from '../../lib/coverPricing';
import { ClickerView } from './ClickerView';
import { FratPortal } from './FratPortal';
import type { Venue, Headcount, SecurityOrganization } from '../../lib/types';
import type { EndNightSummary } from '../../hooks/usePortal';

const FONT = 'Satoshi, sans-serif';
const MONO = "'SF Mono', Menlo, 'Courier New', monospace";
const GOLD = '#C9A96E';

interface HeadcountInfo {
  count: number;
  isLive: boolean;
  updatedAt: string;
  peak: number;
}

interface SecurityPortalProps {
  org: SecurityOrganization;
  onDisconnect: () => void;
}

export function SecurityPortal({ org, onDisconnect }: SecurityPortalProps) {
  // Core data
  const [venues, setVenues] = useState<Venue[]>([]);
  const [headcounts, setHeadcounts] = useState<Map<string, HeadcountInfo>>(new Map());
  const [coverData, setCoverData] = useState<Map<string, { currentPrice: number; coversSold: number; capacity: number }>>(new Map());
  const [eventData, setEventData] = useState<Map<string, { title: string }>>(new Map());
  const [revenueData, setRevenueData] = useState<Map<string, number>>(new Map());

  // Navigation state — ONE clear state machine
  type Step = 'loading' | 'welcome' | 'select' | 'done' | 'dashboard';
  const [step, setStep] = useState<Step>('loading');

  // Selected venue drill-down
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [selectedHC, setSelectedHC] = useState<Headcount | null>(null);
  const [endSummary, setEndSummary] = useState<EndNightSummary | null>(null);

  // Onboarding
  const [availableVenues, setAvailableVenues] = useState<Venue[]>([]);
  const [selectedVenueIds, setSelectedVenueIds] = useState<Set<string>>(new Set());
  const [savingVenues, setSavingVenues] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [dashFilter, setDashFilter] = useState<'all' | 'live' | 'bars' | 'greek'>('all');
  const [expandedVenueId, setExpandedVenueId] = useState<string | null>(null);
  const [clock, setClock] = useState(new Date().toLocaleTimeString('en-US', { hour12: false }));

  const nightOf = getNightOf();

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toLocaleTimeString('en-US', { hour12: false })), 1000);
    return () => clearInterval(id);
  }, []);

  console.debug('[security] Mount: org.id =', org.id, 'org.name =', org.name);

  // ── Load venues + headcounts ──
  const loadData = useCallback(async () => {
    if (!envReady) return;
    console.debug('[security] loadData() called for org:', org.id);

    // 1. Get linked venue IDs
    const { data: links, error: linksErr } = await supabase
      .from('organization_venues')
      .select('venue_id')
      .eq('org_id', org.id);

    if (linksErr) console.warn('[security] Links query error:', linksErr.message);
    const linkedIds = (links ?? []).map((l: { venue_id: string }) => l.venue_id);
    console.debug('[security] Linked venue IDs:', linkedIds.length, linkedIds);

    if (linkedIds.length === 0) {
      console.debug('[security] No venues linked — setting step to welcome');
      setStep('welcome');
      return;
    }
    // 2. Fetch venue details
    const { data: venueData } = await supabase
      .from('venues')
      .select('*')
      .in('id', linkedIds)
      .order('name');

    if (venueData) setVenues(venueData as Venue[]);

    // 3. Fetch tonight's headcounts
    const { data: hcData } = await supabase
      .from('headcounts')
      .select('*')
      .in('venue_id', linkedIds)
      .eq('night_of', nightOf);

    if (hcData) {
      const map = new Map<string, HeadcountInfo>();
      for (const hc of hcData as Headcount[]) {
        map.set(hc.venue_id, {
          count: hc.current_count,
          isLive: hc.is_live,
          updatedAt: hc.updated_at,
          peak: hc.peak_count,
        });
      }
      setHeadcounts(map);
    }

    // 4. Fetch covers, events, revenue in parallel
    const [coverRes, eventRes, revRes] = await Promise.all([
      supabase.from('cover_configs').select('venue_id, current_price, covers_sold, capacity').in('venue_id', linkedIds).eq('night_of', nightOf).eq('is_active', true),
      supabase.from('events').select('venue_id, title').in('venue_id', linkedIds).eq('is_active', true).gt('expires_at', new Date().toISOString()),
      supabase.from('cover_purchases').select('venue_id, venue_payout').in('venue_id', linkedIds).in('status', ['completed', 'used']),
    ]);

    if (coverRes.data) {
      const m = new Map<string, { currentPrice: number; coversSold: number; capacity: number }>();
      for (const c of coverRes.data as { venue_id: string; current_price: number; covers_sold: number; capacity: number }[]) {
        m.set(c.venue_id, { currentPrice: c.current_price, coversSold: c.covers_sold, capacity: c.capacity });
      }
      setCoverData(m);
    }
    if (eventRes.data) {
      const m = new Map<string, { title: string }>();
      for (const e of eventRes.data as { venue_id: string; title: string }[]) {
        if (e.venue_id) m.set(e.venue_id, { title: e.title });
      }
      setEventData(m);
    }
    if (revRes.data) {
      const m = new Map<string, number>();
      for (const p of revRes.data as { venue_id: string; venue_payout: number }[]) {
        m.set(p.venue_id, (m.get(p.venue_id) ?? 0) + p.venue_payout);
      }
      setRevenueData(m);
    }

    console.debug('[security] Setting step to dashboard, loaded', venueData?.length ?? 0, 'venues');
    setStep('dashboard');
  }, [org.id, nightOf]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Realtime headcount subscription ──
  useEffect(() => {
    if (!envReady || venues.length === 0) return;
    const venueIds = venues.map(v => v.id);

    const channel = supabase
      .channel(`sec-hc-${org.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'headcounts' },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const row = payload.new as Headcount;
            if (venueIds.includes(row.venue_id)) {
              setHeadcounts(prev => {
                const next = new Map(prev);
                next.set(row.venue_id, {
                  count: row.current_count,
                  isLive: row.is_live,
                  updatedAt: row.updated_at,
                  peak: row.peak_count,
                });
                return next;
              });
            }
          }
        }
      ).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [org.id, venues]);

  // ── Loyalty toggle ──
  const handleToggleLoyalty = useCallback(async (venueId: string, current: boolean) => {
    hapticLight();
    // Optimistic update
    setVenues(prev => prev.map(v => v.id === venueId ? { ...v, loyalty_active: !current } : v));
    await supabase.from('venues').update({ loyalty_active: !current }).eq('id', venueId);
  }, []);

  // ── Onboarding: fetch available venues for selection ──
  const loadAvailable = useCallback(async () => {
    const city = org.city ?? '';
    const { data } = await supabase.from('venues').select('*').ilike('city', `%${city}%`).eq('is_active', true).order('name');
    setAvailableVenues((data as Venue[]) ?? []);
  }, [org.city]);

  const handleAddVenue = useCallback(async (venueId: string) => {
    await supabase.from('organization_venues').insert({ org_id: org.id, venue_id: venueId });
    hapticLight();
    loadData();
    loadAvailable();
  }, [org.id, loadData, loadAvailable]);

  const handleRemoveVenue = useCallback(async (venueId: string) => {
    await supabase.from('organization_venues').delete().eq('org_id', org.id).eq('venue_id', venueId);
    setVenues(prev => prev.filter(v => v.id !== venueId));
    loadAvailable();
  }, [org.id, loadAvailable]);

  const handleToggleSelect = useCallback((venueId: string) => {
    hapticLight();
    setSelectedVenueIds(prev => {
      const next = new Set(prev);
      if (next.has(venueId)) next.delete(venueId); else next.add(venueId);
      return next;
    });
  }, []);

  const handleConfirmVenues = useCallback(async () => {
    if (selectedVenueIds.size === 0) return;
    setSavingVenues(true);
    console.debug('[security] Confirm: inserting', selectedVenueIds.size, 'venues');
    const inserts = [...selectedVenueIds].map(venue_id => ({ org_id: org.id, venue_id }));
    await supabase.from('organization_venues').insert(inserts);
    // Reload full venue data so the done screen can show PINs
    await loadData();
    setSavingVenues(false);
    setStep('done');
  }, [org.id, selectedVenueIds, loadData]);

  const handleFinishOnboarding = useCallback(() => {
    setStep('dashboard');
  }, []);

  // ── RENDER CHAIN — one clear path ──

  // 1. Drill-down into individual venue (highest priority)
  // (rendered from the existing selectedVenue block below)

  // 2. Loading skeleton
  if (step === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A14', padding: 'calc(env(safe-area-inset-top, 0px) + 24px) 20px' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ background: '#111118', borderRadius: 12, padding: 20, marginBottom: 12, height: 140 }}>
            <div style={{ width: 120, height: 12, background: '#1C1C2E', borderRadius: 4, marginBottom: 16 }} />
            <div style={{ width: 60, height: 40, background: '#1C1C2E', borderRadius: 4, margin: '0 auto' }} />
          </div>
        ))}
      </div>
    );
  }

  // 3. Onboarding screens
  // Shared exit button — visible on every screen, impossible to miss
  const exitBtn = (
    <button onClick={onDisconnect} style={{ position: 'absolute' as const, top: 'calc(env(safe-area-inset-top, 0px) + 14px)', right: 14, background: '#FF444440', color: '#FF4444', padding: '8px 16px', borderRadius: 8, border: 'none', fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: 'pointer', zIndex: 10 }}>
      {'\u2715'} EXIT
    </button>
  );

  if (step === 'welcome') {
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A14', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', animation: 'fadeIn 500ms ease-out', position: 'relative' }}>
        {exitBtn}
        <div style={{ fontSize: 48, marginBottom: 20 }}>{'\uD83D\uDEE1\uFE0F'}</div>
        <p style={{ fontFamily: FONT, fontSize: 14, color: '#888', margin: '0 0 4px' }}>Welcome to your</p>
        <h1 style={{ fontFamily: FONT, fontSize: 28, fontWeight: 800, color: 'white', margin: '0 0 16px' }}>Command Center</h1>
        <p style={{ fontFamily: FONT, fontSize: 14, color: '#888', textAlign: 'center', maxWidth: 280, lineHeight: 1.5, margin: '0 0 40px' }}>
          Manage every door from one place. Real-time headcounts. Cover sales. Staff accountability. All yours.
        </p>
        <button
          onClick={() => { setStep('select'); loadAvailable(); }}
          className="active:scale-[0.98] transition-transform"
          style={{ width: '100%', maxWidth: 320, height: 52, borderRadius: 12, background: '#FF8200', color: 'white', fontFamily: FONT, fontSize: 17, fontWeight: 700, border: 'none', cursor: 'pointer' }}
        >
          GET STARTED {'\u2192'}
        </button>
      </div>
    );
  }

  if (step === 'select') {
    const bars = availableVenues.filter(v => v.category !== 'fraternity');
    const frats = availableVenues.filter(v => v.category === 'fraternity');
    const count = selectedVenueIds.size;

    return (
      <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' as never, background: '#0A0A14', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)', paddingBottom: 180, position: 'relative' }}>
        {exitBtn}
        <div style={{ padding: '0 20px 16px' }}>
          <h2 style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700, color: 'white', margin: 0 }}>Select your venues</h2>
          <p style={{ fontFamily: FONT, fontSize: 13, color: '#888', margin: '4px 0 0' }}>Tap each venue your team works at.</p>
        </div>

        <div style={{ padding: '0 20px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' as never }}>
          {bars.length > 0 && (
            <>
              <p style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: '#666', letterSpacing: '1px', textTransform: 'uppercase', margin: '12px 0 8px' }}>BARS</p>
              {bars.map(v => {
                const sel = selectedVenueIds.has(v.id);
                return (
                  <button key={v.id} onClick={() => handleToggleSelect(v.id)} style={{
                    width: '100%', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 14px', background: sel ? '#FF82001A' : 'transparent',
                    borderBottom: '1px solid #1C1C2E', border: 'none', borderBottomStyle: 'solid', borderBottomWidth: 1, borderBottomColor: '#1C1C2E',
                    cursor: 'pointer', transition: 'background 0.15s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', border: sel ? 'none' : '2px solid #444', background: sel ? '#FF8200' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                        {sel && <span style={{ color: 'white', fontSize: 12, fontWeight: 700 }}>{'\u2713'}</span>}
                      </div>
                      <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: 'white' }}>{v.name}</span>
                    </div>
                    {sel && <span style={{ color: '#22C55E', fontSize: 16, fontWeight: 700 }}>{'\u2713'}</span>}
                  </button>
                );
              })}
            </>
          )}

          {frats.length > 0 && (
            <>
              <div style={{ height: 1, background: '#1C1C2E', margin: '12px 0' }} />
              <p style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: '#666', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>FRATERNITIES</p>
              {frats.map(v => {
                const sel = selectedVenueIds.has(v.id);
                return (
                  <button key={v.id} onClick={() => handleToggleSelect(v.id)} style={{
                    width: '100%', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 14px', background: sel ? `${GOLD}1A` : 'transparent',
                    borderBottom: '1px solid #1C1C2E', border: 'none', borderBottomStyle: 'solid', borderBottomWidth: 1, borderBottomColor: '#1C1C2E',
                    cursor: 'pointer', transition: 'background 0.15s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', border: sel ? 'none' : `2px solid ${GOLD}60`, background: sel ? GOLD : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                        {sel && <span style={{ color: '#1a1a2e', fontSize: 12, fontWeight: 700 }}>{'\u2713'}</span>}
                      </div>
                      <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: GOLD }}>{v.name}</span>
                    </div>
                    {sel && <span style={{ color: '#22C55E', fontSize: 16, fontWeight: 700 }}>{'\u2713'}</span>}
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Fixed bottom bar */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 20px', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))', background: '#0A0A14', borderTop: '1px solid #1C1C2E' }}>
          <p style={{ fontFamily: FONT, fontSize: 13, color: '#888', textAlign: 'center', margin: '0 0 8px' }}>
            {count} venue{count !== 1 ? 's' : ''} selected
          </p>
          <button
            onClick={handleConfirmVenues}
            disabled={count === 0 || savingVenues}
            className="active:scale-[0.98] transition-transform"
            style={{
              width: '100%', height: 52, borderRadius: 12,
              background: count > 0 ? '#FF8200' : 'rgba(255,130,0,0.2)',
              color: 'white', fontFamily: FONT, fontSize: 16, fontWeight: 700,
              border: 'none', cursor: count > 0 ? 'pointer' : 'default',
              opacity: count > 0 ? (savingVenues ? 0.6 : 1) : 0.3,
            }}
          >
            {savingVenues ? 'Saving...' : `CONFIRM VENUES (${count}) \u2192`}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    // Get the selected venues for the PIN display
    const linkedVenues = availableVenues.filter(v => selectedVenueIds.has(v.id));
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A14', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', position: 'relative' }}>
        {exitBtn}
        <div style={{ fontSize: 48, marginBottom: 20 }}>{'\u2705'}</div>
        <h1 style={{ fontFamily: FONT, fontSize: 28, fontWeight: 800, color: 'white', margin: '0 0 8px' }}>You're all set.</h1>
        <p style={{ fontFamily: FONT, fontSize: 14, color: '#888', margin: '0 0 24px' }}>
          {linkedVenues.length} venue{linkedVenues.length !== 1 ? 's' : ''} under your command.
        </p>

        {/* PIN list */}
        <div style={{ width: '100%', maxWidth: 320, marginBottom: 32 }}>
          <p style={{ fontFamily: FONT, fontSize: 11, color: '#666', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 10px' }}>STAFF PINS</p>
          {linkedVenues.map(v => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dotted #222' }}>
              <span style={{ fontFamily: FONT, fontSize: 14, color: v.category === 'fraternity' ? GOLD : 'white' }}>{v.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: '#FF8200' }}>{v.staff_code ?? '—'}</span>
            </div>
          ))}
        </div>

        <button
          onClick={handleFinishOnboarding}
          className="active:scale-[0.98] transition-transform"
          style={{ width: '100%', maxWidth: 320, height: 52, borderRadius: 12, background: '#FF8200', color: 'white', fontFamily: FONT, fontSize: 17, fontWeight: 700, border: 'none', cursor: 'pointer' }}
        >
          OPEN COMMAND CENTER {'\u2192'}
        </button>
      </div>
    );
  }

  // ── Selected venue → full portal ──
  if (selectedVenue) {
    const isFrat = selectedVenue.category === 'fraternity';
    const back = () => { setSelectedVenue(null); setSelectedHC(null); setEndSummary(null); loadData(); };
    const enter = async (n = 1) => { await supabase.rpc(n === 1 ? 'increment_headcount' : 'adjust_headcount', { target_venue: selectedVenue.id, target_city: selectedVenue.city, target_night: nightOf, staff_user: null, ...(n !== 1 ? { adjustment: n } : {}) }); };
    const exit = async (n = 1) => { await supabase.rpc(n === 1 ? 'decrement_headcount' : 'adjust_headcount', { target_venue: selectedVenue.id, target_city: selectedVenue.city, target_night: nightOf, staff_user: null, ...(n !== 1 ? { adjustment: -n } : {}) }); };
    const end = async () => {
      await supabase.from('headcounts').update({ current_count: 0, is_live: false }).eq('venue_id', selectedVenue.id).eq('night_of', nightOf);
      setEndSummary({ venueName: selectedVenue.name, peakCount: selectedHC?.peak_count ?? 0, peakTime: selectedHC?.updated_at ?? new Date().toISOString() });
    };

    return (
      <div className="min-h-screen bg-[#050507]">
        <button onClick={back} style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 12px)', left: 12,
          zIndex: 100, background: '#111118', border: '1px solid #1C1C2E', borderRadius: 10,
          width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: '#888',
        }}>
          <ArrowLeft size={18} />
        </button>
        {isFrat ? (
          <FratPortal venue={selectedVenue} headcount={selectedHC} lastAction={null} endSummary={endSummary}
            onEnter={enter} onExit={exit} onEndNight={end} onDisconnect={back} />
        ) : (
          <ClickerView venue={selectedVenue} headcount={selectedHC} lastAction={null} endSummary={endSummary}
            onEnter={enter} onExit={exit} onEndNight={end}
            onUpdateCover={async (t) => { await supabase.from('venues').update({ cover_charge: t || null }).eq('id', selectedVenue.id); }}
            onDisconnect={back} />
        )}
      </div>
    );
  }

  // ── Nightly Report ──
  if (showReport) {
    const sortedByPeak = [...venues].sort((a, b) => {
      const pa = headcounts.get(a.id)?.peak ?? headcounts.get(a.id)?.count ?? 0;
      const pb = headcounts.get(b.id)?.peak ?? headcounts.get(b.id)?.count ?? 0;
      return pb - pa;
    });
    const totalPeople = [...headcounts.values()].reduce((s, h) => s + Math.max(h.peak, h.count), 0);
    const totalCovers = [...coverData.values()].reduce((s, c) => s + c.coversSold, 0);
    const totalRevenue = [...revenueData.values()].reduce((s, r) => s + r, 0);
    const activeCount = venues.filter(v => (headcounts.get(v.id)?.count ?? 0) > 0 || (headcounts.get(v.id)?.peak ?? 0) > 0).length;
    const staleVenues = venues.filter(v => {
      const hc = headcounts.get(v.id);
      return hc && hc.count > 0 && hc.updatedAt && Math.floor((Date.now() - new Date(hc.updatedAt).getTime()) / 60000) > 30;
    });
    const consistentVenues = venues.filter(v => {
      const hc = headcounts.get(v.id);
      if (!hc || hc.count === 0) return false;
      return !hc.updatedAt || Math.floor((Date.now() - new Date(hc.updatedAt).getTime()) / 60000) <= 30;
    });

    const busiest = sortedByPeak[0];

    return (
      <div style={{ height: '100vh', background: '#0A0A14', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', paddingBottom: 120, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as never, position: 'relative' }}>
        {exitBtn}
        <button onClick={() => setShowReport(false)} style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: 'white', background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 20px', marginBottom: 4 }}>
          {'\u2190'} Dashboard
        </button>

        <div style={{ padding: '0 20px' }}>
          {/* ── REPORT HEADER ── */}
          <div style={{ background: '#111118', border: '1px solid #1C1C2E', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: 'white' }}>{'\uD83D\uDEE1\uFE0F'} {org.name.toUpperCase()}</span>
              <span style={{ fontFamily: FONT, fontSize: 11, color: '#888', letterSpacing: '3px', textTransform: 'uppercase' }}>NIGHTLY REPORT</span>
            </div>
            <p style={{ fontFamily: FONT, fontSize: 16, fontWeight: 500, color: 'white', margin: 0 }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
            <div style={{ height: 1, background: `${GOLD}4D`, marginTop: 12 }} />
          </div>

          {/* ── OVERVIEW GRID ── */}
          <p style={{ fontFamily: FONT, fontSize: 10, color: '#555', letterSpacing: '3px', textTransform: 'uppercase', margin: '0 0 8px' }}>OVERVIEW</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'TOTAL HEADCOUNT', value: String(totalPeople), color: '#FF8200' },
              { label: 'COVERS SOLD', value: String(totalCovers), color: '#00FF88' },
              { label: 'REVENUE', value: formatCoverPrice(totalRevenue), color: '#00FF88' },
              { label: 'VENUES ACTIVE', value: `${activeCount}/${venues.length}`, color: '#00D4FF' },
            ].map(m => (
              <div key={m.label} style={{ background: '#111118', borderRadius: 10, padding: 16, textAlign: 'center' }}>
                <p style={{ fontFamily: MONO, fontSize: 36, fontWeight: 700, color: m.color, margin: 0, lineHeight: 1 }}>{m.value}</p>
                <p style={{ fontFamily: FONT, fontSize: 10, color: '#555', margin: '8px 0 0', letterSpacing: '2px', textTransform: 'uppercase' }}>{m.label}</p>
              </div>
            ))}
          </div>

          {/* ── HIGHLIGHTS ── */}
          {busiest && (headcounts.get(busiest.id)?.peak ?? 0) > 0 && (
            <div style={{ background: '#111118', borderRadius: 10, padding: '12px 16px', marginBottom: 8, borderLeft: `3px solid ${busiest.category === 'fraternity' ? GOLD : '#FF8200'}` }}>
              <p style={{ fontFamily: FONT, fontSize: 10, color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 4px' }}>BUSIEST VENUE</p>
              <p style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: busiest.category === 'fraternity' ? GOLD : 'white', margin: '0 0 2px' }}>{busiest.name}</p>
              <p style={{ fontFamily: FONT, fontSize: 13, color: '#FF8200', margin: 0 }}>Peak: {headcounts.get(busiest.id)?.peak ?? 0} people</p>
            </div>
          )}

          <div style={{ height: 1, background: '#1C1C2E', margin: '8px 0 12px' }} />

          {/* ── VENUE PERFORMANCE ── */}
          <p style={{ fontFamily: FONT, fontSize: 10, color: '#555', letterSpacing: '3px', textTransform: 'uppercase', margin: '0 0 8px' }}>VENUE PERFORMANCE</p>
          {sortedByPeak.map((v, i) => {
            const hc = headcounts.get(v.id);
            const peak = hc ? Math.max(hc.peak, hc.count) : 0;
            const cover = coverData.get(v.id);
            const rev = revenueData.get(v.id);
            const isFrat = v.category === 'fraternity';
            const mins = hc?.updatedAt ? Math.floor((Date.now() - new Date(hc.updatedAt).getTime()) / 60000) : 999;
            const wasLive = peak > 0;
            const accent = isFrat ? GOLD : '#FF8200';

            return (
              <div key={v.id} style={{ background: '#111118', borderRadius: 10, padding: '12px 14px', marginBottom: 6, borderLeft: wasLive ? `3px solid ${accent}` : '3px solid #222' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: i < 3 ? accent : '#444', width: 28 }}>#{i + 1}</span>
                  <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: isFrat ? GOLD : 'white', flex: 1 }}>{v.name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: wasLive ? accent : '#333' }}>{peak > 0 ? peak : '—'}</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingLeft: 32 }}>
                  {cover && <span style={{ fontFamily: FONT, fontSize: 11, color: '#888' }}>Covers: {cover.coversSold}/{cover.capacity}</span>}
                  {rev && rev > 0 && <span style={{ fontFamily: FONT, fontSize: 11, color: '#888' }}>Rev: {formatCoverPrice(rev)}</span>}
                  {!wasLive ? (
                    <span style={{ fontFamily: FONT, fontSize: 11, color: '#333' }}>Did not report</span>
                  ) : mins > 30 ? (
                    <span style={{ fontFamily: FONT, fontSize: 11, color: '#FFB800' }}>{'\u26A0\uFE0F'} {mins}m gap</span>
                  ) : (
                    <span style={{ fontFamily: FONT, fontSize: 11, color: '#00FF88' }}>{'\u2705'} Consistent</span>
                  )}
                </div>
              </div>
            );
          })}

          <div style={{ height: 1, background: '#1C1C2E', margin: '8px 0 12px' }} />

          {/* ── MONITORING SUMMARY ── */}
          <p style={{ fontFamily: FONT, fontSize: 10, color: '#555', letterSpacing: '3px', textTransform: 'uppercase', margin: '0 0 8px' }}>MONITORING SUMMARY</p>
          {consistentVenues.length > 0 && (
            <div style={{ background: '#00FF8808', border: '1px solid #00FF8820', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
              <p style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#00FF88', margin: '0 0 2px' }}>
                {'\u2705'} {consistentVenues.length} venue{consistentVenues.length !== 1 ? 's' : ''} reported consistently
              </p>
              <p style={{ fontFamily: FONT, fontSize: 11, color: '#00FF8888', margin: 0 }}>
                {consistentVenues.map(v => v.name).join(', ')}
              </p>
            </div>
          )}
          {staleVenues.length > 0 && (
            <div style={{ background: '#FF444410', border: '1px solid #FF444425', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
              <p style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#FF4444', margin: '0 0 4px' }}>
                {'\u26A0\uFE0F'} {staleVenues.length} venue{staleVenues.length !== 1 ? 's' : ''} had monitoring gaps
              </p>
              {staleVenues.map(v => {
                const mins = Math.floor((Date.now() - new Date(headcounts.get(v.id)!.updatedAt).getTime()) / 60000);
                return <p key={v.id} style={{ fontFamily: FONT, fontSize: 11, color: '#FF8888', margin: '2px 0' }}>{v.name}: {mins}m gap</p>;
              })}
            </div>
          )}
          {consistentVenues.length === 0 && staleVenues.length === 0 && (
            <p style={{ fontFamily: FONT, fontSize: 12, color: '#333', marginBottom: 8 }}>No reporting data for tonight.</p>
          )}

          {/* ── FOOTER ── */}
          <div style={{ textAlign: 'center', padding: '28px 0 16px', borderTop: '1px solid #1C1C2E', marginTop: 8 }}>
            <p style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: '#555', margin: 0, letterSpacing: '1px' }}>
              Generated by <span style={{ color: '#FF8200' }}>venuu</span> &middot; {org.name}
            </p>
            <p style={{ fontFamily: FONT, fontSize: 10, color: '#333', margin: '4px 0 0' }}>
              {new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Manage Venues View ──
  if (showManage) {
    const linkedIds = new Set(venues.map(v => v.id));
    const unlinked = availableVenues.filter(v => !linkedIds.has(v.id));
    return (
      <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' as never, background: '#0A0A14', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)', paddingBottom: 120, position: 'relative' }}>
        <button onClick={() => { setShowManage(false); loadData(); }} style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', right: 14, background: '#1C1C2E', border: 'none', borderRadius: 8, color: '#888', padding: '6px 14px', fontFamily: FONT, fontSize: 13, cursor: 'pointer', zIndex: 10 }}>
          {'\u2715'} Close
        </button>
        <div style={{ padding: '0 20px' }}>
          <h2 style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, color: 'white', margin: '0 0 16px' }}>Manage Venues</h2>

          <p style={{ fontFamily: FONT, fontSize: 10, color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 8px' }}>LINKED VENUES</p>
          {venues.map(v => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1C1C2E' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: v.category === 'fraternity' ? `${GOLD}20` : '#FF820020', color: v.category === 'fraternity' ? GOLD : '#FF8200' }}>
                  {v.category === 'fraternity' ? 'FRAT' : 'BAR'}
                </span>
                <span style={{ fontFamily: FONT, fontSize: 14, color: v.category === 'fraternity' ? GOLD : 'white' }}>{v.name}</span>
                {v.staff_code && <span style={{ fontFamily: MONO, fontSize: 11, color: '#FF8200' }}>{v.staff_code}</span>}
              </div>
              <button onClick={() => handleRemoveVenue(v.id)} style={{ fontFamily: FONT, fontSize: 11, color: '#FF4444', background: 'transparent', border: 'none', cursor: 'pointer' }}>Remove</button>
            </div>
          ))}

          <p style={{ fontFamily: FONT, fontSize: 10, color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '20px 0 8px' }}>ADD MORE VENUES</p>
          {unlinked.length === 0 ? (
            <p style={{ fontFamily: FONT, fontSize: 12, color: '#444', padding: '8px 0' }}>No more venues available in this city</p>
          ) : unlinked.map(v => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1C1C2E' }}>
              <span style={{ fontFamily: FONT, fontSize: 14, color: v.category === 'fraternity' ? GOLD : '#aaa' }}>{v.name}</span>
              <button onClick={() => handleAddVenue(v.id)} style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: '#00FF88', background: 'transparent', border: 'none', cursor: 'pointer' }}>Add +</button>
            </div>
          ))}

          <button onClick={() => { setShowManage(false); loadData(); }} className="active:scale-[0.98] transition-transform" style={{ width: '100%', height: 44, marginTop: 24, borderRadius: 10, background: '#FF8200', color: 'white', fontFamily: FONT, fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Dashboard ──
  return (
    <div style={{
      height: '100vh',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch' as never,
      background: '#0A0A14',
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
      paddingBottom: 120,
    }}>
      {/* ── HEADER ── */}
      <div style={{ padding: '0 20px 16px', position: 'relative' }}>
        {exitBtn}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingRight: 100 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 28 }}>{'\uD83D\uDEE1\uFE0F'}</span>
              <h1 style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: 'white', margin: 0, letterSpacing: '3px', textTransform: 'uppercase' }}>
                {org.name}
              </h1>
            </div>
            <p style={{ fontFamily: FONT, fontSize: 12, color: '#888', margin: '0 0 2px' }}>
              {org.city ?? 'Multi-venue'}
            </p>
            <p style={{ fontFamily: FONT, fontSize: 10, color: '#555', margin: 0, letterSpacing: '2px', textTransform: 'uppercase' }}>
              {venues.length} VENUES UNDER COMMAND
            </p>
          </div>
          <p style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: '#888', margin: 0, flexShrink: 0 }}>
            {clock}
          </p>
        </div>
        {/* Pulse line — live monitoring indicator */}
        <div style={{ height: 1, marginTop: 14, background: '#FF8200', animation: 'secPulse 2s ease-in-out infinite' }} />
      </div>

      {/* ── SUMMARY BAR ── */}
      {(() => {
        const totalPeople = [...headcounts.values()].reduce((s, h) => s + (h.count > 0 ? h.count : 0), 0);
        const totalCovers = [...coverData.values()].reduce((s, c) => s + c.coversSold, 0);
        const totalEarned = [...revenueData.values()].reduce((s, r) => s + r, 0);
        const activeVenues = [...headcounts.values()].filter(h => h.count > 0).length;
        const totalEvents = eventData.size;
        const earnedStr = totalEarned < 1000 ? formatCoverPrice(totalEarned) : `$${Math.round(totalEarned / 100)}`;

        const metrics = [
          { icon: '\uD83D\uDC65', value: String(totalPeople), label: 'PEOPLE', color: '#FF8200' },
          { icon: '\uD83C\uDF9F\uFE0F', value: String(totalCovers), label: 'COVERS', color: '#00FF88' },
          { icon: '\uD83D\uDCB0', value: earnedStr, label: 'EARNED', color: '#00FF88' },
          { icon: '\uD83C\uDFE2', value: `${activeVenues}/${venues.length}`, label: 'ACTIVE', color: '#00D4FF' },
          { icon: '\u26A1', value: String(totalEvents), label: 'EVENTS', color: '#00D4FF' },
        ];

        return (
          <div style={{ padding: '0 20px 12px' }}>
            <p style={{ fontFamily: FONT, fontSize: 10, color: '#444', letterSpacing: '3px', textTransform: 'uppercase', margin: '0 0 8px' }}>
              TONIGHT
            </p>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {metrics.map(m => (
                <div key={m.label} style={{
                  background: '#111118', borderRadius: 10, padding: '12px 16px',
                  minWidth: 72, textAlign: 'center', flexShrink: 0,
                }}>
                  <div style={{ fontSize: 16, marginBottom: 6 }}>{m.icon}</div>
                  <p style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: m.color, margin: 0, lineHeight: 1 }}>
                    {m.value}
                  </p>
                  <p style={{ fontFamily: FONT, fontSize: 9, color: '#555', margin: '4px 0 0', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                    {m.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── ALERTS ── */}
      {(() => {
        const alerts: { type: 'danger' | 'warning' | 'success' | 'info'; icon: string; message: string }[] = [];

        // Stale venues (> 30 min without update)
        venues.forEach(v => {
          const hc = headcounts.get(v.id);
          if (hc && hc.count > 0 && hc.updatedAt) {
            const mins = Math.floor((Date.now() - new Date(hc.updatedAt).getTime()) / 60000);
            if (mins > 30) alerts.push({ type: 'danger', icon: '\u26A0\uFE0F', message: `${v.name} \u2014 no updates in ${mins} min` });
          }
        });

        // Cover urgency
        coverData.forEach((cover, venueId) => {
          const v = venues.find(x => x.id === venueId);
          if (!v) return;
          const remaining = cover.capacity - cover.coversSold;
          if (remaining <= 0) {
            alerts.push({ type: 'success', icon: '\u2705', message: `${v.name} \u2014 covers sold out!` });
          } else if (cover.capacity > 0 && cover.coversSold / cover.capacity > 0.8) {
            alerts.push({ type: 'warning', icon: '\uD83D\uDD25', message: `${v.name} \u2014 only ${remaining} covers left!` });
          }
        });

        // All clear
        const hasProblems = alerts.some(a => a.type === 'danger' || a.type === 'warning');
        const hasLive = [...headcounts.values()].some(h => h.count > 0);
        if (!hasProblems && hasLive && alerts.length === 0) {
          alerts.push({ type: 'info', icon: '\u2705', message: 'All venues reporting normally' });
        }

        const display = alerts.slice(0, 3);
        if (display.length === 0) return null;

        const colors: Record<string, { bg: string; border: string }> = {
          danger: { bg: '#FF444420', border: '#FF4444' },
          warning: { bg: '#FF820020', border: '#FF8200' },
          success: { bg: '#00FF8820', border: '#00FF88' },
          info: { bg: '#00FF8810', border: '#00FF88' },
        };

        return (
          <div style={{ padding: '0 20px 8px' }}>
            <p style={{ fontFamily: FONT, fontSize: 10, color: '#444', letterSpacing: '3px', textTransform: 'uppercase', margin: '0 0 8px' }}>
              ALERTS
            </p>
            {display.map((a, i) => {
              const c = colors[a.type];
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px', marginBottom: 6,
                  background: c.bg, borderRadius: 8,
                  borderLeft: `3px solid ${c.border}`,
                  animation: 'fadeIn 200ms ease-out',
                }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{a.icon}</span>
                  <span style={{ fontFamily: FONT, fontSize: 13, color: '#ddd' }}>{a.message}</span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── FILTER PILLS ── */}
      <div style={{ padding: '0 20px 10px', display: 'flex', gap: 8 }}>
        {([
          { key: 'all' as const, label: 'ALL', selBg: '#FF8200', selColor: '#fff' },
          { key: 'live' as const, label: 'LIVE', selBg: '#00FF88', selColor: '#1a1a2e' },
          { key: 'bars' as const, label: 'BARS', selBg: '#FF8200', selColor: '#fff' },
          { key: 'greek' as const, label: 'GREEK', selBg: GOLD, selColor: '#1a1a2e' },
        ]).map(f => (
          <button key={f.key} onClick={() => { hapticLight(); setDashFilter(f.key); }}
            style={{
              padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: 12, fontWeight: 700,
              background: dashFilter === f.key ? f.selBg : '#1C1C2E',
              color: dashFilter === f.key ? f.selColor : '#888',
              transition: 'background 0.2s, color 0.2s',
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* ── VENUE CARDS ── */}
      <div style={{ padding: '0 20px' }}>
        {venues.filter(v => {
          if (dashFilter === 'live') return (headcounts.get(v.id)?.count ?? 0) > 0;
          if (dashFilter === 'bars') return v.category !== 'fraternity';
          if (dashFilter === 'greek') return v.category === 'fraternity';
          return true;
        }).map(venue => {
            const isFrat = venue.category === 'fraternity';
            const accent = isFrat ? GOLD : '#FF8200';
            const hc = headcounts.get(venue.id);
            const count = hc?.count ?? 0;
            const isLive = hc?.isLive ?? false;
            const dotColor = isLive && count > 0 ? '#00FF88' : '#333';

            const isExpanded = expandedVenueId === venue.id;
            const toggleExpand = () => setExpandedVenueId(isExpanded ? null : venue.id);
            const openPortal = () => {
              setSelectedVenue(venue);
              if (hc) {
                setSelectedHC({
                  id: '', created_at: '', venue_id: venue.id, city: venue.city,
                  night_of: nightOf, current_count: hc.count, peak_count: hc.peak,
                  last_updated_by: null, is_live: hc.isLive, updated_at: hc.updatedAt,
                });
              }
            };

            // ── OFFLINE: compact single-row card ──
            if (!isLive) {
              return (
                <button key={venue.id} onClick={toggleExpand} className="active:scale-[0.98]"
                  style={{ width: '100%', background: '#111118', borderRadius: 8, padding: '10px 14px', marginBottom: 6, border: 'none', borderLeft: '3px solid #222', textAlign: 'left', cursor: 'pointer', opacity: 0.35, transition: 'opacity 0.3s', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#333' }} />
                    <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: isFrat ? GOLD : '#aaa' }}>{venue.name}</span>
                  </div>
                  <span style={{ fontFamily: FONT, fontSize: 10, color: '#444', letterSpacing: '1px', textTransform: 'uppercase' }}>OFFLINE</span>
                </button>
              );
            }

            // ── LIVE: full expanded card ──
            return (
              <div key={venue.id} onClick={toggleExpand}
                className="active:scale-[0.98]"
                style={{
                  width: '100%', background: '#111118', borderRadius: 12, padding: 20, marginBottom: 12,
                  border: 'none', borderLeft: `3px solid ${accent}`, textAlign: 'left', cursor: 'pointer',
                  animation: 'secLiveBorder 2s ease-in-out infinite',
                }}>
                {/* Top row: dot + name + status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}` }} />
                    <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: isFrat ? GOLD : 'white' }}>{venue.name}</span>
                  </div>
                  <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: '#00FF88', letterSpacing: '1px', textTransform: 'uppercase' }}>LIVE</span>
                </div>

                {/* Center: headcount with glow */}
                <div style={{ textAlign: 'center', padding: '4px 0' }}>
                  <p style={{
                    fontFamily: MONO, fontSize: 52, fontWeight: 700, color: accent,
                    margin: 0, lineHeight: 1, textShadow: `0 0 20px ${accent}4D`,
                    transition: 'color 0.3s ease',
                  }}>
                    {count}
                  </p>
                  <p style={{ fontFamily: FONT, fontSize: 11, color: '#555', margin: '6px 0 0', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                    people inside
                  </p>
                </div>

                {/* Info chips */}
                {(() => {
                  const cover = coverData.get(venue.id);
                  const event = eventData.get(venue.id);
                  const rev = revenueData.get(venue.id);
                  const loyaltyOn = venue.loyalty_active ?? false;
                  const hasChips = cover || event || rev || true; // always show loyalty
                  if (!hasChips) return null;
                  return (
                    <>
                      <div style={{ height: 1, background: '#1C1C2E', margin: '10px 0 8px' }} />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {cover && (
                          <span style={{ fontFamily: FONT, fontSize: 11, color: 'white', background: '#00FF8820', padding: '4px 10px', borderRadius: 8 }}>
                            {'\uD83C\uDF9F\uFE0F'} {formatCoverPriceShort(cover.currentPrice)} &middot; {cover.coversSold}/{cover.capacity}
                          </span>
                        )}
                        {event && (
                          <span style={{ fontFamily: FONT, fontSize: 11, color: 'white', background: '#00D4FF20', padding: '4px 10px', borderRadius: 8 }}>
                            {'\u26A1'} {event.title.length > 20 ? event.title.substring(0, 20) + '...' : event.title}
                          </span>
                        )}
                        <span
                          onClick={(e) => { e.stopPropagation(); handleToggleLoyalty(venue.id, loyaltyOn); }}
                          style={{
                            fontFamily: FONT, fontSize: 11, cursor: 'pointer',
                            color: loyaltyOn ? '#00FF88' : '#888',
                            background: loyaltyOn ? '#00FF8820' : '#33333380',
                            padding: '4px 10px', borderRadius: 8,
                            transition: 'background 0.3s, color 0.3s',
                          }}
                        >
                          {'\uD83C\uDFAF'} {loyaltyOn ? 'ON' : 'OFF'}
                        </span>
                        {rev && rev > 0 && (
                          <span style={{ fontFamily: FONT, fontSize: 11, color: '#888', padding: '4px 10px', borderRadius: 8 }}>
                            {'\uD83D\uDCB0'} {formatCoverPrice(rev)}
                          </span>
                        )}
                      </div>
                    </>
                  );
                })()}

                {/* Staff activity (live venues only) */}
                {isLive && hc && (() => {
                  const mins = Math.round((Date.now() - new Date(hc.updatedAt).getTime()) / 60000);
                  const timeColor = mins < 10 ? '#00FF88' : mins < 30 ? '#FFB800' : '#FF4444';
                  return (
                    <>
                      <div style={{ height: 1, background: '#1C1C2E', margin: '8px 0 6px' }} />
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontFamily: FONT, fontSize: 11, color: timeColor }}>
                          {'\uD83D\uDCCA'} {mins < 1 ? 'Just now' : `${mins}m ago`}
                        </span>
                        {hc.peak > 0 && (
                          <span style={{ fontFamily: FONT, fontSize: 11, color: '#555' }}>
                            Peak: {hc.peak}
                          </span>
                        )}
                      </div>
                    </>
                  );
                })()}

                {/* Expanded detail section */}
                {isExpanded && (() => {
                  const cover = coverData.get(venue.id);
                  const event = eventData.get(venue.id);
                  const rev = revenueData.get(venue.id);
                  return (
                    <>
                      <div style={{ height: 1, background: '#1C1C2E', margin: '10px 0 8px' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {cover && (
                          <p style={{ fontFamily: FONT, fontSize: 12, color: '#aaa', margin: 0 }}>
                            {'\uD83C\uDF9F\uFE0F'} Cover: {formatCoverPriceShort(cover.currentPrice)} &middot; {cover.coversSold}/{cover.capacity} sold
                          </p>
                        )}
                        {event && (
                          <p style={{ fontFamily: FONT, fontSize: 12, color: '#00D4FF', margin: 0 }}>
                            {'\u26A1'} {event.title}
                          </p>
                        )}
                        {rev && rev > 0 && (
                          <p style={{ fontFamily: FONT, fontSize: 12, color: '#888', margin: 0 }}>
                            {'\uD83D\uDCB0'} Revenue: {formatCoverPrice(rev)}
                          </p>
                        )}
                        {hc && (
                          <p style={{ fontFamily: FONT, fontSize: 12, color: '#888', margin: 0 }}>
                            Peak: {hc.peak} &middot; PIN: <span style={{ fontFamily: MONO, color: '#FF8200' }}>{venue.staff_code ?? '—'}</span>
                          </p>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); openPortal(); }}
                        className="active:scale-[0.98] transition-transform"
                        style={{ width: '100%', height: 40, marginTop: 10, borderRadius: 8, background: accent, color: isFrat ? '#1a1a2e' : 'white', fontFamily: FONT, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}
                      >
                        OPEN FULL PORTAL {'\u2192'}
                      </button>
                    </>
                  );
                })()}
              </div>
            );
          })}
      </div>

      {/* ── MANAGE VENUES ── */}
      <div style={{ padding: '8px 20px 0' }}>
        <button onClick={() => { setShowManage(true); loadAvailable(); }} className="active:scale-[0.98] transition-transform" style={{
          width: '100%', padding: 14, borderRadius: 10, background: 'transparent',
          border: '1px dashed #333', color: '#666', fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          {'\u2699\uFE0F'} MANAGE VENUES
        </button>
      </div>

      {/* ── REPORT BUTTON ── */}
      <div style={{ padding: '16px 20px 0' }}>
        <button
          onClick={() => setShowReport(true)}
          className="active:scale-[0.98] transition-transform"
          style={{
            width: '100%', height: 44, borderRadius: 10,
            background: 'rgba(255,130,0,0.08)', border: '1px solid rgba(255,130,0,0.15)',
            color: '#FF8200', fontFamily: FONT, fontSize: 14, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {'\uD83D\uDCCA'} End of Night Report
        </button>
      </div>
    </div>
  );
}
