/**
 * Convert a positive integer to its lowercase English cursive word form.
 *
 * Used by PaintCeremony to declare the user's moment number ceremonially:
 *   1 → "one"
 *   15 → "fifteen"
 *   42 → "forty-two"
 *   100 → "one hundred"
 *   247 → "two hundred forty-seven"
 *   999 → "nine hundred ninety-nine"
 *
 * Falls back to "#N" numeric format for 1000+ (typography breaks down
 * at that size anyway, and we'd rather show "#1247" elegantly than
 * "one thousand two hundred forty-seven" awkwardly).
 */

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine',
];

const TEENS = [
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty',
  'sixty', 'seventy', 'eighty', 'ninety',
];

/**
 * Convert a number 1-999 to its English word form.
 * Returns empty string for 0 (caller responsibility).
 */
function under1000ToWord(n: number): string {
  if (n < 0) return '';
  if (n === 0) return '';
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    if (o === 0) return TENS[t];
    return `${TENS[t]}-${ONES[o]}`;
  }
  // 100-999
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (rem === 0) return `${ONES[h]} hundred`;
  return `${ONES[h]} hundred ${under1000ToWord(rem)}`;
}

export function numberToCursiveWord(n: number): string {
  if (n <= 0) return '#0';
  if (n >= 1000) return `#${n}`;
  return under1000ToWord(n);
}
