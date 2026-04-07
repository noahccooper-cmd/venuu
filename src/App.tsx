import { useState, useEffect, useMemo, useCallback } from 'react';
import { envReady } from './lib/supabase';
import { useCity } from './hooks/useCity';
import { useVenues } from './hooks/useVenues';
import { useHeadcounts } from './hooks/useHeadcounts';
import { useAuth } from './hooks/useAuth';
import { Header } from './components/Layout/Header';
import { BottomNav, type Tab } from './components/Layout/BottomNav';
import { TonightPage } from './pages/TonightPage';
import { PrecapPage } from './pages/PrecapPage';
import { PortalPage } from './pages/PortalPage';
import { SignInSheet } from './components/Auth/SignInSheet';
import { NicknameScreen } from './components/Auth/NicknameScreen';
import { ProfileOverlay } from './components/Profile/ProfileOverlay';
import { ProfileScreen } from './components/Profile/ProfileScreen';
import { OnboardingScreen } from './components/Onboarding/OnboardingScreen';
import { PushBanner } from './components/Notifications/PushBanner';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useEvents } from './hooks/useEvents';
import { useUserLocation } from './hooks/useUserLocation';
import { useCoverPricing } from './hooks/useCoverPricing';
import { useCoverPurchase } from './hooks/useCoverPurchase';
import type { Venue, Headcount } from './lib/types';

