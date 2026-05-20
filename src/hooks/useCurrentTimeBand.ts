import { useEffect, useState } from 'react';

export type TimeBand = 'wk_early' | 'wk_peak' | 'wknd_early' | 'wknd_peak';

/**
 * Returns the current time band, computed client-side to match the
 * Postgres current_time_band() function.
 *
 * Bands (Eastern time):
 *   wk_early    Mon-Thu  5pm-9pm
 *   wk_peak     Mon-Thu  9pm-close (4am)
 *   wknd_early  Fri-Sat  5pm-9pm
 *   wknd_peak   Fri-Sat  9pm-close (4am) + Sun early-morning
 *
 * Updates every 5 minutes so band transitions trigger a re-render.
 */
export function getCurrentTimeBand(now: Date = new Date()): TimeBand {
  // Convert to America/New_York using Intl
  const nyParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const weekday = nyParts.find(p => p.type === 'weekday')?.value ?? 'Mon';
  const hourStr = nyParts.find(p => p.type === 'hour')?.value ?? '0';
  const hour = parseInt(hourStr, 10);

  // Weekday → DOW: Sun=0, Mon=1, ... Sat=6
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = dowMap[weekday] ?? 1;

  const isWeekend = dow === 5 || dow === 6 || (dow === 0 && hour < 4);
  const isPeak = hour >= 21 || hour < 4;

  if (isWeekend && isPeak) return 'wknd_peak';
  if (isWeekend) return 'wknd_early';
  if (isPeak) return 'wk_peak';
  return 'wk_early';
}

export function useCurrentTimeBand(): TimeBand {
  const [band, setBand] = useState<TimeBand>(() => getCurrentTimeBand());

  useEffect(() => {
    const interval = setInterval(() => {
      const next = getCurrentTimeBand();
      setBand(prev => (prev === next ? prev : next));
    }, 5 * 60 * 1000); // 5 minute tick

    return () => clearInterval(interval);
  }, []);

  return band;
}
