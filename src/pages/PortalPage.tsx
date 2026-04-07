import { useEffect, useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { usePortal } from '../hooks/usePortal';
import { PortalLogin } from '../components/Portal/PortalLogin';
import { ClickerView } from '../components/Portal/ClickerView';
import { SecurityPortal } from '../components/Portal/SecurityPortal';
import { FratPortal } from '../components/Portal/FratPortal';
import { supabase, envReady } from '../lib/supabase';
import type { SecurityOrganization } from '../lib/types';

interface PortalPageProps {
  onExit?: () => void;
}

const FONT = 'Satoshi, sans-serif';
const ORG_KEY = 'venuu_org_code';

export function PortalPage({ onExit }: PortalPageProps) {
  const {
    venue,
    headcount,
    loading,
    error,
    lastAction,
    savedVenueId,
    endSummary,
    loginWithPin,
    loadVenueById,
    handleEnter,
    handleExit,
    updateCover,
    endNight,
    disconnect,
  } = usePortal();

  // Venue list for dropdown
  const [venueList, setVenueList] = useState<{ id: string; name: string; city: string }[]>([]);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  // Security org state
  const [loginMode, setLoginMode] = useState<'venue' | 'security'>(() => {
    const saved = localStorage.getItem('venuu_portal_mode');
    return saved === 'security' ? 'security' : 'venue';
  });
  const [secOrg, setSecOrg] = useState<SecurityOrganization | null>(null);

  useEffect(() => {
    if (!envReady) return;
    supabase
      .from('venues')
      .select('id, name, city')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setVenueList(data as { id: string; name: string; city: string }[]);
      });
  }, []);

  // Restore saved org session
  useEffect(() => {
    const savedCode = localStorage.getItem(ORG_KEY);
    if (savedCode && !secOrg) {
      supabase.from('security_organizations').select('*').eq('org_code', savedCode).eq('is_active', true).maybeSingle()
        .then(({ data }) => { if (data) setSecOrg(data as SecurityOrganization); });
    }
  }, [secOrg]);

  const cities = [...new Set(venueList.map(v => v.city))].sort();
  const filteredVenues = selectedCity ? venueList.filter(v => v.city === selectedCity) : [];

  // Auto-restore venue session
  useEffect(() => {
    if (savedVenueId && !venue && !loading) loadVenueById(savedVenueId);
  }, [savedVenueId, venue, loading, loadVenueById]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    if (onExit) onExit();
  }, [disconnect, onExit]);

  const handleOrgLogin = useCallback(async (code: string): Promise<{ error: string | null }> => {
    if (!code.trim()) return { error: 'Enter a code' };
    const { data, error: err } = await supabase
      .from('security_organizations')
      .select('*')
      .ilike('org_code', code.trim())
      .eq('is_active', true)
      .maybeSingle();
    if (err || !data) return { error: 'Invalid code' };
    const org = data as SecurityOrganization;
    setSecOrg(org);
    localStorage.setItem(ORG_KEY, org.org_code);
    return { error: null };
  }, []);

  const handleOrgDisconnect = useCallback(() => {
    setSecOrg(null);
    localStorage.removeItem(ORG_KEY);
  }, []);

  // If security org is logged in, show security portal
  if (secOrg) {
    return <SecurityPortal org={secOrg} onDisconnect={handleOrgDisconnect} />;
  }

  // If venue is logged in, show appropriate portal
  if (venue) {
    if (venue.category === 'fraternity') {
      return (
        <FratPortal
          venue={venue}
          headcount={headcount}
          lastAction={lastAction}
          endSummary={endSummary}
          onEnter={handleEnter}
          onExit={handleExit}
          onEndNight={endNight}
          onDisconnect={handleDisconnect}
        />
      );
    }
    return (
      <ClickerView
        venue={venue}
        headcount={headcount}
        lastAction={lastAction}
        endSummary={endSummary}
        onEnter={handleEnter}
        onExit={handleExit}
        onEndNight={endNight}
        onUpdateCover={updateCover}
        onDisconnect={handleDisconnect}
      />
    );
  }

  // Login screen — unified with mode toggle inside PortalLogin
  return (
    <div className="min-h-screen bg-[#050507] flex flex-col">
      {onExit && (
        <div className="absolute top-4 left-4 z-10">
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 text-[#8A8A95] hover:text-white transition-colors"
            style={{ fontFamily: FONT }}
          >
            <ArrowLeft size={18} strokeWidth={1.5} />
            <span className="text-sm">Back</span>
          </button>
        </div>
      )}

      <PortalLogin
        cities={cities}
        selectedCity={selectedCity}
        onCityChange={setSelectedCity}
        venues={filteredVenues}
        loading={loading}
        error={error}
        onSubmit={loginWithPin}
        onSecurityLogin={handleOrgLogin}
        loginMode={loginMode}
        onToggleMode={(mode) => { setLoginMode(mode); localStorage.setItem('venuu_portal_mode', mode); }}
      />
    </div>
  );
}