export default function App() {
  const [tab, setTab] = useState<Tab>('tonight');
  const [focusedVenue, setFocusedVenue] = useState<{ venue: Venue; headcount: Headcount | null } | null>(null);
  const username = localStorage.getItem('venue_username') ?? 'Guest';
  const [showSplash, setShowSplash] = useState(true);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('venuu_onboarded') === 'true');
  const [showSignIn, setShowSignIn] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const { city, switchCity } = useCity();
  const { user, profile, needsOnboard, signInWithApple, sendMagicLink, createProfile, signOut } = useAuth();
  const { venues, error: venuesError, refetch: refetchVenues } = useVenues(city);
  const { headcounts, pulsedVenueId } = useHeadcounts(city);
  const { events } = useEvents(city);
  const userLocation = useUserLocation();
  const { coverPrices } = useCoverPricing(city);
  const { purchasing, myPurchases, purchaseCover, fetchMyPurchases } = useCoverPurchase(user?.id ?? null);

  // Push notifications — only activates on native iOS when signed in
  usePushNotifications(user?.id ?? null, city);

  // Fetch user's cover purchases on sign-in
  useEffect(() => { if (user?.id) fetchMyPurchases(); }, [user?.id, fetchMyPurchases]);

  const handleAskVenny = useCallback((venue: Venue, headcount: Headcount | null) => {
    setFocusedVenue({ venue, headcount });
    setTab('precap');
  }, []);

  // Splash: always show for 2.5s, then fade out over 500ms (CSS transition)
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Build counts map from headcounts — any venue with count > 0 tonight shows on map.
  // Headcounts persist for the entire night regardless of whether the bouncer is still connected.
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [venueId, hc] of Object.entries(headcounts)) {
      if (hc.current_count > 0) {
        map[venueId] = hc.current_count;
      }
    }
    return map;
  }, [headcounts]);

  // Total count across all venues with headcount tonight
  const totalCount = useMemo(() => {
    return Object.values(counts).reduce((sum, c) => sum + c, 0);
  }, [counts]);

  // Set of venue IDs with a live bouncer actively tracking (green LIVE badge).
  // This only controls the LIVE badge — the headcount and glow stay regardless.
  const liveVenueIds = useMemo(() => {
    return new Set(
      Object.entries(headcounts)
        .filter(([, hc]) => hc.is_live && hc.current_count > 0)
        .map(([id]) => id)
    );
  }, [headcounts]);

  // Missing env error screen
  if (!envReady) {
    return (
      <div className="min-h-screen bg-[#050507] flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-white font-black text-2xl tracking-[0.05em] mb-4"
            style={{ fontFamily: 'Satoshi, sans-serif' }}>
            venuu
          </h1>
          <div className="bg-[#111114] border border-[#2A2A30] rounded-xl p-5">
            <p className="text-[#FF5E1A] font-medium text-sm mb-2" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              Missing configuration
            </p>
            <p className="text-[#8A8A95] text-sm" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              Check your .env file.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // City onboarding — first open (after splash fades)
  if (!onboarded && !showSplash) {
    return (
      <OnboardingScreen
        onComplete={(selectedCity) => {
          switchCity(selectedCity);
          localStorage.setItem('venuu_onboarded', 'true');
          setOnboarded(true);
        }}
        signInWithApple={signInWithApple}
      />
    );
  }

  // Connection error — venues failed to load
  if (venuesError && venues.length === 0) {
    return (
      <div className="min-h-screen bg-[#050507] flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-white font-black text-2xl tracking-[0.05em] mb-4"
            style={{ fontFamily: 'Satoshi, sans-serif' }}>
            venuu
          </h1>
          <p className="text-[#8A8A95] text-sm mb-4" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            Having trouble connecting...
          </p>
          <button
            type="button"
            onClick={refetchVenues}
            className="px-6 rounded-xl text-white font-bold text-sm active:scale-[0.97] transition-transform"
            style={{ fontFamily: 'Satoshi, sans-serif', background: '#FF8200', height: 48, minWidth: 120, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050507] relative">
      <Header
        city={city}
        onCityChange={switchCity}
        totalCount={totalCount}
        username={username}
        activeTab={tab}
        onAvatarPress={() => {
          if (user) {
            setShowProfile(true);
          } else {
            setShowSignIn(true);
          }
        }}
      />

      {/* Tonight tab — map + venue cards */}
      <div className={tab === 'tonight' ? '' : 'hidden'}>
        <TonightPage
          city={city}
          venues={venues}
          counts={counts}
          headcounts={headcounts}
          liveVenueIds={liveVenueIds}
          pulsedVenueId={pulsedVenueId}
          events={events}
          userLocation={userLocation}
          coverPrices={coverPrices}
          purchasing={purchasing}
          myPurchases={myPurchases as Map<string, { qr_code: string }>}
          onBuyCover={purchaseCover}
          username={username}
          userId={user?.id ?? null}
          onSignIn={() => setShowSignIn(true)}
          onCityChange={switchCity}
          onAskVenny={handleAskVenny}
        />
      </div>

      {/* Precap tab — AI nightlife assistant */}
      <div className={tab === 'precap' ? '' : 'hidden'}>
        <PrecapPage
          key={focusedVenue?.venue.id ?? 'default'}
          venues={venues}
          headcounts={headcounts}
          username={username}
          focusedVenue={focusedVenue}
        />
      </div>

      {/* Portal tab — fullscreen clicker */}
      <div className={tab === 'portal' ? '' : 'hidden'}>
        <PortalPage onExit={() => setTab('tonight')} />
      </div>

      <PushBanner />
      <BottomNav active={tab} onChange={setTab} />

      {/* Sign In Sheet — shown when not authenticated */}
      {showSignIn && (
        <SignInSheet
          onClose={() => setShowSignIn(false)}
          onSignedIn={() => setShowSignIn(false)}
          signInWithApple={signInWithApple}
        />
      )}

      {/* Full-screen profile — authenticated user with profile */}
      {showProfile && user && profile && !needsOnboard && (
        <ProfileScreen
          profile={profile}
          onClose={() => setShowProfile(false)}
          onSignOut={signOut}
        />
      )}

      {/* Full-screen nickname setup — shown automatically after sign-in if no profile */}
      {user && needsOnboard && (
        <NicknameScreen
          onComplete={(username) => createProfile(username, 2027, city)}
        />
      )}

      {/* Profile Overlay — sign-in prompt for guests */}
      <ProfileOverlay
        open={showProfile && !user}
        onClose={() => setShowProfile(false)}
        isLoggedIn={false}
        needsOnboard={false}
        onSendMagicLink={sendMagicLink}
        onCompleteOnboard={createProfile}
        onBrowseAsGuest={() => setShowProfile(false)}
      />

      {/* Splash overlay — fades out after 2.5s */}
      <div
        className="splash-screen"
        style={{
          opacity: showSplash ? 1 : 0,
          pointerEvents: showSplash ? 'all' : 'none',
        }}
      >
        <h1 className="splash-logo">venuu</h1>
        <p className="splash-tagline">Your Cheat Code for Nightlife</p>
      </div>
    </div>
  );
}
