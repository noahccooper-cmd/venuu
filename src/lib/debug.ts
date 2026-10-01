/**
 * Dev-only console logging. Compiled out of production builds
 * (import.meta.env.DEV is statically false there), so tagged debug
 * logs like [IGNITE] / [BEACON] / [heatfield] cost nothing in prod.
 */
export function debugLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log(...args);
}

export function debugWarn(...args: unknown[]): void {
  if (import.meta.env.DEV) console.warn(...args);
}
