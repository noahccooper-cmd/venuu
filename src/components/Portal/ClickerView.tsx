import { useState, useEffect, useCallback } from 'react';
import { Minus, Plus, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCount, formatTime, timeAgo, getTonightDate } from '../../lib/utils';
import type { Venue, Headcount } from '../../lib/types';
import type { EndNightSummary } from '../../hooks/usePortal';
import { EventCreator } from './EventCreator';
import { CoverPortalSection } from './CoverPortalSection';
import { hapticLight } from '../../lib/haptics';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

interface ClickerViewProps {
  venue: Venue;
  headcount: Headcount | null;
  lastAction: { type: string; time: string } | null;
  endSummary: EndNightSummary | null;
  onEnter: (count?: number) => Promise<void>;
  onExit: (count?: number) => Promise<void>;
  onEndNight: () => Promise<void>;
  onUpdateCover: (text: string) => Promise<void>;
  onDisconnect: () => void;
}

const COVER_PRESETS = ['FREE', '$10', '$20', '$40'];

export function ClickerView({
  venue,
  headcount,
  lastAction,
  endSummary,
  onEnter,
  onExit,
  onEndNight,
  onUpdateCover,
  onDisconnect,
}: ClickerViewProps) {
  const [flashClass, setFlashClass] = useState('');
  const [bumpKey, setBumpKey] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [specialText, setSpecialText] = useState('');
  const [specialConfirm, setSpecialConfirm] = useState('');
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastConfirm, setBroadcastConfirm] = useState('');
  const [loyaltyActive, setLoyaltyActive] = useState(venue.loyalty_active ?? false);
  const [loyaltyReward, setLoyaltyReward] = useState('');
  const [loyaltyVisitsReq, setLoyaltyVisitsReq] = useState(5);
  const [loyaltyDescription, setLoyaltyDescription] = useState('');
  const [loyaltySaveConfirm, setLoyaltySaveConfirm] = useState('');
  const [loyaltySaving, setLoyaltySaving] = useState(false);
  const [todayRedemptions, setTodayRedemptions] = useState<number | null>(null);
  const [updates, setUpdates] = useState<{ id: string; venue_id: string; venue_name: string; message: string; created_at: string }[]>([]);
  const [selectedCover, setSelectedCover] = useState<string>(() => {
    const current = venue.cover_charge;
    if (!current || current === 'FREE') return 'FREE';
    const match = COVER_PRESETS.find(p => p === current);
    return match ?? 'FREE';
  });

  // Sync selectedCover when venue or its cover_charge changes (re-login, refetch, realtime)
  useEffect(() => {
    const current = venue.cover_charge;
    if (!current || current === 'FREE') {
      setSelectedCover('FREE');
    } else {
      const match = COVER_PRESETS.find(p => p === current);
      setSelectedCover(match ?? 'FREE');
    }
  }, [venue.id, venue.cover_charge]);

  // Load current special + loyalty reward on mount
  useEffect(() => {
    const loadSpecial = async () => {
      const { data } = await supabase
        .from('venues')
        .select('special, loyalty_active')
        .eq('id', venue.id)
        .maybeSingle();
      if (data?.special) setSpecialText(data.special);
      if (data?.loyalty_active !== undefined) setLoyaltyActive(data.loyalty_active);
    };
    const loadReward = async () => {
      const { data } = await supabase
        .from('venue_rewards')
        .select('reward_text, visits_required, reward_description')
        .eq('venue_id', venue.id)
        .eq('is_active', true)
        .maybeSingle();
      if (data) {
        setLoyaltyReward(data.reward_text ?? '');
        setLoyaltyVisitsReq(data.visits_required ?? 5);
        setLoyaltyDescription(data.reward_description ?? '');
      }
    };
    const loadRedemptions = async () => {
      const nightOf = getTonightDate();
      const { count } = await supabase
        .from('loyalty_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venue.id)
        .gte('redeemed_at', `${nightOf}T00:00:00`);
      setTodayRedemptions(count ?? 0);
    };
    loadSpecial();
    loadReward();
    loadRedemptions();
  }, [venue.id]);


  const count = headcount?.current_count ?? 0;
  const peak = headcount?.peak_count ?? 0;
  const isLive = headcount?.is_live ?? false;

  // ── Portal analytics state ──
  const [tonightCheckins, setTonightCheckins] = useState<number | null>(null);
  const [tonightAvgRating, setTonightAvgRating] = useState<number | null>(null);
  const [weekVisitors, setWeekVisitors] = useState<number | null>(null);
  const [weekAvgPeak, setWeekAvgPeak] = useState<number | null>(null);

  // Request wake lock
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch { /* ignore */ }
    };
    requestWakeLock();
    return () => { wakeLock?.release(); };
  }, []);

  // ── Fetch portal analytics (tonight + this week) ──
  useEffect(() => {
    const nightOf = getTonightDate();

    // 7 days ago
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);

    async function fetchStats() {
      // Tonight's check-ins
      const { count: checkinCount } = await supabase
        .from('loyalty_visits')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venue.id)
        .eq('night_of', nightOf);
      setTonightCheckins(checkinCount ?? 0);

      // Tonight's avg rating
      const { data: recapRows } = await supabase
        .from('venue_recaps')
        .select('stars')
        .eq('venue_id', venue.id)
        .eq('day_of', nightOf);
      if (recapRows && recapRows.length > 0) {
        const avg = recapRows.reduce((sum, r) => sum + r.stars, 0) / recapRows.length;
        setTonightAvgRating(Math.round(avg * 10) / 10);
      } else {
        setTonightAvgRating(null);
      }

      // This week: total loyalty check-ins
      const { count: weekCount } = await supabase
        .from('loyalty_visits')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venue.id)
        .gte('night_of', weekAgoStr);
      setWeekVisitors(weekCount ?? 0);

      // This week: avg nightly peak
      const { data: weekHeadcounts } = await supabase
        .from('headcounts')
        .select('peak_count')
        .eq('venue_id', venue.id)
        .gte('night_of', weekAgoStr)
        .gt('peak_count', 0);
      if (weekHeadcounts && weekHeadcounts.length > 0) {
        const avgPeak = weekHeadcounts.reduce((sum, h) => sum + h.peak_count, 0) / weekHeadcounts.length;
        setWeekAvgPeak(Math.round(avgPeak));
      } else {
        setWeekAvgPeak(null);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [venue.id]);

  const handleEnter = useCallback(async (n = 1) => {
    setFlashClass('clicker-flash-enter');
    setBumpKey(prev => prev + 1);
    if (navigator.vibrate) navigator.vibrate(40);
    setTimeout(() => setFlashClass(''), 400);
    await onEnter(n);
  }, [onEnter]);

  const handleExit = useCallback(async (n = 1) => {
    setFlashClass('clicker-flash-exit');
    setBumpKey(prev => prev + 1);
    if (navigator.vibrate) navigator.vibrate(40);
    setTimeout(() => setFlashClass(''), 400);
    await onExit(n);
  }, [onExit]);

  const handleEndNight = useCallback(async () => {
    setConfirmEnd(false);
    await onEndNight();
  }, [onEndNight]);

  const handleSetSpecial = useCallback(async () => {
    if (!specialText.trim()) return;
    await supabase
      .from('venues')
      .update({ special: specialText.trim() })
      .eq('id', venue.id);
    setSpecialConfirm('Special set ✓');
    setTimeout(() => setSpecialConfirm(''), 2000);
  }, [specialText, venue.id]);

  const handleClearSpecial = useCallback(async () => {
    await supabase
      .from('venues')
      .update({ special: null })
      .eq('id', venue.id);
    setSpecialText('');
    setSpecialConfirm('Special cleared');
    setTimeout(() => setSpecialConfirm(''), 2000);
  }, [venue.id]);

  const handleCoverTap = useCallback(async (preset: string) => {
    setSelectedCover(preset);
    if (navigator.vibrate) navigator.vibrate(40);
    await onUpdateCover(preset);
  }, [onUpdateCover]);

  const handleToggleLoyalty = useCallback(async () => {
    const newValue = !loyaltyActive;
    setLoyaltyActive(newValue);
    if (navigator.vibrate) navigator.vibrate(40);
    console.debug('[portal] Loyalty toggled to', newValue, 'for', venue.name);
    await supabase
      .from('venues')
      .update({ loyalty_active: newValue })
      .eq('id', venue.id);
  }, [loyaltyActive, venue.id, venue.name]);

  const handleSaveReward = useCallback(async () => {
    if (!loyaltyReward.trim() || loyaltySaving) return;
    if (!venue.staff_code) {
      setLoyaltySaveConfirm('save_failed');
      setTimeout(() => setLoyaltySaveConfirm(''), 2500);
      return;
    }
    setLoyaltySaving(true);
    setLoyaltySaveConfirm('');

    let failed = false;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-venue-rewards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          venue_id: venue.id,
          portal_pin: venue.staff_code,
          reward_text: loyaltyReward.trim(),
          visits_required: loyaltyVisitsReq,
          reward_description: loyaltyDescription.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        console.error('[rewards] update-venue-rewards error:', res.status, data);
        failed = true;
      }
    } catch (err) {
      console.error('[rewards] update-venue-rewards FAILED:', err);
      failed = true;
    }

    setLoyaltySaving(false);

    if (failed) {
      setLoyaltySaveConfirm('save_failed');
    } else {
      hapticLight();
      setLoyaltySaveConfirm('Saved \u2713');
    }
    setTimeout(() => setLoyaltySaveConfirm(''), 2500);
  }, [venue.id, venue.staff_code, loyaltyReward, loyaltyVisitsReq, loyaltyDescription, loyaltySaving]);

  const handleSendUpdate = useCallback(async () => {
    if (!broadcastText.trim()) return;
    if (!venue.staff_code) {
      setBroadcastConfirm('Session expired — log in again');
      setTimeout(() => setBroadcastConfirm(''), 2000);
      return;
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/post-venue-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          venue_id: venue.id,
          portal_pin: venue.staff_code,
          message: broadcastText.trim(),
          expires_at: expiresAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        console.error('[drop] post-venue-update error:', res.status, data);
        setBroadcastConfirm('Failed to send');
        setTimeout(() => setBroadcastConfirm(''), 2000);
        return;
      }
    } catch (err) {
      console.error('[drop] post-venue-update FAILED:', err);
      setBroadcastConfirm('Failed to send');
      setTimeout(() => setBroadcastConfirm(''), 2000);
      return;
    }

    setBroadcastText('');
    hapticLight();
    setBroadcastConfirm('Dropped \u2713');
    setTimeout(() => setBroadcastConfirm(''), 2000);
  }, [broadcastText, venue.id, venue.staff_code]);

  // Fetch active venue updates for THIS venue only + realtime subscription
  useEffect(() => {
    const fetchUpdates = async () => {
      const { data } = await supabase
        .from('venue_updates')
        .select('id, venue_id, venue_name, message, created_at')
        .eq('venue_id', venue.id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(10);
      if (data) setUpdates(data);
    };
    fetchUpdates();

    const channel = supabase
      .channel(`venue-updates-rt-${venue.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'venue_updates', filter: `venue_id=eq.${venue.id}` },
        (payload) => {
          const row = payload.new as { id: string; venue_id: string; venue_name: string; message: string; created_at: string; expires_at: string };
          if (new Date(row.expires_at) > new Date()) {
            setUpdates(prev => [row, ...prev].slice(0, 10));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [venue.id]);

  // Show end-of-night summary
  if (endSummary) {
    return (
      <div className="min-h-screen bg-[#050507] flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h1 className="text-white font-black text-2xl tracking-[0.05em] mb-6"
            style={{ fontFamily: 'Satoshi, sans-serif' }}>
            venuu
          </h1>
          <div className="bg-[#111114] border border-[#2A2A30] rounded-2xl p-6">
            <p className="text-[#8A8A95] text-sm mb-2" style={{ fontFamily: 'Satoshi, sans-serif' }}>Tonight at</p>
            <h2 className="text-white font-black text-xl mb-4" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              {endSummary.venueName}
            </h2>
            <div className="flex items-baseline justify-center gap-2 mb-2">
              <span className="text-white font-black text-5xl" style={{ fontFamily: 'Satoshi, sans-serif' }}>
                {formatCount(endSummary.peakCount)}
              </span>
              <span className="text-[#8A8A95] text-sm" style={{ fontFamily: 'Satoshi, sans-serif' }}>peak</span>
            </div>
            <p className="text-[#55555F] text-xs" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              at {formatTime(endSummary.peakTime)}
            </p>
          </div>
          <button
            onClick={onDisconnect}
            className="w-full rounded-xl font-bold text-white mt-6 active:scale-[0.98] transition-transform"
            style={{ fontFamily: 'Satoshi, sans-serif', background: 'linear-gradient(135deg, #FF5E1A, #FF2D05)', height: '52px', fontSize: '16px' }}
          >
            DONE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-[#050507] flex flex-col ${flashClass}`}
      style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none', touchAction: 'manipulation', paddingBottom: '120px' }}>
      {/* Header — offset below the fixed app header */}
      <div className="px-5 pt-3 pb-2 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 76px)' }}>
        <div>
          <h1 className="text-white font-black text-lg tracking-[0.05em]"
            style={{ fontFamily: 'Satoshi, sans-serif' }}>
            <span>venuu</span>
            <span className="text-[#8A8A95] font-bold text-sm ml-2">Portal</span>
          </h1>
          <p className="text-white text-sm font-bold" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            {venue.name}
          </p>
          {venue.address && (
            <p className="text-[#55555F] text-xs" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              {venue.address}
            </p>
          )}
          {venue.featured && (
            <div style={{
              marginTop: 8,
              background: 'rgba(124, 58, 237, 0.15)',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              borderRadius: 8,
              padding: '10px 16px',
              textAlign: 'center' as const,
            }}>
              <span style={{
                fontFamily: 'Satoshi, sans-serif',
                fontSize: 13,
                fontWeight: 700,
                color: '#A855F7',
              }}>
                {'\uD83D\uDC51'} Featured Venue on venuu
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isLive && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#00E676] live-dot" />
              <span className="text-[#00E676] text-xs font-bold" style={{ fontFamily: 'Satoshi, sans-serif' }}>
                LIVE
              </span>
            </div>
          )}
          <button
            onClick={onDisconnect}
            className="p-2 rounded-lg bg-[#111114] text-[#55555F] hover:text-white transition-colors"
            style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <LogOut size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Loyalty Toggle */}
      <div className="mx-4 mb-3" style={{
        background: '#111114',
        border: loyaltyActive ? '1px solid rgba(0, 255, 136, 0.2)' : '1px solid #2A2A30',
        borderRadius: '16px',
        padding: '16px 20px',
        transition: 'border-color 0.3s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <p style={{
            fontFamily: 'Satoshi, sans-serif',
            fontSize: '11px',
            fontWeight: 600,
            color: '#FF8200',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            margin: 0,
          }}>
            {'\uD83C\uDFAF'} LOYALTY
          </p>
          {/* iOS-style toggle */}
          <button
            onClick={handleToggleLoyalty}
            style={{
              width: '52px',
              height: '30px',
              borderRadius: '15px',
              background: loyaltyActive ? '#00FF88' : '#2A2A30',
              border: 'none',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.3s',
              WebkitTapHighlightColor: 'transparent',
              flexShrink: 0,
            }}
          >
            <div style={{
              width: '26px',
              height: '26px',
              borderRadius: '13px',
              background: 'white',
              position: 'absolute',
              top: '2px',
              left: loyaltyActive ? '24px' : '2px',
              transition: 'left 0.3s',
              boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            }} />
          </button>
        </div>
        <p style={{
          fontFamily: 'Satoshi, sans-serif',
          fontSize: '13px',
          fontWeight: 600,
          color: loyaltyActive ? '#00FF88' : '#8A8A95',
          margin: '0 0 4px',
          transition: 'color 0.3s',
        }}>
          {loyaltyActive ? 'Loyalty is ACTIVE \u2014 students can tap to check in!' : 'Loyalty is OFF \u2014 students can\'t check in right now'}
        </p>
        {todayRedemptions !== null && todayRedemptions > 0 && (
          <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '12px', color: '#22C55E', margin: '4px 0 0', fontWeight: 600 }}>
            {'\uD83C\uDF81'} {todayRedemptions} reward{todayRedemptions === 1 ? '' : 's'} redeemed tonight
          </p>
        )}

        {/* Reward Settings */}
        <div style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
          <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '11px', fontWeight: 600, color: '#FF8200', letterSpacing: '0.5px', marginBottom: '8px' }}>
            REWARD SETTINGS
          </p>
          {/* Reward text */}
          <input
            type="text"
            value={loyaltyReward}
            onChange={e => setLoyaltyReward(e.target.value.slice(0, 100))}
            placeholder="e.g. Free domestic draft"
            maxLength={100}
            style={{
              width: '100%', height: '40px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
              padding: '0 12px', fontSize: '14px', color: 'white', outline: 'none',
              boxSizing: 'border-box' as const, fontFamily: 'Satoshi, sans-serif', marginBottom: '8px',
            }}
          />
          {/* Visits required — stepper 3–15 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '13px', color: '#8A8A95', flexShrink: 0 }}>
              Visits to earn:
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => { hapticLight(); setLoyaltyVisitsReq(v => Math.max(3, v - 1)); }}
                disabled={loyaltyVisitsReq <= 3}
                style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: loyaltyVisitsReq <= 3 ? 'rgba(255,255,255,0.2)' : 'white',
                  fontWeight: 700, fontSize: '20px',
                  cursor: loyaltyVisitsReq <= 3 ? 'not-allowed' : 'pointer',
                  fontFamily: 'Satoshi, sans-serif',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >−</button>
              <span style={{
                fontFamily: 'Satoshi, sans-serif', fontSize: '20px', fontWeight: 800,
                color: '#FF8200', minWidth: '28px', textAlign: 'center',
              }}>
                {loyaltyVisitsReq}
              </span>
              <button
                onClick={() => { hapticLight(); setLoyaltyVisitsReq(v => Math.min(20, v + 1)); }}
                disabled={loyaltyVisitsReq >= 20}
                style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: loyaltyVisitsReq >= 20 ? 'rgba(255,255,255,0.2)' : 'white',
                  fontWeight: 700, fontSize: '20px',
                  cursor: loyaltyVisitsReq >= 20 ? 'not-allowed' : 'pointer',
                  fontFamily: 'Satoshi, sans-serif',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >+</button>
            </div>
          </div>
          {/* Description (optional) */}
          <input
            type="text"
            value={loyaltyDescription}
            onChange={e => setLoyaltyDescription(e.target.value.slice(0, 100))}
            placeholder="Restrictions (optional): e.g. Valid Sun-Thu only"
            maxLength={100}
            style={{
              width: '100%', height: '36px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              padding: '0 12px', fontSize: '12px', color: '#8A8A95', outline: 'none',
              boxSizing: 'border-box' as const, fontFamily: 'Satoshi, sans-serif', marginBottom: '8px',
            }}
          />
          {/* Save */}
          <button
            onClick={handleSaveReward}
            disabled={!loyaltyReward.trim() || loyaltySaving}
            style={{
              width: '100%', height: '44px', borderRadius: '10px',
              background: loyaltyReward.trim() && !loyaltySaving ? '#FF8200' : 'rgba(255,130,0,0.2)',
              color: 'white', fontWeight: 700, fontSize: '14px', border: 'none',
              cursor: loyaltyReward.trim() && !loyaltySaving ? 'pointer' : 'not-allowed',
              fontFamily: 'Satoshi, sans-serif',
              opacity: loyaltySaving ? 0.6 : loyaltyReward.trim() ? 1 : 0.5,
              transition: 'opacity 0.2s',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {loyaltySaving ? 'Saving...' : 'Save Rewards'}
          </button>
          {loyaltySaveConfirm && loyaltySaveConfirm !== 'save_failed' && (
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '12px', fontWeight: 600, color: '#22C55E', textAlign: 'center', marginTop: '6px' }}>
              {loyaltySaveConfirm}
            </p>
          )}
          {loyaltySaveConfirm === 'save_failed' && (
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '12px', fontWeight: 600, color: '#EF4444', textAlign: 'center', marginTop: '6px', cursor: 'pointer' }}
              onClick={handleSaveReward}>
              Save failed — tap to retry
            </p>
          )}
        </div>
      </div>

      {/* Count Display */}
      <div className="flex flex-col items-center justify-center px-6" style={{ padding: '12px 24px' }}>
        <div key={bumpKey} className="count-bump">
          <span className="text-white font-black leading-none"
            style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '64px' }}>
            {formatCount(count)}
          </span>
        </div>
        <p className="text-[#8A8A95] text-sm mt-1" style={{ fontFamily: 'Satoshi, sans-serif' }}>
          inside right now
        </p>
        {peak > 0 && headcount?.updated_at && (
          <p className="text-[#55555F] text-xs mt-1" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            Peak: {formatCount(peak)} at {formatTime(headcount.updated_at)}
          </p>
        )}
      </div>

      {/* ── TONIGHT'S STATS ── */}
      <div className="px-4 pb-3">
        <p style={{
          fontFamily: 'Satoshi, sans-serif',
          fontSize: '11px',
          fontWeight: 600,
          color: 'rgba(255,255,255,0.4)',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          marginBottom: '8px',
        }}>
          {'\uD83D\uDCCA'} TONIGHT'S STATS
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* Peak */}
          <div style={{
            flex: 1,
            background: '#111114',
            border: '1px solid #2a2a2e',
            borderRadius: '12px',
            padding: '12px 8px',
            textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '24px', fontWeight: 800, color: '#FF8200', lineHeight: 1 }}>
              {peak > 0 ? formatCount(peak) : '--'}
            </p>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '11px', color: '#8A8A95', marginTop: '4px' }}>
              Peak
            </p>
          </div>
          {/* Check-ins */}
          <div style={{
            flex: 1,
            background: '#111114',
            border: '1px solid #2a2a2e',
            borderRadius: '12px',
            padding: '12px 8px',
            textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '24px', fontWeight: 800, color: '#FF8200', lineHeight: 1 }}>
              {tonightCheckins !== null ? tonightCheckins : '--'}
            </p>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '11px', color: '#8A8A95', marginTop: '4px' }}>
              Check-ins
            </p>
          </div>
          {/* Avg Rating */}
          <div style={{
            flex: 1,
            background: '#111114',
            border: '1px solid #2a2a2e',
            borderRadius: '12px',
            padding: '12px 8px',
            textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '24px', fontWeight: 800, color: '#FF8200', lineHeight: 1 }}>
              {tonightAvgRating !== null ? `${tonightAvgRating}` : '--'}
            </p>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '11px', color: '#8A8A95', marginTop: '4px' }}>
              Avg Rating
            </p>
          </div>
        </div>

        {/* ── THIS WEEK ── */}
        <p style={{
          fontFamily: 'Satoshi, sans-serif',
          fontSize: '11px',
          fontWeight: 600,
          color: 'rgba(255,255,255,0.4)',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          marginTop: '14px',
          marginBottom: '8px',
        }}>
          THIS WEEK
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* Total visitors */}
          <div style={{
            flex: 1,
            background: '#111114',
            border: '1px solid #2a2a2e',
            borderRadius: '12px',
            padding: '12px 8px',
            textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '24px', fontWeight: 800, color: '#FF8200', lineHeight: 1 }}>
              {weekVisitors !== null ? weekVisitors : '--'}
            </p>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '11px', color: '#8A8A95', marginTop: '4px' }}>
              Total check-ins
            </p>
          </div>
          {/* Avg nightly peak */}
          <div style={{
            flex: 1,
            background: '#111114',
            border: '1px solid #2a2a2e',
            borderRadius: '12px',
            padding: '12px 8px',
            textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '24px', fontWeight: 800, color: '#FF8200', lineHeight: 1 }}>
              {weekAvgPeak !== null ? formatCount(weekAvgPeak) : '--'}
            </p>
            <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '11px', color: '#8A8A95', marginTop: '4px' }}>
              Avg nightly peak
            </p>
          </div>
        </div>
      </div>

      {/* Cover Charge — instant save on tap */}
      <div className="px-4 pb-1">
        <div className="bg-[#111114] border border-[#2A2A30] rounded-xl" style={{ padding: '10px 16px' }}>
          <p className="text-[#8A8A95] text-xs font-bold tracking-wider mb-3" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            {'\uD83D\uDCB5'} COVER
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '8px' }}>
            {COVER_PRESETS.map(preset => {
              const isSelected = selectedCover === preset;
              return (
                <button
                  key={preset}
                  onClick={() => handleCoverTap(preset)}
                  className="active:scale-[0.95] transition-transform"
                  style={{
                    fontFamily: 'Satoshi, sans-serif',
                    minWidth: '60px',
                    height: '40px',
                    borderRadius: '20px',
                    background: isSelected ? '#22C55E' : '#1A1A24',
                    color: isSelected ? 'white' : '#22C55E',
                    fontWeight: 700,
                    fontSize: '16px',
                    border: isSelected ? '2px solid white' : '2px solid #22C55E',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {preset}
                </button>
              );
            })}
          </div>
          <p className="text-[#22C55E] text-sm font-bold text-center" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            Cover: {selectedCover}
          </p>
        </div>
      </div>

      {/* Main Buttons */}
      <div className="px-4 pb-2">
        <div className="flex gap-3">
          <button
            onClick={() => handleExit()}
            className="flex-1 flex flex-col items-center justify-center gap-1 active:scale-[0.97] transition-transform"
            style={{ height: '100px', backgroundColor: '#5C1A1A', borderRadius: '16px' }}
          >
            <Minus size={32} strokeWidth={2.5} className="text-white" />
            <span className="text-white tracking-wider"
              style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '18px', fontWeight: 800 }}>EXIT</span>
          </button>
          <button
            onClick={() => handleEnter()}
            className="flex-1 flex flex-col items-center justify-center gap-1 active:scale-[0.97] transition-transform"
            style={{ height: '100px', backgroundColor: '#00E676', borderRadius: '16px' }}
          >
            <Plus size={32} strokeWidth={2.5} className="text-white" />
            <span className="text-white tracking-wider"
              style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '18px', fontWeight: 800 }}>ENTER</span>
          </button>
        </div>

        {/* Bulk buttons */}
        <div className="clicker-bulk-row">
          <button onClick={() => handleExit(5)} className="clicker-bulk minus">-5</button>
          <button onClick={() => handleExit(2)} className="clicker-bulk minus">-2</button>
          <button onClick={() => handleEnter(2)} className="clicker-bulk plus">+2</button>
          <button onClick={() => handleEnter(5)} className="clicker-bulk plus">+5</button>
        </div>

        {/* Last action */}
        {lastAction && (
          <p className="text-[#55555F] text-xs text-center mt-2" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            Last: {lastAction.type} at {formatTime(lastAction.time)}
          </p>
        )}

        {/* End Night */}
        <div className="mt-3">
          {confirmEnd ? (
            <div className="flex flex-col gap-2">
              <p className="text-[#8A8A95] text-sm text-center" style={{ fontFamily: 'Satoshi, sans-serif' }}>
                End tracking for {venue.name} tonight?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmEnd(false)}
                  style={{
                    flex: 1,
                    height: '48px',
                    borderRadius: '12px',
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontFamily: 'Satoshi, sans-serif',
                    fontSize: '16px',
                    fontWeight: 500,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleEndNight}
                  style={{
                    flex: 1,
                    height: '48px',
                    borderRadius: '12px',
                    background: '#FF2D05',
                    border: 'none',
                    color: 'white',
                    fontFamily: 'Satoshi, sans-serif',
                    fontSize: '16px',
                    fontWeight: 700,
                  }}
                >
                  End Tracking
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmEnd(true)}
              style={{
                width: '100%',
                height: '48px',
                borderRadius: '12px',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: 'rgba(255, 255, 255, 0.5)',
                fontFamily: 'Satoshi, sans-serif',
                fontSize: '16px',
                fontWeight: 500,
                transition: 'border-color 0.2s, color 0.2s',
              }}
            >
              End Night
            </button>
          )}
        </div>

        {/* Cover Pricing */}
        <CoverPortalSection venue={venue} />

        {/* Tonight's Special */}
        <div style={{ marginTop: '14px', padding: '0 0 20px' }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}>
            {'\uD83C\uDF89'} TONIGHT'S SPECIAL
          </div>
          <input
            type="text"
            value={specialText}
            onChange={(e) => setSpecialText(e.target.value)}
            placeholder="e.g. $3 wells til midnight"
            style={{
              width: '100%',
              height: '44px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '0 16px',
              fontSize: '15px',
              color: 'white',
              outline: 'none',
              boxSizing: 'border-box' as const,
              marginBottom: '8px',
            }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleSetSpecial}
              style={{
                flex: 3,
                height: '44px',
                borderRadius: '12px',
                background: '#FF8200',
                color: 'white',
                fontWeight: 700,
                fontSize: '14px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              SET SPECIAL
            </button>
            <button
              onClick={handleClearSpecial}
              style={{
                flex: 1,
                height: '44px',
                borderRadius: '12px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.2)',
                color: 'rgba(255,255,255,0.5)',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              CLEAR
            </button>
          </div>
          {specialConfirm && (
            <div style={{
              color: '#22C55E',
              fontSize: '13px',
              fontWeight: 600,
              textAlign: 'center',
              marginTop: '6px',
            }}>
              {specialConfirm}
            </div>
          )}
        </div>

        {/* The Drop */}
        <div style={{ marginTop: '14px', padding: '0 0 24px' }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}>
            {'\uD83D\uDD25'} THE DROP
          </div>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value.slice(0, 140))}
              placeholder="e.g. Cover just dropped to FREE! Come thru"
              maxLength={140}
              style={{
                width: '100%',
                height: '44px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                padding: '0 50px 0 16px',
                fontSize: '15px',
                color: 'white',
                outline: 'none',
                boxSizing: 'border-box' as const,
              }}
            />
            <span style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '11px',
              color: broadcastText.length > 120 ? '#FF8200' : 'rgba(255,255,255,0.25)',
              fontWeight: 600,
              pointerEvents: 'none',
            }}>
              {140 - broadcastText.length}
            </span>
          </div>
          <button
            onClick={handleSendUpdate}
            style={{
              width: '100%',
              height: '44px',
              borderRadius: '12px',
              background: '#FF8200',
              color: 'white',
              fontWeight: 700,
              fontSize: '14px',
              border: 'none',
              cursor: 'pointer',
              marginTop: '8px',
            }}
          >
            DROP IT
          </button>
          {broadcastConfirm && (
            <div style={{
              color: '#22C55E',
              fontSize: '13px',
              fontWeight: 600,
              textAlign: 'center',
              marginTop: '6px',
            }}>
              {broadcastConfirm}
            </div>
          )}

          {/* Live feed */}
          {updates.length > 0 && (
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {updates.map(u => (
                <div
                  key={u.id}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderLeft: u.venue_id === venue.id ? '3px solid #FF8200' : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '10px',
                    padding: '8px 12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'white', fontFamily: 'Satoshi, sans-serif' }}>
                      {u.venue_name}
                    </span>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
                      {timeAgo(u.created_at)}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', margin: 0, lineHeight: '1.3' }}>
                    {u.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Event Creator */}
        <EventCreator venue={venue} />
      </div>
    </div>
  );
}
