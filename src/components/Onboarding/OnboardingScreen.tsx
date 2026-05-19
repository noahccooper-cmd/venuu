import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Geolocation } from '@capacitor/geolocation';
import { Bell, MapPin, Loader2 } from 'lucide-react';

const FONT = 'Satoshi, sans-serif';

type OnboardingStep = 'welcome' | 'signin' | 'notifications' | 'location';

interface OnboardingScreenProps {
  onComplete: () => void;
  signInWithApple: () => Promise<{ error: Error | null | unknown }>;
}

export function OnboardingScreen({ onComplete, signInWithApple }: OnboardingScreenProps) {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [transitioning, setTransitioning] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState('');
  const [permLoading, setPermLoading] = useState(false);

  const goToStep = useCallback((next: OnboardingStep) => {
    setTransitioning(true);
    setTimeout(() => {
      setStep(next);
      setTransitioning(false);
    }, 200);
  }, []);

  const completeOnboarding = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleAppleSignIn = useCallback(async () => {
    setSigningIn(true);
    setSignInError('');
    const { error } = await signInWithApple();
    setSigningIn(false);
    if (error) {
      const message = error instanceof Error ? error.message : 'Sign in failed';
      if (message.includes('cancel') || message.includes('Cancel')) return;
      setSignInError(message);
    } else {
      goToStep('notifications');
    }
  }, [signInWithApple, goToStep]);

  const handleEnableNotifications = useCallback(async () => {
    setPermLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const result = await PushNotifications.requestPermissions();
        if (result.receive === 'granted') {
          await PushNotifications.register();
        }
      }
    } catch (err) {
      console.warn('[onboarding] Notification permission error:', err);
    }
    setPermLoading(false);
    goToStep('location');
  }, [goToStep]);

  const handleEnableLocation = useCallback(async () => {
    setPermLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        await Geolocation.requestPermissions({ permissions: ['location'] });
      }
    } catch (err) {
      console.warn('[onboarding] Location permission error:', err);
    }
    setPermLoading(false);
    completeOnboarding();
  }, [completeOnboarding]);

  // Shared styles
  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: '#050507',
    fontFamily: FONT,
    display: 'flex',
    flexDirection: 'column',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  };

  const contentStyle: React.CSSProperties = {
    opacity: transitioning ? 0 : 1,
    transition: 'opacity 200ms ease',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  };

  const ctaButtonStyle: React.CSSProperties = {
    width: '100%',
    height: '52px',
    borderRadius: '12px',
    background: '#FF8200',
    color: '#fff',
    fontSize: '17px',
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
    fontFamily: FONT,
    WebkitTapHighlightColor: 'transparent',
  };

  const skipLinkStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#55555F',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: FONT,
    cursor: 'pointer',
    minHeight: '44px',
    WebkitTapHighlightColor: 'transparent',
  };

  /* ── STEP 1: WELCOME ── */
  if (step === 'welcome') {
    return (
      <div style={containerStyle}>
        <div style={contentStyle}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px' }}>
            <h1 style={{ color: '#FF8200', fontSize: '52px', fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, margin: 0 }}>
              venuu
            </h1>
            <p style={{ color: '#fff', fontSize: '20px', fontWeight: 600, marginTop: '20px', textAlign: 'center', lineHeight: 1.3 }}>
              See where everyone's going.
            </p>
            <p style={{ color: '#fff', fontSize: '20px', fontWeight: 600, marginTop: '4px', textAlign: 'center', lineHeight: 1.3 }}>
              Right now.
            </p>
            <p style={{ color: '#8A8A95', fontSize: '15px', fontWeight: 400, marginTop: '16px', textAlign: 'center', lineHeight: 1.4, maxWidth: '280px' }}>
              Live headcounts, covers, specials, and events at every bar near campus.
            </p>
          </div>
          <div style={{ padding: '16px 24px', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
            <button
              type="button"
              onClick={() => goToStep('signin')}
              className="active:scale-[0.98] transition-transform"
              style={ctaButtonStyle}
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── STEP 2: SIGN IN ── */
  if (step === 'signin') {
    return (
      <div style={containerStyle}>
        <div style={{ ...contentStyle, alignItems: 'center', justifyContent: 'center', padding: '0 32px' }}>
          <h1 style={{ color: '#FF8200', fontSize: '32px', fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1, margin: '0 0 8px' }}>
            venuu
          </h1>
          <p style={{ color: '#8A8A95', fontSize: '15px', textAlign: 'center', marginBottom: '40px', maxWidth: '260px' }}>
            Sign in to check in, earn rewards, and get notified about deals
          </p>

          {/* Apple Sign In Button */}
          <button
            type="button"
            onClick={handleAppleSignIn}
            disabled={signingIn}
            className="active:scale-[0.98] transition-all"
            style={{
              width: '100%',
              maxWidth: '320px',
              height: '52px',
              borderRadius: '12px',
              background: '#000',
              border: '1px solid #2A2A30',
              color: '#fff',
              fontSize: '16px',
              fontWeight: 600,
              fontFamily: FONT,
              cursor: signingIn ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              opacity: signingIn ? 0.6 : 1,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {signingIn ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                <svg width="18" height="22" viewBox="0 0 18 22" fill="white">
                  <path d="M17.0703 17.3047C16.7812 18.0078 16.4375 18.6562 16.0391 19.2578C15.4922 20.0703 15.0469 20.6406 14.707 20.9688C14.1758 21.4922 13.6055 21.7617 12.9922 21.7812C12.5547 21.7812 12.0312 21.6562 11.4258 21.4023C10.8164 21.1523 10.2578 21.0273 9.74609 21.0273C9.20703 21.0273 8.62891 21.1523 8.01172 21.4023C7.39062 21.6562 6.89844 21.7852 6.52734 21.793C5.94141 21.8086 5.35938 21.5312 4.78125 20.9609C4.41406 20.6055 3.94922 20.0117 3.39062 19.1797C2.78906 18.2891 2.29688 17.2578 1.91016 16.082C1.49609 14.8164 1.28906 13.5898 1.28906 12.4023C1.28906 11.0508 1.56641 9.88281 2.12109 8.90234C2.55469 8.12891 3.13281 7.51953 3.85938 7.07422C4.58594 6.62891 5.37109 6.40234 6.21484 6.39062C6.67969 6.39062 7.28516 6.53516 8.03516 6.82031C8.78125 7.10547 9.26172 7.25 9.47266 7.25C9.62891 7.25 10.1641 7.07812 11.0703 6.73828C11.9258 6.42578 12.6484 6.29688 13.2422 6.34766C14.9102 6.48438 16.1602 7.16406 16.9883 8.39453C15.5039 9.30469 14.7695 10.5703 14.7852 12.1875C14.8008 13.4609 15.2891 14.5273 16.2461 15.3828C16.6797 15.7891 17.1602 16.1055 17.6914 16.332C17.4961 16.8789 17.2891 17.4023 17.0703 17.3047ZM13.3516 0.441406C13.3516 1.44141 12.9883 2.37109 12.2656 3.22656C11.3945 4.24219 10.3398 4.82422 9.19922 4.73438C9.18359 4.61328 9.17578 4.48438 9.17578 4.34766C9.17578 3.39062 9.59375 2.36328 10.3281 1.52734C10.6953 1.10547 11.1602 0.75 11.7227 0.460938C12.2812 0.175781 12.8125 0.0195312 13.3125 0C13.3281 0.148438 13.3516 0.296875 13.3516 0.441406Z" />
                </svg>
                Sign in with Apple
              </>
            )}
          </button>

          {signInError && (
            <p style={{ color: '#FF2D05', fontSize: '13px', fontWeight: 600, textAlign: 'center', marginTop: '12px' }}>
              {signInError}
            </p>
          )}

          <button
            type="button"
            onClick={completeOnboarding}
            style={{ ...skipLinkStyle, marginTop: '24px' }}
          >
            Continue without signing in
          </button>
        </div>
      </div>
    );
  }

  /* ── STEP 3: NOTIFICATION PERMISSION ── */
  if (step === 'notifications') {
    return (
      <div style={containerStyle}>
        <div style={{ ...contentStyle, alignItems: 'center', justifyContent: 'center', padding: '0 32px' }}>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            background: 'rgba(255, 130, 0, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '24px',
          }}>
            <Bell size={40} color="#FF8200" strokeWidth={1.5} />
          </div>
          <h2 style={{ color: '#fff', fontSize: '24px', fontWeight: 700, margin: '0 0 10px', textAlign: 'center' }}>
            Never miss a deal
          </h2>
          <p style={{ color: '#8A8A95', fontSize: '15px', textAlign: 'center', lineHeight: 1.5, maxWidth: '300px', margin: '0 0 40px' }}>
            Get notified when bars drop specials and events go live near you
          </p>

          <button
            type="button"
            onClick={handleEnableNotifications}
            disabled={permLoading}
            className="active:scale-[0.98] transition-transform"
            style={{ ...ctaButtonStyle, maxWidth: '320px', opacity: permLoading ? 0.6 : 1 }}
          >
            {permLoading ? <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto' }} /> : 'Enable Notifications'}
          </button>

          <button
            type="button"
            onClick={() => goToStep('location')}
            style={{ ...skipLinkStyle, marginTop: '16px' }}
          >
            Maybe Later
          </button>
        </div>
      </div>
    );
  }

  /* ── STEP 4: LOCATION PERMISSION ── */
  return (
    <div style={containerStyle}>
      <div style={{ ...contentStyle, alignItems: 'center', justifyContent: 'center', padding: '0 32px' }}>
        <div style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: 'rgba(255, 130, 0, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
        }}>
          <MapPin size={40} color="#FF8200" strokeWidth={1.5} />
        </div>
        <h2 style={{ color: '#fff', fontSize: '24px', fontWeight: 700, margin: '0 0 10px', textAlign: 'center' }}>
          Find bars near you
        </h2>
        <p style={{ color: '#8A8A95', fontSize: '15px', textAlign: 'center', lineHeight: 1.5, maxWidth: '300px', margin: '0 0 40px' }}>
          venuu uses your location to show nearby venues and verify check-ins
        </p>

        <button
          type="button"
          onClick={handleEnableLocation}
          disabled={permLoading}
          className="active:scale-[0.98] transition-transform"
          style={{ ...ctaButtonStyle, maxWidth: '320px', opacity: permLoading ? 0.6 : 1 }}
        >
          {permLoading ? <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto' }} /> : 'Enable Location'}
        </button>

        <button
          type="button"
          onClick={completeOnboarding}
          style={{ ...skipLinkStyle, marginTop: '16px' }}
        >
          Maybe Later
        </button>
      </div>
    </div>
  );
}
