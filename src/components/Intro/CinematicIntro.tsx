import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { ColdOpenPhase, ColdOpenMode } from '../../hooks/useColdOpen';
import type { CityAggregate } from '../../hooks/useCityAggregates';
import type { CityKey } from '../../lib/constants';
import { CITIES } from '../../lib/constants';

/**
 * CinematicIntro — the visual layer for the 7-phase cold open.
 *
 * Sits at z-index 10000 over the live MapView. Drives `map.flyTo`
 * calls in lockstep with phase transitions; lets the map underneath
 * become visible by fading the overlay's background to transparent
 * once the globe has emerged.
 *
 * The component is rendered conditionally by App.tsx based on
 * useColdOpen's `active` flag. When phase becomes 'done', we call
 * onComplete() which tells the hook to flip active=false → unmount.
 */

interface CinematicIntroProps {
  phase: ColdOpenPhase;
  mode: ColdOpenMode;
  onSkip: () => void;
  onComplete: () => void;
  cityAggregates: CityAggregate[];
  totalPeopleOut: number;
  targetCity: CityKey;
  targetCityName: string;
  mapRef: RefObject<MapboxMap | null>;
}

/** When in this set, the overlay accepts taps and forwards onSkip(). */
const SKIPPABLE_PHASES: ReadonlySet<ColdOpenPhase> = new Set([
  'globe-emerge', 'constellation', 'identify', 'descent', 'bubble-bloom',
]);

export function CinematicIntro({
  phase,
  mode,
  onSkip,
  onComplete,
  cityAggregates,
  totalPeopleOut,
  targetCity,
  targetCityName,
  mapRef,
}: CinematicIntroProps) {
  // Ring projection — DOM circle that tracks the user's city dot
  // in screen space during the IDENTIFY phase. We re-project on every
  // map move so panning/zooming during identify keeps it locked.
  const [ringScreen, setRingScreen] = useState<{ x: number; y: number } | null>(null);

  const targetCenter = CITIES[targetCity]?.center;
  const flyToFiredRef = useRef<Partial<Record<ColdOpenPhase, boolean>>>({});

  // ─── Drive map.flyTo per phase (only fires once per phase per intro run) ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (flyToFiredRef.current[phase]) return;

    if (phase === 'globe-emerge') {
      flyToFiredRef.current[phase] = true;
      try {
        map.flyTo({
          center: [-90, 20],
          zoom: 0.8,
          pitch: 0,
          bearing: 0,
          duration: mode === 'shortened' ? 350 : 1400,
          essential: true,
        });
      } catch (err) {
        console.warn('[intro] globe-emerge flyTo failed:', err);
      }
    } else if (phase === 'identify' && targetCenter) {
      flyToFiredRef.current[phase] = true;
      try {
        map.flyTo({
          center: [targetCenter.lng, targetCenter.lat],
          zoom: 1.2,
          duration: 700,
          essential: true,
        });
      } catch (err) {
        console.warn('[intro] identify flyTo failed:', err);
      }
    } else if (phase === 'descent' && targetCenter) {
      flyToFiredRef.current[phase] = true;
      try {
        map.flyTo({
          center: [targetCenter.lng, targetCenter.lat],
          zoom: 13.5,
          pitch: 45,
          bearing: -8,
          duration: mode === 'shortened' ? 850 : 2600,
          curve: 1.42,
          essential: true,
        });
      } catch (err) {
        console.warn('[intro] descent flyTo failed:', err);
      }
    }
  }, [phase, mode, mapRef, targetCenter]);

  // ─── Identify ring screen tracking ───
  useEffect(() => {
    if (phase !== 'identify' || !targetCenter) {
      setRingScreen(null);
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    const project = () => {
      try {
        const p = map.project([targetCenter.lng, targetCenter.lat]);
        setRingScreen({ x: p.x, y: p.y });
      } catch {
        // map can briefly be in an unprojectable state during a flyTo
      }
    };
    project();
    map.on('move', project);
    return () => {
      map.off('move', project);
    };
  }, [phase, mapRef, targetCenter]);

  // ─── Phase 7 — drain to inactive ───
  useEffect(() => {
    if (phase !== 'done') return;
    onComplete();
  }, [phase, onComplete]);

  const isLogo = phase === 'logo';
  const isStarfield = phase !== 'logo' && phase !== 'inactive' && phase !== 'done';
  const showCounter = phase === 'constellation' || phase === 'identify';
  const showIdentify = phase === 'identify';
  const showTapHint = phase === 'bubble-bloom';
  const starfieldFading = phase === 'descent' || phase === 'bubble-bloom';

  function handleClick() {
    if (!SKIPPABLE_PHASES.has(phase)) return;
    onSkip();
  }

  return (
    <div
      className={`cinematic-intro-root phase-${phase}`}
      onClick={handleClick}
      role="presentation"
    >
      {/* Phase 2+ — atmospheric starfield */}
      {isStarfield && (
        <div className={`intro-starfield${starfieldFading ? ' fading' : ''}`} aria-hidden />
      )}

      {/* Phase 1 — Logo + tagline */}
      {isLogo && (
        <div className="intro-logo-wrap">
          <div className="intro-logo">venuu</div>
          <div className="intro-tagline">know before you go</div>
        </div>
      )}

      {/* Phase 3 + 4 — counter overlay (re-renders gracefully when totals tick) */}
      {showCounter && (
        <div className="intro-counter-overlay" key={`counter-${phase}`}>
          <div className="intro-counter-main">
            {totalPeopleOut.toLocaleString()} out tonight
          </div>
          <div className="intro-counter-sub">
            across {cityAggregates.length} {cityAggregates.length === 1 ? 'city' : 'cities'}
          </div>
        </div>
      )}

      {/* Phase 4 — identify ring + city name */}
      {showIdentify && ringScreen && (
        <div
          className="intro-identify-ring"
          aria-hidden
          style={{ left: ringScreen.x, top: ringScreen.y }}
        />
      )}
      {showIdentify && (
        <div className="intro-identify-text" key="identify">
          <div className="intro-identify-city">{targetCityName}</div>
          <div className="intro-identify-sub">start exploring</div>
        </div>
      )}

      {/* Phase 6 — tap hint (auto-dismisses via CSS keyframe stack) */}
      {showTapHint && (
        <div className="intro-tap-hint" key="tap-hint">
          tap a venue to see what's happening
        </div>
      )}
    </div>
  );
}
