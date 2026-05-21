import { useEffect, useState, useRef } from 'react';
import { useCityPulse } from '../../hooks/useCityPulse';
import './CityPulseLine.css';

interface CityPulseLineProps {
  city: string | null;
}

const CITY_DISPLAY: Record<string, string> = {
  'knoxville': 'Knoxville',
  'tampa': 'Tampa',
  'st_petersburg': 'St. Pete',
};

function dayOfWeekShort(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'short' });
}

/** Compact 12-hr time like "8:47p" — no space between minutes and a/p. */
function formatTimeShort(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).replace(/\s/g, '').toLowerCase();
}

/** 5pm through 2am — when the bars are open and the city is alive. */
function isWithinNightlifeHours(): boolean {
  const h = new Date().getHours();
  return h >= 17 || h <= 2;
}

function describePulse(avgDelta: number): { label: string; tone: string } {
  if (avgDelta >= 20) return { label: 'running hot', tone: 'hot' };
  if (avgDelta >= 5) return { label: 'warming up', tone: 'warm' };
  if (avgDelta <= -20) return { label: 'cooling off', tone: 'cool' };
  if (avgDelta <= -5) return { label: 'slow start', tone: 'mild-cool' };
  return { label: 'on pace', tone: 'neutral' };
}

/**
 * CityPulseLine — fixed top-of-map narration showing the city-wide
 * average delta vs forecast. Reads `city_pulse` view (≥35-confidence
 * venue rollup) and tween-animates the displayed delta.
 *
 * Always renders something (Phase 5.1 update): when there's no
 * confident data we show a "watching" line with day + time +
 * "bars open at 5p" / "reading the city…" depending on the hour.
 * The bar's job is to make the city feel observed, not to disappear
 * when nothing's happening.
 */
export function CityPulseLine({ city }: CityPulseLineProps) {
  const { pulse } = useCityPulse(city);
  const [animatedDelta, setAnimatedDelta] = useState<number | null>(null);
  const prevDeltaRef = useRef<number | null>(null);

  useEffect(() => {
    if (pulse?.avg_delta_pct == null) return;
    const target = pulse.avg_delta_pct;
    const start = prevDeltaRef.current ?? target;
    const duration = 900;
    const startTime = performance.now();

    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedDelta(start + (target - start) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prevDeltaRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pulse?.avg_delta_pct]);

  if (!city) return null;

  const cityName = CITY_DISPLAY[city] ?? city;
  const dayShort = dayOfWeekShort();
  const timeStr = formatTimeShort();
  const hasLiveData = !!pulse && pulse.venues_with_signal > 0;

  if (hasLiveData) {
    const delta = animatedDelta ?? pulse.avg_delta_pct;
    const sign = delta >= 0 ? '+' : '';
    const tone = describePulse(pulse.avg_delta_pct);
    return (
      <div className={`city-pulse-line city-pulse-line--${tone.tone}`}>
        <div className="city-pulse-line__primary">
          <span className="city-pulse-line__city">{cityName}</span>
          <span className="city-pulse-line__separator" aria-hidden>·</span>
          <span className="city-pulse-line__day">{dayShort}</span>
          <span className="city-pulse-line__time">{timeStr}</span>
          <span className="city-pulse-line__separator" aria-hidden>·</span>
          <span className="city-pulse-line__delta">{sign}{delta.toFixed(0)}%</span>
          <span className="city-pulse-line__verdict">{tone.label}</span>
          {pulse.surging_count > 0 && (
            <>
              <span className="city-pulse-line__separator" aria-hidden>·</span>
              <span className="city-pulse-line__surging">{pulse.surging_count}↑ surging</span>
            </>
          )}
        </div>
      </div>
    );
  }

  // Off-hours / no-data — bar still narrates the city, just calmly.
  const isNightlifeHour = isWithinNightlifeHours();
  return (
    <div className="city-pulse-line city-pulse-line--watching">
      <div className="city-pulse-line__primary">
        <span className="city-pulse-line__city">{cityName}</span>
        <span className="city-pulse-line__separator" aria-hidden>·</span>
        <span className="city-pulse-line__day">{dayShort}</span>
        <span className="city-pulse-line__time">{timeStr}</span>
        <span className="city-pulse-line__separator" aria-hidden>·</span>
        <span className="city-pulse-line__verdict">
          {isNightlifeHour ? 'reading the city…' : 'bars open at 5p · watching'}
        </span>
      </div>
    </div>
  );
}
