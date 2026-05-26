/**
 * Three randomized notification copy variants. One picked at
 * random per scheduled notification so the morning reveal feels
 * fresh rather than templated. Each variant uses the moment
 * number when available — "moment seven at The Hill" reinforces
 * the personal collection mythology.
 */

import { numberToCursiveWord } from './numberToCursiveWord';

export interface NotificationCopy {
  title: string;
  body: string;
}

export function pickMomentDevelopCopy(
  venueName: string,
  momentNumber: number
): NotificationCopy {
  const lowerVenue = venueName.toLowerCase();
  const numberWord = numberToCursiveWord(momentNumber);

  const variants: NotificationCopy[] = [
    {
      title: 'venuu',
      body: `Your moment at ${venueName} is ready ✨`,
    },
    {
      title: 'venuu',
      body: `${venueName} developed overnight. Tap to see ✦`,
    },
    {
      title: 'venuu',
      body: `✦ moment ${numberWord} at ${lowerVenue} — ready to view`,
    },
  ];

  // Pick at random — each capture gets a different feel
  const idx = Math.floor(Math.random() * variants.length);
  return variants[idx];
}
