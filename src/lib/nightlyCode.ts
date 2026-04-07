/**
 * Generates a deterministic 4-digit check-in code for a venue on a given night.
 * The same venue + date always produces the same code — no database needed.
 */
export function generateNightlyCode(venueId: string, nightOf: string): string {
  const input = `${venueId}:${nightOf}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Ensure positive 4-digit number, zero-padded
  const code = Math.abs(hash) % 10000;
  return code.toString().padStart(4, '0');
}

/**
 * Returns the current "night" date as YYYY-MM-DD.
 * Nightlife rolls over at 4am — so 2am Sunday is still "Saturday night".
 */
export function getTonightDate(): string {
  const now = new Date();
  // If before 5am, count as previous day's night
  if (now.getHours() < 5) {
    now.setDate(now.getDate() - 1);
  }
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
