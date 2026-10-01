/**
 * Map mode — the toggle between VIBE (default bars/algorithm view) and
 * EVENTS (calendar discovery view). State lives in App.tsx and flows
 * down via prop OR via a small event-bus broadcast for body-level UI.
 *
 * Smart default logic on app mount:
 *   - Fri/Sat any time → events
 *   - Any day after 8pm → events
 *   - Otherwise → vibe
 *
 * User can always toggle. Default is just the starting point.
 */

export type MapMode = 'vibe' | 'events';

/**
 * Default map mode on app launch. Always 'vibe' — the normal map.
 * Events mode is user-initiated via the bottom-center toggle.
 * The mode shift is a ritual the user chooses, not something the
 * app does automatically.
 */
export function getDefaultMapMode(): MapMode {
  return 'vibe';
}

/**
 * Body-level event bus for components that can't easily receive
 * mapMode as a prop (e.g. VennyBar, TheDrop are rendered at the
 * App.tsx layer alongside MapView). Mirrors the venuu:globe-state
 * and venuu:drop-state patterns already in use.
 */
export function broadcastMapMode(mode: MapMode): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('venuu:map-mode', { detail: { mode } })
  );
}

/**
 * Convenience subscription for components outside the App.tsx tree
 * (e.g. inside VennyBar). Returns an unsubscribe function.
 */
export function subscribeMapMode(
  callback: (mode: MapMode) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ mode: MapMode }>).detail;
    if (detail?.mode) callback(detail.mode);
  };
  window.addEventListener('venuu:map-mode', handler);
  return () => window.removeEventListener('venuu:map-mode', handler);
}
