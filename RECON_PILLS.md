# venuu — Map Pill & Vibe Rendering Recon

Generated: read-only pass. No source files modified. The only writes
performed by this run are this file and the snapshot copy under
`.recon/old_pill_snapshot/`.

---

## 0. Repo shape

### git remote
```
origin	https://github.com/noahccooper-cmd/venuu.git (fetch)
origin	https://github.com/noahccooper-cmd/venuu.git (push)
```

### current branch
```
rls-lockdown
```

### last 30 commits
```
6eb6f50 Add venuu admin push view for citywide announcements
4a9734f tools: add interactive push-drop script for operator broadcasts
004e5ba fix(push): use custom EDGE_JWT_ANON for inter-function auth + normalize city
af4c1af hotfix(db): SECURITY DEFINER on headcount RPCs
77df0c9 chore: gitignore supabase local state
795e947 feat(portal): route end-night through edge function
0c67f09 feat(portal): route cover_configs writes through edge function
fbaaa59 fix(portal): route specials through edge function, consolidate column
90a775a feat(portal): route venue_rewards upsert through edge function
bad357b chore: gitignore supabase local state
880c323 feat(portal): route venue_updates writes through edge function
76833e5 chore: remove dead loyalty and checkin code paths
2308b2e refactor(schema): drop unused cover_price column from venues
65be693 refactor(env): move Supabase URL and anon key from hardcoded to env vars
6b05299 chore: gitignore tree.txt audit scratch file
9dea273 feat(db): lock down RLS on public schema tables
f966494 Fix push notifications: new APNs key for sandbox+production, broadcast verified working at 99.9% delivery
4b97899 Fix NFC session: treat NFC_OK startup ping as healthy, not failure
7d6962c WIP: snapshot all in-progress work before NFC loyalty migration
c0afbd4 WIP: snapshot NFC implementation before Bookstore loyalty work
de8beee venuu v1.4.0 - launch ready
0064bf4 Fix The Drop pill hidden behind header on iOS
8228fd7 Fix Apple Sign In plugin Capacitor 8 compatibility
59813c7 Add Apple Sign In auth with SignInSheet and avatar button
94c4008 Add city filter dropdown to Bouncer Portal login
b39c2a9 Fix duplicate recaps by generating client-side UUID before insert
a734c6a Fix THE DROP not showing — remove isLive gate
2de9d38 Increase Portal container paddingBottom from 120px to 160px
9aeb2c6 Rebrand Portal broadcast to THE DROP with DROP IT button
d4432cc Polish broadcast: animations, flash pulse, hide when closed
```

### git status (short)
A large body of work is **uncommitted**. The current "stock-market" /
kettlebell pill files live in the working tree only — they have never
been committed to this branch. The last committed pill design is on
`de8beee` (venuu v1.4.0 launch ready).

Selected uncommitted entries relevant to pills/map/heat:

```
 M src/App.tsx
 M src/components/Map/MapView.tsx
 M src/components/Map/TheDrop.tsx
 M src/components/Map/VenueCard.tsx
 M src/index.css
 M src/lib/constants.ts
 M src/lib/directions.ts
 M src/lib/supabase.ts
 M src/lib/types.ts
 M src/pages/TonightPage.tsx
?? src/components/Map/CapacityRing.tsx
?? src/components/Map/HeatFieldLayer.tsx
?? src/components/Map/LiveVenueBubble.tsx
?? src/components/Market/CityPulseLine.css
?? src/components/Market/CityPulseLine.tsx
?? src/components/Market/MarketPanel.css
?? src/components/Market/MarketPanel.tsx
?? src/components/Market/MarketTicker.css
?? src/components/Market/MarketTicker.tsx
?? src/components/Market/MoversDrawer.css
?? src/components/Market/MoversDrawer.tsx
?? src/hooks/useHeatField.ts
?? src/lib/interpretBubble.ts
?? src/lib/featureFlags.ts
```

(`?? ` = untracked; `M ` = modified.)

### top two directory levels (excluding ignored)
```
.
./.claude
./.claude/worktrees
./docs
./ios
./ios/App
./ios/capacitor-cordova-ios-plugins
./public
./scripts
./src
./src/components
./src/hooks
./src/lib
./src/pages
./supabase
./supabase/.temp
./supabase/functions
./supabase/migrations
```

### monorepo?

No. Single `package.json` at the repo root, name `venuu`. There is
no `apps/`, `packages/`, `web/`, or `mobile/` split — this is a
Capacitor-wrapped Vite + React single-app codebase.

```
./package.json                                       name: "venuu"
./.claude/worktrees/stupefied-booth-cf62a2/package.json   (claude-only worktree scratch)
```

The "operator web app on :5174/:5175" referenced in the prompt
**does not exist** as a separate Vite project. The only Vite app is
this one (port :5173 by default per the dev script). What might be
mistaken for an operator app is `src/components/Portal/` — a portal
*tab* inside the same single React tree, gated by an admin code.

### app entries

- **Mobile / web entry:** `src/main.tsx` → `src/App.tsx`. Wrapped
  by Capacitor for iOS (`ios/App/`). No native React Native.
- **Web operator entry:** none (see above — Portal is a tab in the
  same SPA).
- **Shared package:** none.

---

## 1. Map surface inventory

### Mapping library
Mapbox GL JS (`mapbox-gl ^3.18.1`). Initialised in
`src/components/Map/MapView.tsx`. No `react-native-maps`, no
`MapLibre`, no `deck.gl`.

### Files that render on the map

| Path | Description | Library |
|---|---|---|
| `src/components/Map/MapView.tsx` (2,690 lines) | Root map screen. Owns the `mapboxgl.Map` instance, all imperative marker creation, all flag-gated overlay mounts. | Mapbox GL JS |
| `src/components/Map/LiveVenueBubble.tsx` (1,407 lines) | React overlay rendered into each marker via `createRoot`. The current "stock-market" pill. Contains `LegacyLiveVenueBubbleInner` (old design) + `MarketLiveVenueBubbleInner` (new). Public export branches on `FEATURE_FLAGS.MARKET_UX`. | framer-motion + inline `<style>` keyframes |
| `src/components/Map/HeatFieldLayer.tsx` (237 lines) | Imperative Mapbox layer controller. Adds `heat-field-base-layer` (`heatmap`) + `heat-field-halos-layer` (`circle`). Runs a 100 ms `setInterval` breath loop. | Mapbox GL JS |
| `src/components/Map/CapacityRing.tsx` (111 lines) | SVG arc around the pill, threshold-gated at `capacity_pct >= 0.30`. | inline SVG |
| `src/components/Map/TheDrop.tsx` (450 lines) | "📣 N updates tonight" pill at top of map. Click expands a feed. | DOM + index.css keyframes |
| `src/components/Map/LiveEventsFeed.tsx` | Live-event card column on the map (surge alerts etc). | DOM |
| `src/components/Map/VenueCard.tsx` | Bottom sheet rendered when a marker is tapped. Has its own inline `getDirectionsUrl` helper (Phase 2 diagnostic). | DOM |
| `src/components/Map/EventCard.tsx` | Event detail card. | DOM |
| `src/components/Map/CoverPurchaseSheet.tsx` | Cover-charge Stripe sheet. | DOM |
| `src/components/Market/CityPulseLine.tsx` (131 lines) | Top-of-map city narration: `Tampa Mon 9:41pm +75% running hot`. Always renders something. | React + CSS |
| `src/components/Market/MarketTicker.tsx` (81 lines) | The horizontal scrolling Bloomberg-style strip beneath the City Pulse Line. | React + CSS |
| `src/components/Market/MoversDrawer.tsx` (200 lines) | Exports `MoversChip` (📈 floater bottom-left, morphs into MarketPanel) and `MoversDrawer` (legacy bottom-sheet — code present, not rendered). | framer-motion |
| `src/components/Market/MarketPanel.tsx` (209 lines) | The panel half of the chip→panel morph (shared `layoutId="market-pill"`). Drag to expand/collapse/close. | framer-motion |
| `src/components/Venny/VennyBar.tsx` (149 lines) | "ask Venny" pill that floats below The Drop. | DOM + inline styles |
| `src/components/Layout/BottomNav.tsx` (52 lines) | Bottom tab bar: Tonight / Portal / You. Active = brand orange. | DOM + Tailwind + inline |

### Quoted in full

#### Root map screen (mobile + web — same file)
- **`src/components/Map/MapView.tsx`** — 2,690 lines. Too large to
  paste verbatim here. Key extracts elsewhere in this report.
  Component signature (line 335):

```tsx
export function MapView({ city, venues, venueFilter, counts, liveVenueIds, pulsedVenueId, events, coverPrices, userLocation, route, routeDuration, routeDistance, routeDestination, routeArrived, followMode, onVenueClick, onEventClick, onMapTap, onCityTapFromGlobe, cityAggregates, totalPeopleOut, introActive, introPhase, onMapReady, onShareGlobe, sharingGlobe, onCancelRoute, onPriceTap, onToggleFollow, onUserDragMap, mapInstanceRef, highlightedVenueIds, activePlan, onPlanStopTap, focusedStopIndex, sheetState }: MapViewProps) {
```

Marker creation entry (line 1258):

```tsx
const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
  .setLngLat([venue.lng, venue.lat]);
```

The `el` is a `<div className="venue-marker">` with appended children
`glowEl + particlesEl + ring2El + ringEl + bubbleEl + labelEl + featuredLabelEl + liveEl + priceTagEl + reactMount`.
The `reactMount` is the host for the modern `<LiveVenueBubble>`
React tree (line 1216–1225):

```tsx
const reactMount = document.createElement('div');
reactMount.className = 'venue-live-bubble-mount';
reactMount.style.position = 'absolute';
reactMount.style.top = '50%';
reactMount.style.left = '50%';
reactMount.style.transform = 'translate(-50%, -50%)';
reactMount.style.display = 'none';
reactMount.style.zIndex = '3';
el.appendChild(reactMount);
const reactRoot = createRoot(reactMount);
```

Map JSX return (line 2412–2458) showing overlay stacking:

```tsx
return (
  <div className="w-full h-full" style={{ position: 'relative' }}>
    <div ref={mapContainer} className="w-full h-full" />

    {/* Phase 4 market UX overlays — flag-gated. */}
    {FEATURE_FLAGS.MARKET_UX && (
      <>
        <div className="map-pulse-line-wrapper">
          <CityPulseLine city={city} />
          <MarketTicker
            city={city}
            onVenueTap={(venue) => {
              mapRef.current?.flyTo({
                center: [venue.lng, venue.lat],
                zoom: 16,
                duration: 1100,
                essential: true,
              });
              setSpotlightVenueId(venue.venue_id);
            }}
          />
        </div>
        <MoversChip
          city={city}
          onOpen={() => setMarketViewActive(true)}
          hidden={marketViewActive}
        />
        <MarketPanel
          city={city}
          active={marketViewActive}
          onClose={exitMarketView}
          onVenueTap={(venueId, venue) => {
            setSpotlightVenueId(venueId);
            mapRef.current?.flyTo({
              center: [venue.lng, venue.lat],
              zoom: 16,
              duration: 1100,
              essential: true,
            });
          }}
          spotlightVenueId={spotlightVenueId}
        />
      </>
    )}
    {/* … route pill, cancel bar, side pills, globe overlay … */}
```

#### Root map component (web operator)
None — the operator surface is `src/components/Portal/*` which is
**not on the map**. It is a separate full-screen flow within the
single React app (no map mounted at all).

#### Marker / pill / annotation component(s) — current

- **`src/components/Map/LiveVenueBubble.tsx`** — modern bubble.
  See §2 below for the full JSX + CSS in MarketLiveVenueBubbleInner.

#### Previous marker component still in the tree but unused

- **`LegacyLiveVenueBubbleInner`** (same file, lines 251–517) — the
  *previous* pill from the Phase 0/1 era. Still exported and still
  reachable when `FEATURE_FLAGS.MARKET_UX === false`. See §3 for the
  full quote.
- **`src/index.css`** still contains the **v1.4.0 legacy DOM marker
  styles** (`.venue-bubble`, `.venue-bubble-count`, `.venue-label`,
  `.venue-ring`, `.venue-heat-glow`, `.venue-particles`, etc.) and
  the **legacy DOM marker construction code is also still in
  `MapView.tsx`** (lines ~1100–1260). Both run on every marker:
  Mapbox holds a `<div class="venue-marker">` with the legacy DOM
  children PLUS an inner `<div class="venue-live-bubble-mount">`
  that mounts the React `LiveVenueBubble`. The React mount is shown
  via `entry.reactMount.style.display = 'block'` only for venues
  with `hasUsableEstimate(est) === true`; the legacy DOM children
  carry the visual otherwise.
- **`src/components/Market/MoversDrawer.tsx`** still exports a
  `MoversDrawer` bottom-sheet component that is currently **not
  rendered anywhere** (kept for the long-press fallback the prompt
  comments reference). `MoversChip` from the same file IS rendered.
- **`src/hooks/useVenues.ts`** is declared `@deprecated` in its own
  JSDoc and delegates straight through to `useVenuesInBounds`.

No files are named `*Old*`, `*V1*`, `*V2*`, `*.bak`, `*_deprecated`.
Search returned only the "Legacy" prefix inside
`LiveVenueBubble.tsx`.

#### Heatmap layer component / config

- **`src/components/Map/HeatFieldLayer.tsx`** — full quote in §6.

#### Top "stock ticker" bar

- **`src/components/Market/MarketTicker.tsx`** + matching CSS. Full
  quote in §5.

#### "Ask Venny" pill

- **`src/components/Venny/VennyBar.tsx`** — full quote in §1
  extract below.

```tsx
import { memo } from 'react';
import { hapticLight } from '../../lib/haptics';

interface VennyBarProps {
  onExpand: () => void;
  sheetOpen: boolean;
  hasUnreadResponse?: boolean;
  hidden?: boolean;
}

function VennyBarInner({ onExpand, sheetOpen, hasUnreadResponse, hidden }: VennyBarProps) {
  const handleTap = () => {
    hapticLight();
    onExpand();
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label="Open Venny chat"
      className="venny-bar"
      style={{
        position: 'fixed',
        top: 'calc(80px + env(safe-area-inset-top, 0px) + 70px)',
        left: '50%',
        transform: hidden
          ? 'translate(-50%, -8px)'
          : 'translate(-50%, 0)',
        height: 38,
        maxWidth: 200,
        borderRadius: 19,
        background: 'rgba(15, 15, 22, 0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 130, 0, 0.18)',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        zIndex: 590,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        opacity: hidden ? 0 : (sheetOpen ? 0.4 : 1),
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 280ms ease-out, transform 280ms ease-out',
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1.2 L9.35 5.9 L14 7.25 L9.35 8.6 L8 13.3 L6.65 8.6 L2 7.25 L6.65 5.9 Z" fill="#FF8200"/>
        </svg>
      </span>
      <span style={{ fontFamily: 'Satoshi, sans-serif', fontSize: 13, fontWeight: 500, color: 'rgba(255, 255, 255, 0.85)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
        ask Venny
      </span>
      {hasUnreadResponse && !sheetOpen && (
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: '#FF8200', boxShadow: '0 0 6px rgba(255, 130, 0, 0.7)', flexShrink: 0 }} />
      )}
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 12, height: 12, flexShrink: 0, opacity: 0.6 }}>
        <svg width="10" height="12" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2 L7 6 L3 10" stroke="#FF8200" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    </button>
  );
}

export const VennyBar = memo(VennyBarInner);
```

#### "No updates tonight" pill

This is `TheDrop`'s falsy state. The full pill component is in
`src/components/Map/TheDrop.tsx` lines 208–247:

```tsx
{/* Pill */}
<div className="drop-pill-wrapper" style={{
  position: 'absolute',
  top: '20px',
  left: 0,
  right: 0,
  // Rides above the VennyBar pill (zIndex 590) so the revenue
  // surface always wins z-order conflicts at the top of the map.
  zIndex: 600,
  display: 'flex',
  justifyContent: 'center',
  padding: '6px 0',
  pointerEvents: 'none',
}}>
  <button
    ref={pillRef}
    onClick={handlePillClick}
    className={`${hasContent ? 'drop-pill-glow' : ''} ${flash ? 'drop-pill-flash' : ''} ${urgencyPulse ? 'drop-pill-urgency' : ''}`}
    style={{
      pointerEvents: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 14px',
      borderRadius: '20px',
      background: hasContent ? 'rgba(255, 130, 0, 0.15)' : 'rgba(255,255,255,0.06)',
      border: hasContent ? '1px solid rgba(255, 130, 0, 0.3)' : '1px solid rgba(255,255,255,0.1)',
      color: hasContent ? ORANGE : 'rgba(255,255,255,0.35)',
      fontFamily: FONT,
      fontSize: '12px',
      fontWeight: 700,
      cursor: 'pointer',
      transition: 'all 0.2s',
    }}
  >
    {'📣'} {hasContent ? `${totalCount} update${totalCount === 1 ? '' : 's'} tonight` : 'No updates tonight'}
  </button>
</div>
```

#### City header (Knoxville · MON · 10:16pm · surge/busy counters)

- **`src/components/Market/CityPulseLine.tsx`** — full quote in §1
  extract below.

```tsx
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
          <span className="city-pulse-line__day">{dayShort}</span>
          <span className="city-pulse-line__time">{timeStr}</span>
          <span className="city-pulse-line__delta">
            {sign}{delta.toFixed(0)}%
          </span>
          <span className="city-pulse-line__verdict">{tone.label}</span>
        </div>
        <div className="city-pulse-line__meta">
          <span className="city-pulse-line__count">
            {pulse.surging_count > 0 && (
              <span className="city-pulse-line__surging">
                {pulse.surging_count}↑ surging
              </span>
            )}
            {pulse.busy_count > 0 && (
              <span className="city-pulse-line__busy">
                {pulse.busy_count} busy
              </span>
            )}
          </span>
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
        <span className="city-pulse-line__day">{dayShort}</span>
        <span className="city-pulse-line__time">{timeStr}</span>
        <span className="city-pulse-line__verdict">
          {isNightlifeHour ? 'reading the city…' : 'bars open at 5p · watching'}
        </span>
      </div>
    </div>
  );
}
```

#### Bottom tab bar (Tonight / Portal / You)

- **`src/components/Layout/BottomNav.tsx`** — full file:

```tsx
import { MapPin, Radio, User } from 'lucide-react';

export type Tab = 'tonight' | 'portal' | 'you';

interface BottomNavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const tabs: { key: Tab; label: string; icon: typeof MapPin }[] = [
  { key: 'tonight', label: 'Tonight', icon: MapPin },
  { key: 'portal',  label: 'Portal',  icon: Radio },
  { key: 'you',     label: 'You',     icon: User },
];

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0A0A0F] flex items-center justify-around"
      style={{
        height: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="flex-1 flex flex-col items-center gap-1 py-2"
          >
            <Icon
              size={28}
              strokeWidth={1.5}
              color={isActive ? '#FF8200' : 'rgba(255, 255, 255, 0.4)'}
            />
            <span
              style={{
                fontFamily: 'Satoshi, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                color: isActive ? '#FF8200' : 'rgba(255, 255, 255, 0.4)',
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
```

---

## 2. Pill anatomy — current ("stock market") version

The pill described in the prompt as "kettlebell" is the
`MarketLiveVenueBubbleInner` in `src/components/Map/LiveVenueBubble.tsx`.
Its silhouette is **not literally drawn** — there is no SVG path or
Skia shape. The silhouette is composed by stacking:
1. `<span className="lvb-breath-halo">` (radial-gradient halo)
2. `<CapacityRing>` (SVG circular arc)
3. (conditional) `<span className="lvb-market-state-ring">` (state-change broadcast)
4. (zoom < 12) `<span className="lvb-market-dot">` (small pill-tip dot)
5. (zoom >= 12) `<div className="lvb-market-shell">` (the round head)
6. (zoom >= 15) `<div className="lvb-pill">` (the stacked data tile below)

The kettlebell look ("rounded body with status word header like
LIVELY, BUSY, SURGING, QUIET, big number, small % underneath, FREE
tag on top") is the **stacked `.lvb-pill`** sitting below the
small `.lvb-market-shell`/`.lvb-market-dot` head, with the existing
DOM `.venue-cover-bubble` (FREE tag) anchored to the parent
`.venue-marker` element by `MapView.tsx`.

### JSX/TSX — the render block of MarketLiveVenueBubbleInner

`src/components/Map/LiveVenueBubble.tsx` lines 805–989 (full
function body):

```tsx
function MarketLiveVenueBubbleInner({
  estimate, isSelected, onTap, highlighted, mapZoom, venueName,
  marketView, isSpotlight, movementMagnitude, showName,
}: LiveVenueBubbleProps) {
  const stateLabel = normalizeState(estimate?.state_label);
  const confidence = estimate?.confidence_pct ?? 0;
  const trend = estimate?.trend ?? null;
  const trendRate = estimate?.trend_rate ?? null;
  const pulseClass = getPulseClass(trendRate);
  const initial = getVenueInitial(venueName);

  // ─── State-change ring — fires once per transition into a new state.
  const prevStateRef = useRef<StateLabel>(stateLabel);
  const [ringKey, setRingKey] = useState(0);
  useEffect(() => {
    if (prevStateRef.current !== stateLabel) {
      prevStateRef.current = stateLabel;
      setRingKey(k => k + 1);
    }
  }, [stateLabel]);

  // No render when engine has nothing — same algorithm-run gate as legacy.
  if (!hasAlgorithmData(estimate)) return null;

  const tier = getZoomTier(mapZoom);
  // Phase 5.2 — palette mode switches with marketView. Smoothness lives
  // in CSS transitions on the bubble root + halo (480ms ease).
  const colorMode: 'explore' | 'market' = marketView ? 'market' : 'explore';
  const colors = (STATE_COLORS[stateLabel] ?? STATE_COLORS.Unknown)[colorMode];
  const isSurging = stateLabel === 'Surging';
  const pulseRate = pulseRateFor(trendRate);
  // Trend is read for the breath-rate calc above and (currently) for nothing
  // else in this render path. Phase 5.2 moved delta/state out of the shell
  // and into the pill below; no trend arrow there per spec.
  void trend;

  // Stagger BOLD entry by movement magnitude — biggest movers light
  // first (delay 0ms), smallest last (~600ms). Scoped via a CSS
  // variable so the always-on breath animation isn't delayed too.
  const mvDelayMs = marketView
    ? Math.round((1 - Math.min(1, Math.max(0, movementMagnitude ?? 0))) * 600)
    : 0;

  // Phase 5.2 — initial scales smoothly across the mid band so leaning
  // into the city feels like the letter is growing toward you. Linear
  // 0.9× at zoom 12 → 1.15× at zoom 14. Outside the mid band the value
  // is unused — React unmounts the initial via the conditional render.
  const initialScale = useMemo(() => {
    if (tier !== 'mid') return 1;
    const z = mapZoom ?? 13;
    const t = Math.max(0, Math.min(1, (z - 12) / 2));
    return 0.9 + t * 0.25;
  }, [tier, mapZoom]);

  const rootStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    display: 'inline-block',
    lineHeight: 0,
    position: 'relative',
    // CSS custom props consumed by the new keyframes / classes
    ['--state-primary' as string]: colors.primary,
    ['--state-glow' as string]: colors.glow,
    ['--state-text' as string]: colors.text,
    ['--pulse-rate' as string]: pulseRate,
    ['--mv-delay' as string]: `${mvDelayMs}ms`,
  };

  // Bubble shell — pill in mid/tight, just a halo dot in wide.
  // Phase 5.2: shell is now a clean visible marker. Mid tier carries
  // the venue initial INSIDE the shell. Tight tier moves all data
  // (delta + state + capacity) into a separate .lvb-pill rendered
  // below the bubble — the shell at tight is just a colored anchor.
  const showShell = tier !== 'wide';
  const showInitial = tier === 'mid' && initial.length > 0 && stateLabel !== 'Unknown';
  const showPill = tier === 'tight' && stateLabel !== 'Unknown' && confidence >= 35;

  return (
    <motion.button
      type="button"
      onClick={onTap}
      className={[
        'lvb-bubble--market',
        'lvb-bubble--breathing',
        pulseClass,
        `lvb-state-${stateLabel.toLowerCase()}`,
        `lvb-bubble--zoom-${tier}`,
        highlighted ? 'lvb-highlighted' : '',
        isSurging ? 'lvb-market-surging' : '',
        marketView ? 'lvb-bubble--mv' : '',
        marketView ? `lvb-bubble--mv-${stateLabel.toLowerCase()}` : '',
        marketView && isSpotlight ? 'lvb-bubble--spotlight' : '',
      ].filter(Boolean).join(' ')}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: isSelected ? 1.08 : 1 }}
      transition={isSelected
        ? { type: 'spring', stiffness: 300, damping: 18 }
        : { duration: 0.22, ease: 'easeOut' }}
      whileTap={{ scale: 0.95 }}
      style={rootStyle}
    >
      {/* Phase 5.1 — breath halo. */}
      <span className="lvb-breath-halo" aria-hidden />

      {/* Phase 5.0 — capacity ring overlay. */}
      <CapacityRing
        capacityPct={estimate?.capacity_pct ?? null}
        color={colors.primary}
        glow={colors.glow}
        size={getBubbleRingSize(mapZoom)}
        stroke={3}
        threshold={0.30}
      />

      {/* State-change broadcast ring. */}
      {ringKey > 0 && (
        <span
          key={ringKey}
          aria-hidden
          className="lvb-market-state-ring"
        />
      )}

      {tier === 'wide' && (
        <span className="lvb-market-dot" aria-hidden />
      )}

      {showShell && (
        <div className={`lvb-market-shell lvb-market-shell--${tier}`}>
          {showInitial && (
            <span
              className="lvb-initial lvb-initial--mid"
              style={{ fontSize: `calc(14px * ${initialScale})` }}
              aria-hidden
            >
              {initial}
            </span>
          )}
        </div>
      )}

      {showPill && (
        <div className={`lvb-pill lvb-pill--${stateLabel.toLowerCase()}`}>
          <span className="lvb-pill__state">{stateLabel}</span>
          {estimate?.estimate != null && estimate.estimate >= 0 && (
            <span className="lvb-pill__count">{estimate.estimate}</span>
          )}
          {estimate?.capacity_pct != null && estimate.capacity_pct >= 0.05 && (
            <span className="lvb-pill__capacity">
              {Math.round(estimate.capacity_pct * 100)}%
            </span>
          )}
        </div>
      )}

      {showName && venueName && (
        <span className={`lvb-name-label lvb-name-label--${tier}`}>{venueName}</span>
      )}

      <style>{LVB_KEYFRAMES}</style>
      <style>{LVB_MARKET_KEYFRAMES}</style>
    </motion.button>
  );
}
```

### Styles — inline LVB_MARKET_KEYFRAMES (lines 992–1395)

The market-mode pill ships its CSS via two inline `<style>` blocks
injected on every bubble. The full content is verbatim below.

```css
.lvb-bubble--market {
  position: relative;
  font-family: var(--font-display);
}

.lvb-market-shell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 14px;
  border-radius: 22px;
  background: linear-gradient(180deg,
    rgba(20, 20, 28, 0.94) 0%,
    rgba(15, 15, 22, 0.96) 100%);
  border: 1px solid var(--state-primary);
  box-shadow: 0 0 14px var(--state-glow), 0 2px 10px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
  line-height: 1.0;
  animation: lvb-market-breath 3.5s ease-in-out infinite;
}

.lvb-market-shell--mid {
  padding: 4px 10px;
  border-radius: 18px;
  gap: 0;
}

@keyframes lvb-market-breath {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.02); }
}

.lvb-market-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--state-primary);
  box-shadow: 0 0 12px var(--state-glow);
  animation: lvb-market-dot-pulse 2.4s ease-in-out infinite;
}

@keyframes lvb-market-dot-pulse {
  0%, 100% { opacity: 0.75; transform: scale(1); }
  50%      { opacity: 1; transform: scale(1.18); }
}

.lvb-market-surging .lvb-market-shell,
.lvb-market-surging .lvb-market-dot {
  animation: lvb-market-breath 3.5s ease-in-out infinite,
             lvb-market-surge-halo 2.6s ease-in-out infinite;
}

@keyframes lvb-market-surge-halo {
  0%, 100% { box-shadow: 0 0 14px var(--state-glow), 0 0 28px rgba(31, 232, 154, 0.25); }
  50%      { box-shadow: 0 0 22px var(--state-glow), 0 0 42px rgba(31, 232, 154, 0.45); }
}

.lvb-bubble--market .lvb-trend-arrow {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.85em;
  font-weight: 700;
  animation: lvb-trend-pulse var(--pulse-rate, 2s) ease-in-out infinite;
}

@keyframes lvb-trend-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.95); }
  50%      { opacity: 1;    transform: scale(1.1); }
}

.lvb-market-state-ring {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 2px solid var(--state-primary);
  opacity: 0;
  pointer-events: none;
  animation: lvb-state-change-ring 920ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes lvb-state-change-ring {
  0%   { opacity: 0.85; transform: scale(1);    }
  60%  { opacity: 0.5;  transform: scale(1.35); }
  100% { opacity: 0;    transform: scale(1.7);  }
}

.lvb-delta {
  font-family: var(--font-display);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--state-text);
}

.lvb-delta--hero { font-size: 22px; text-shadow: 0 0 16px var(--state-glow); }
.lvb-delta--mid  { font-size: 14px; }
.lvb-delta--zero { color: rgba(255, 255, 255, 0.5); }

.lvb-bubble--market .lvb-state-text {
  font-weight: 540;
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--state-text);
  opacity: 0.85;
}

/* MARKET VIEW MODE — BOLD transforms. */
.lvb-bubble--mv {
  animation: lvb-mv-enter 560ms cubic-bezier(0.16, 1, 0.3, 1) var(--mv-delay, 0ms) both;
  transform-origin: center;
}

@keyframes lvb-mv-enter {
  0%   { transform: scale(1);                    filter: saturate(1)   brightness(1);    }
  100% { transform: scale(var(--mv-scale, 1.18)); filter: saturate(1.5) brightness(1.15); }
}

.lvb-bubble--mv-surging { --mv-scale: 1.55; z-index: 25; }
.lvb-bubble--mv-surging::before {
  content: ''; position: absolute; inset: -12px;
  border-radius: 50%; border: 2px solid #1FE89A;
  opacity: 0.85;
  animation: lvb-mv-surging-ring-1 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  pointer-events: none;
}
.lvb-bubble--mv-surging::after {
  content: ''; position: absolute; inset: -12px;
  border-radius: 50%; border: 2px solid #1FE89A;
  opacity: 0.55;
  animation: lvb-mv-surging-ring-2 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  animation-delay: 1s;
  pointer-events: none;
}

@keyframes lvb-mv-surging-ring-1 {
  0%   { transform: scale(1);   opacity: 0.85; }
  100% { transform: scale(2.4); opacity: 0;    }
}
@keyframes lvb-mv-surging-ring-2 {
  0%   { transform: scale(1);   opacity: 0.55; }
  100% { transform: scale(2.8); opacity: 0;    }
}

.lvb-bubble--mv-packed  { --mv-scale: 1.35; }
.lvb-bubble--mv-busy    { --mv-scale: 1.25; }
.lvb-bubble--mv-lively  { --mv-scale: 1.12; }
.lvb-bubble--mv-quiet   { --mv-scale: 0.85; opacity: 0.4; }
.lvb-bubble--mv-unknown { --mv-scale: 0.78; opacity: 0.2; }

.lvb-bubble--spotlight {
  --mv-scale: 1.75 !important;
  z-index: 50;
  filter: saturate(1.8) brightness(1.35) drop-shadow(0 0 28px var(--state-glow));
  animation:
    lvb-mv-enter 560ms cubic-bezier(0.16, 1, 0.3, 1) var(--mv-delay, 0ms) both,
    lvb-spotlight-pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes lvb-spotlight-pulse {
  0%, 100% { filter: saturate(1.8) brightness(1.35) drop-shadow(0 0 28px var(--state-glow)); }
  50%      { filter: saturate(2.1) brightness(1.55) drop-shadow(0 0 42px var(--state-glow)); }
}

.lvb-breath-halo {
  content: ''; position: absolute; inset: -8px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--state-glow) 0%, transparent 50%);
  pointer-events: none;
  z-index: -1;
  animation: lvb-breath var(--pulse-cycle, 3.5s) ease-in-out infinite;
  opacity: 0.6;
  transition: background 480ms cubic-bezier(0.4, 0, 0.2, 1);
}

.lvb-pulse--fast { --pulse-cycle: 1.2s; }
.lvb-pulse--med  { --pulse-cycle: 2.0s; }
.lvb-pulse--slow { --pulse-cycle: 3.5s; }

@keyframes lvb-breath {
  0%, 100% { opacity: 0.5;  transform: scale(1);    }
  50%      { opacity: 0.95; transform: scale(1.08); }
}

.lvb-state-unknown .lvb-breath-halo { animation: none; opacity: 0.15; }

.lvb-initial {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 14px;
  color: #FF8200;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.6),
    0 0 8px rgba(0, 0, 0, 0.3);
  letter-spacing: -0.02em;
  pointer-events: none;
  line-height: 1.0;
  animation: lvb-fade-in 220ms cubic-bezier(0.4, 0, 0.2, 1) both;
}

@keyframes lvb-fade-in {
  0%   { opacity: 0; transform: scale(0.88); }
  100% { opacity: 1; transform: scale(1);    }
}

.lvb-name-label {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.78);
  white-space: nowrap;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.85),
    0 0 6px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  letter-spacing: -0.005em;
  z-index: 3;
  transition: top 280ms cubic-bezier(0.4, 0, 0.2, 1);
}
.lvb-name-label--tight { top: calc(100% + 68px); }
.lvb-name-label--mid,
.lvb-name-label--wide  { top: calc(100% + 6px); }

/* THE TALL CAPSULE PILL — Phase 5.2.2 */
.lvb-pill {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 64px;
  padding: 6px 12px;
  border-radius: 18px;
  background: linear-gradient(180deg,
    rgba(15, 15, 22, 0.94) 0%,
    rgba(10, 10, 16, 0.97) 100%);
  border: 1px solid var(--state-primary, rgba(255, 255, 255, 0.18));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  pointer-events: none;
  z-index: 3;
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.45),
    0 0 12px var(--state-glow, transparent);
  font-family: var(--font-display);
  white-space: nowrap;
  animation: lvb-pill-rise 280ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  transition:
    background 320ms ease,
    border-color 320ms ease,
    box-shadow 480ms cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes lvb-pill-rise {
  0%   { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(0.9); }
  100% { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1);   }
}

.lvb-pill__state {
  font-weight: 700;
  font-size: 8px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--state-text, rgba(255, 255, 255, 0.92));
  line-height: 1.1;
  margin-bottom: 1px;
}

.lvb-pill__count {
  font-weight: 800;
  font-size: 17px;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: #FFFFFF;
  text-shadow: 0 0 10px var(--state-glow);
  line-height: 1.0;
}

.lvb-pill__capacity {
  font-weight: 600;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.02em;
  line-height: 1.1;
  margin-top: 1px;
}

.lvb-bubble--mv .lvb-pill {
  box-shadow:
    0 6px 20px rgba(0, 0, 0, 0.55),
    0 0 22px var(--state-glow);
}

@media (prefers-reduced-motion: reduce) {
  .lvb-initial,
  .lvb-pill { animation: none; }
  .lvb-bubble--mv,
  .lvb-bubble--mv-surging::before,
  .lvb-bubble--mv-surging::after,
  .lvb-bubble--spotlight { animation: none; }
  .lvb-breath-halo { animation: none; opacity: 0.7; }
}

.lvb-bubble--market {
  transition:
    background-color 480ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color    480ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow      480ms cubic-bezier(0.4, 0, 0.2, 1),
    filter          320ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Reanimated / Skia / SVG used to draw the silhouette

**There is no Reanimated, no Skia.** All animation is either
framer-motion (on the outer `<motion.button>` for mount/select/tap
spring) or pure CSS keyframes (everything else). The only SVG is
the CapacityRing's two `<circle>` elements (§6) plus the small
sparkle/chevron `<svg>`s in VennyBar.

### Glow / halo / shadow logic

Three layered effects:
1. `.lvb-breath-halo` — radial-gradient child element, opacity
   pulses on the trend-rate-keyed `--pulse-cycle`. Sits behind the
   pill at `z-index: -1`.
2. `.lvb-market-shell { box-shadow: 0 0 14px var(--state-glow), 0 2px 10px rgba(0,0,0,0.35); }`
   — the shell itself wears a soft state-color halo + drop shadow.
3. `.lvb-pill { box-shadow: 0 6px 16px rgba(0,0,0,0.45), 0 0 12px var(--state-glow, transparent); }`
   — the data pill wears its own state-color halo. In
   `.lvb-bubble--mv .lvb-pill` (market view active) this jumps to
   `0 6px 20px / 0 0 22px`.

Surging-state venues also get the **double broadcast ring** via
`::before` + `::after` on `.lvb-bubble--mv-surging` — see the
keyframes `lvb-mv-surging-ring-1/2`.

### Props interface

`src/components/Map/LiveVenueBubble.tsx` lines 27–62:

```tsx
interface LiveVenueBubbleProps {
  venueId?: string;
  venueName?: string;
  estimate: HeadcountEstimate | null | undefined;
  /** Raw `cover_charge` string from the venue row (e.g. "FREE", "$5"). */
  coverCharge?: string | null;
  isSelected?: boolean;
  onTap?: () => void;
  /** During the intro's bubble-bloom phase, ms to delay this bubble's
   *  bloom-in animation (staggered from screen center outward). */
  introBloomDelay?: number;
  /** When true, Venny has called highlight_on_map for this venue —
   *  the bubble gets an orange focus ring + scale-up + boosted z so
   *  it pops above the (faded) non-highlighted peers. */
  highlighted?: boolean;
  /** Current Mapbox zoom level — market mode renders different sizes
   *  per altitude bucket. */
  mapZoom?: number;
  /** Market View Mode active. */
  marketView?: boolean;
  /** Currently-spotlighted venue. */
  isSpotlight?: boolean;
  /** 0–1 normalized magnitude of |delta_pct|. */
  movementMagnitude?: number;
  /** Phase 5.1 — smart-density name label gate. */
  showName?: boolean;
}
```

### Parent that passes data in

`src/components/Map/MapView.tsx` — the per-venue loop that calls
`entry.reactRoot.render(<LiveVenueBubble … />)` is the only consumer.
The marker-creation loop appends a `.venue-live-bubble-mount` div to
each marker, gets a `createRoot` handle, and the React tree lives
inside that mount. Mapbox handles geographic positioning of the
wrapper; the React mount is centered via `position: absolute; top: 50%; left: 50%`.

---

## 3. Pill anatomy — prior version (the one we want to recover the *feel* of)

### Git archaeology

#### `git log --all --oneline -- "*Marker*" "*Pill*" "*Vibe*" "*Bubble*" "*Annotation*"` and lowercase

(Empty for capital forms; the lowercase variant returned commits
that touched files named `*marker*`/`*pill*`/`*bubble*`. Combined
output:)

```
c07c54d Add Precap AI chat tab, wire 3-tab navigation, cleanup stale files
c03253e Polish venUe to production quality: map, bubbles, sheet, portal, auth
8fbe5e0 Rebrand to venUe with bouncer portal and live headcount system
51170e8 Build COLLIDE V1 — live entertainment map platform
```

The current `LiveVenueBubble.tsx`, `MoversDrawer.tsx`,
`MarketPanel.tsx`, `CityPulseLine.tsx`, `MarketTicker.tsx`,
`HeatFieldLayer.tsx`, `CapacityRing.tsx`, `interpretBubble.ts`,
`useHeatField.ts` are **all untracked**. They have NEVER been
committed.

#### Commits matching `pill | marker | kettlebell | stock | ticker | halo | glow | revert | redesign | vibe`

```
fbaaa59 fix(portal): route specials through edge function, consolidate column
5fed449 v1.7.0: Golden loyalty glow on map, elite haptics, hold-to-confirm redemption with scan line, signature check-in/jackpot/redemption sounds, forced app update system
0064bf4 Fix The Drop pill hidden behind header on iOS
d4432cc Polish broadcast: animations, flash pulse, hide when closed
9dda6ef Add TheDrop broadcast pill to Tonight map page
25b9e75 Remove orange special banner from map markers
14530d5 Show venue special in bottom sheet with orange pill + realtime sync
0fcb41b Show venue special as orange banner below name on map markers
7dcf302 Rebuild Tonight's Special section with direct supabase calls
8f9309c Clean up Tonight's Special section in Portal bouncer interface
538b6f9 Fix Venny chat input: position above nav, iMessage-style, keyboard handling
da01eb1 Strip debug console statements for production build
8453a2f Fix Vinny repeating headcount stats and improve conversation quality
23bddbd App Store readiness: splash screen, empty states, error handling, haptics, meta tags
8acd7ca Add marker creation debug logs to diagnose Undeclared not showing
3d7e9a1 V1 polish: recap cards, header, sheet, Precap, map, cleanup
95c0b83 Polish all buttons app-wide for mobile-first pitch readiness
9fe318b Fix cover_charge resetting to FREE on page refresh
0a7a0d1 Rename app from venUe to venuu across entire codebase
6ddb56f Fix cover bubble live sync with debug logs and fallback refetch
```

No commit message contains the words *kettlebell*, *stock*, or
*ticker* — those concepts only exist in the uncommitted working
tree.

#### Branches

```
+ claude/busy-swirles
+ claude/hardcore-chaplygin
+ claude/optimistic-roentgen
+ claude/stupefied-booth-cf62a2
  main
  nfc-bookstore-loyalty
  push-notifications-fix
* rls-lockdown
  thawout-event
  remotes/origin/HEAD -> origin/main
  remotes/origin/main
  remotes/origin/rls-lockdown
```

No branch name matches `old`, `prev`, `v1`, `pre-stock`, or `pill`.
The "previous design" does not live on a named branch. **The only
recoverable snapshot of the previous pill is the v1.4.0 launch tag
on `de8beee` (committed pre-LiveVenueBubble.tsx).**

#### Snapshot copied to `.recon/old_pill_snapshot/`

The legacy pill at v1.4.0 was assembled imperatively in
`MapView.tsx` from DOM elements styled by `index.css`. I copied
that committed file to `.recon/old_pill_snapshot/MapView.v1.4.0.tsx`.

The visual was driven by a single `getVenueVisuals(headcount)`
function (8 stages, lines 78–115):

```ts
function getVenueVisuals(headcount: number): BubbleVisuals {
  // Stage 0: empty — gray dot, no number
  if (headcount === 0) return {
    stage: 0, color: '#6B7280', size: 24, glow: 'none',
    pulse: 'none', fontSize: '0px', showRing: false, showCount: false,
  };
  const fontSize = getCountFontSize(headcount);
  if (headcount <= 10) return {
    stage: 1, color: '#3B82F6', size: 28, glow: '0 0 8px rgba(59,130,246,0.4)',
    pulse: 'none', fontSize, showRing: false, showCount: true,
  };
  if (headcount <= 30) return {
    stage: 2, color: '#8B5CF6', size: 32, glow: '0 0 12px rgba(139,92,246,0.5)',
    pulse: 'venue-pulse-slow 3s ease-in-out infinite', fontSize, showRing: false, showCount: true,
  };
  if (headcount <= 60) return {
    stage: 3, color: '#F59E0B', size: 36, glow: '0 0 16px rgba(245,158,11,0.5)',
    pulse: 'venue-pulse-slow 2.5s ease-in-out infinite', fontSize, showRing: false, showCount: true,
  };
  if (headcount <= 120) return {
    stage: 4, color: '#EF4444', size: 42, glow: '0 0 20px rgba(239,68,68,0.5)',
    pulse: 'venue-pulse-medium 2s ease-in-out infinite', fontSize, showRing: false, showCount: true,
  };
  if (headcount <= 200) return {
    stage: 5, color: '#FF6B2C', size: 48, glow: '0 0 24px rgba(255,107,44,0.6)',
    pulse: 'venue-pulse-fast 1.5s ease-in-out infinite', fontSize, showRing: false, showCount: true,
  };
  // Stage 6: 201+
  if (headcount <= 350) return {
    stage: 6, color: '#EC4899', size: 54, glow: '0 0 30px rgba(236,72,153,0.6)',
    pulse: 'venue-pulse-fast 1.2s ease-in-out infinite', fontSize, showRing: true, showCount: true,
  };
  // Stage 7: 351+ legendary
  return {
    stage: 7, color: '#EC4899', size: 58, glow: '0 0 36px rgba(236,72,153,0.7), 0 0 60px rgba(236,72,153,0.3)',
    pulse: 'venue-pulse-legendary 1s ease-in-out infinite', fontSize, showRing: true, showCount: true,
  };
}
```

The DOM children were assembled per marker (lines 840–940):

```ts
const el = document.createElement('div');
el.className = 'venue-marker';
el.setAttribute('data-venue-id', venue.id);

const bubbleEl = document.createElement('div');
bubbleEl.className = 'venue-bubble';
const initVisuals = getVenueVisuals(0);
bubbleEl.style.width = `${initVisuals.size}px`;
bubbleEl.style.height = `${initVisuals.size}px`;
bubbleEl.style.background = initVisuals.color;
bubbleEl.style.boxShadow = initVisuals.glow;

const countEl = document.createElement('span');
countEl.className = 'venue-bubble-count';
bubbleEl.appendChild(countEl);

const ringEl = document.createElement('div');
ringEl.className = 'venue-ring';
ringEl.style.display = 'none';

const ring2El = document.createElement('div');
ring2El.className = 'venue-ring';
ring2El.style.display = 'none';

const glowEl = document.createElement('div');
glowEl.className = 'venue-heat-glow';
glowEl.style.display = 'none';

const particlesEl = document.createElement('div');
particlesEl.className = 'venue-particles';
particlesEl.style.display = 'none';
particlesEl.innerHTML = '<i class="vp vp1"></i><i class="vp vp2"></i><i class="vp vp3"></i>';

const coverEl = document.createElement('div');
coverEl.className = 'venue-cover-bubble';
const initCover = venue.cover_charge;
coverEl.textContent = initCover ? getCoverLabel(initCover) : 'FREE';
bubbleEl.appendChild(coverEl);

const featuredBadgeEl = document.createElement('div');
featuredBadgeEl.className = 'venue-featured-badge';
featuredBadgeEl.textContent = '\u{1F451}';
featuredBadgeEl.style.display = 'none';
bubbleEl.appendChild(featuredBadgeEl);

const labelEl = document.createElement('div');
labelEl.className = 'venue-label';
labelEl.textContent = getShortName(venue.name);

const liveEl = document.createElement('div');
liveEl.className = 'venue-live-badge';
liveEl.innerHTML = '<span class="blink"></span>LIVE';
liveEl.style.display = 'none';

el.appendChild(glowEl);
el.appendChild(particlesEl);
el.appendChild(ring2El);
el.appendChild(ringEl);
el.appendChild(bubbleEl);
el.appendChild(labelEl);
el.appendChild(featuredLabelEl);
el.appendChild(liveEl);
el.appendChild(priceTagEl);
```

#### The original pill CSS — still live in `src/index.css` lines 173–280

```css
.venue-marker {
  position: relative;
  width: 0;
  height: 0;
  overflow: visible;
  cursor: pointer;
  pointer-events: none;         /* children opt-in individually */
}

.venue-marker:active .venue-bubble {
  scale: 0.92 !important;
}

.venue-bubble {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) translateZ(0);
  -webkit-transform: translate(-50%, -50%) translateZ(0);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: visible;
  font-family: 'Satoshi', sans-serif;
  font-weight: 700;
  color: white;
  pointer-events: auto;
  cursor: pointer;
  z-index: 1;
  will-change: transform, width, height, background, box-shadow;
  -webkit-transition: width 0.4s ease, height 0.4s ease, background 0.4s ease, box-shadow 0.4s ease, opacity 0.3s ease;
  transition: width 0.4s ease, height 0.4s ease, background 0.4s ease, box-shadow 0.4s ease, opacity 0.3s ease;
  animation: venueAmbient 5s ease-in-out infinite;
  transition: width 0.8s ease, height 0.8s ease, background 0.8s ease, box-shadow 0.8s ease, opacity 0.8s ease;
}

/* Inner glow — lit from within effect on active bubbles */
.venue-bubble::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, rgba(255,255,255,0.20) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
  opacity: 0;
  transition: opacity 0.8s ease;
}

.venue-bubble.active-glow::before { opacity: 1; }

.venue-bubble-count {
  line-height: 1;
  position: relative;
  z-index: 1;
  font-weight: 800;
  letter-spacing: -0.5px;
  text-shadow: 0 0 10px rgba(255, 130, 0, 0.7), 0 2px 4px rgba(0, 0, 0, 0.9);
}

/* Outer ring — expanding radar ping for stages 6-7 */
.venue-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) translateZ(0);
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
  animation: ring-expand 2s ease-out infinite;
}

.venue-label {
  position: absolute;
  top: 18px;
  left: 0;
  transform: translateX(-50%);
  font-family: 'Satoshi', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: white;
  text-align: center;
  white-space: nowrap;
  text-shadow: 0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7);
  pointer-events: none;
}

.venue-live-badge { /* fixed offset below venue-label */
  position: absolute;
  top: 32px;
  left: 0;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 3px;
  font-family: 'Satoshi', sans-serif;
  font-size: 10px;
  font-weight: 700;
  color: #22C55E;
  letter-spacing: 0.05em;
  white-space: nowrap;
  pointer-events: none;
}

.venue-cover-bubble {
  position: absolute;
  top: -4px;
  right: -4px;
  transform: translate(50%, -50%);
  background: #22C55E;
  color: white;
  font-size: 9px;
  font-weight: 800;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  …
}
```

#### Earlier `git log --stat` for the bubble file

The bubble file itself has zero commit history (untracked). The
most recent commits that touched **adjacent map files** (full
`git show --stat`):

```
de8beee venuu v1.4.0 - launch ready          (src/components/Map/MapView.tsx 1844 lines added)
25b9e75 Remove orange special banner from map markers
0fcb41b Show venue special as orange banner below name on map markers
da01eb1 Strip debug console statements for production build
8acd7ca Add marker creation debug logs to diagnose Undeclared not showing
```

A full diff against the previous pill is **the entire current
working tree** vs `de8beee` — too long to inline here. See
`.recon/old_pill_snapshot/MapView.v1.4.0.tsx` for the pre-state.

---

## 4. Status & color logic

### Status names used today

Two independent label vocabularies coexist:

1. **Modern (engine output):** `Quiet | Lively | Busy | Packed | Surging | Unknown` —
   produced by the fusion engine and stored in
   `headcount_estimates.state_label`. Consumed by `LiveVenueBubble`,
   `MarketTicker`, `MoversDrawer`, etc. **No `FREE` value.** FREE is
   orthogonal — it lives on `venues.cover_charge` as a free-text
   string.

2. **Legacy (v1.4.0, still in `index.css`):** 8 stages by
   `headcount` integer brackets — `Stage 0 … Stage 7`. No
   `state_label`; the visual is keyed off raw headcount.

### Function mapping live numbers → state string

This computation is **not in the client**. The state label is
written by the SQL fusion function `compute_venue_estimate(uuid)`
(see `supabase/migrations/00039_…` and later). The client only
reads `estimate.state_label`. The capacity-to-state derivation
for the accuracy log is in
`supabase/migrations/00045_evaluate_bouncer_truth_signal.sql`:

```sql
CREATE OR REPLACE FUNCTION public.derive_true_state(
  p_count integer,
  p_effective_capacity integer
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_effective_capacity IS NULL OR p_effective_capacity <= 0 THEN NULL
    WHEN p_count::numeric / p_effective_capacity >= 0.85 THEN 'Packed'
    WHEN p_count::numeric / p_effective_capacity >= 0.60 THEN 'Busy'
    WHEN p_count::numeric / p_effective_capacity >= 0.30 THEN 'Lively'
    ELSE 'Quiet'
  END;
$$;
```

`Surging` is NOT a function of capacity — it's a function of
`delta_pct` vs the venue's own forecast curve. That logic lives
entirely in `compute_venue_estimate` (Step 6).

### Color token map for each status

`src/components/Map/LiveVenueBubble.tsx` lines 722–750. Two
modes (`explore` vs `market`):

```ts
const STATE_COLORS: Record<StateLabel, {
  explore: { primary: string; glow: string; text: string };
  market:  { primary: string; glow: string; text: string };
}> = {
  Quiet: {
    explore: { primary: '#5B6B8C', glow: 'rgba(91, 107, 140, 0.28)',  text: '#B3BFD8' },
    market:  { primary: '#6E80AC', glow: 'rgba(110, 128, 172, 0.55)', text: '#D6E0F0' },
  },
  Lively: {
    explore: { primary: '#FFD56B', glow: 'rgba(255, 213, 107, 0.35)', text: '#FFE9B0' },
    market:  { primary: '#FFC940', glow: 'rgba(255, 201, 64, 0.65)',  text: '#FFF1C8' },
  },
  Busy: {
    explore: { primary: '#FF8200', glow: 'rgba(255, 130, 0, 0.40)',   text: '#FFB347' },
    market:  { primary: '#FF6F00', glow: 'rgba(255, 111, 0, 0.65)',   text: '#FFC76E' },
  },
  Packed: {
    explore: { primary: '#E63956', glow: 'rgba(230, 57, 86, 0.40)',   text: '#FFADBE' },
    market:  { primary: '#FF2D58', glow: 'rgba(255, 45, 88, 0.65)',   text: '#FFC2CF' },
  },
  Surging: {
    explore: { primary: '#1FE89A', glow: 'rgba(31, 232, 154, 0.42)',  text: '#80FFC8' },
    market:  { primary: '#00FFB0', glow: 'rgba(0, 255, 176, 0.70)',   text: '#A8FFD8' },
  },
  Unknown: {
    explore: { primary: '#9098A8', glow: 'transparent',               text: 'rgba(255,255,255,0.5)' },
    market:  { primary: '#9098A8', glow: 'transparent',               text: 'rgba(255,255,255,0.5)' },
  },
};
```

`STATE_COLORS` consumed in `MarketLiveVenueBubbleInner`:

```ts
const colorMode: 'explore' | 'market' = marketView ? 'market' : 'explore';
const colors = (STATE_COLORS[stateLabel] ?? STATE_COLORS.Unknown)[colorMode];
```

CSS custom props are set on the bubble root, then individual
elements read `var(--state-primary)`, `var(--state-glow)`,
`var(--state-text)`.

The **Legacy** path (`LegacyLiveVenueBubbleInner`) uses a separate
`visualsFor()` palette with `background / textColor / edge`:

```ts
function visualsFor(state: StateLabel): StateVisuals {
  switch (state) {
    case 'Quiet':
      return { background: '#3D2A5E', textColor: '#C9B4E0', edge: '#5E4480' };
    case 'Lively':
      return { background: 'linear-gradient(135deg, #8B6520, #B8862F)', textColor: '#FFF8E7', edge: '#8B6520' };
    case 'Busy':
      return { background: 'linear-gradient(135deg, #6B2818, #8B3A20)', textColor: '#FFE8DC', edge: '#6B2818' };
    case 'Packed':
      return { background: 'linear-gradient(135deg, #4A0F1A, #6B1525)', textColor: '#F5D5DC', edge: '#4A0F1A' };
    case 'Surging':
      return { background: '#0A0A0A', textColor: '#00FFA3', edge: '#00FFA3' };
    case 'Unknown':
    default:
      return { background: 'rgba(30, 30, 30, 0.5)', textColor: '#8A8A95', edge: '#3A3A40' };
  }
}
```

The `--state-*` tokens in `src/index.css:39-43` (the older system)
are declared but **never consumed via `var()`** anywhere in the
tree — confirmed by grep.

### "🔥" / "over capacity" decision

`src/components/Map/LiveVenueBubble.tsx` lines 125–152
(`getCapacityText`, used only by Legacy path):

```ts
function getCapacityText(
  capacityPct: number | null,
  tier: ConfTier,
  state: StateLabel,
): string | null {
  if (capacityPct == null) return null;

  // Quiet venues at near-empty capacity skip the line entirely —
  // "0% full" reads as shaming. "Quiet" already says it.
  if (state === 'Quiet' && capacityPct < 0.10) return null;

  const pct = Math.round(capacityPct * 100);

  // Over-capacity is special regardless of confidence.
  if (pct >= 110) return 'over capacity 🔥';
  if (pct >= 100) return 'at capacity';

  if (tier === 'sharp')     return `${pct}% full`;
  if (tier === 'soft')      return `${pct}% full`;
  if (tier === 'tentative') {
    if (pct < 15) return 'barely there';
    if (pct < 35) return 'thinning';
    if (pct < 55) return 'about half';
    if (pct < 75) return 'filling fast';
    return 'almost full';
  }
  return null;
}
```

The Market path **does not use 🔥** — it shows a numeric percentage
in `.lvb-pill__capacity` and lets the CapacityRing (which caps at
100% and applies `drop-shadow` when over capacity) carry the
"over" semantics:

```ts
// CapacityRing.tsx
const isOverCapacity = capacityPct >= 1.0;
// …
filter: isOverCapacity ? `drop-shadow(0 0 6px ${glow})` : 'none',
```

### Capacity % calculation

The fusion engine stores `capacity_pct` in
`headcount_estimates.capacity_pct` as a fraction 0.0–1.0+ (can
exceed 1.0). It's `estimate / effective_capacity`. The client
multiplies by 100 and rounds for display:
`{Math.round(estimate.capacity_pct * 100)}%`.

### Threshold values

There is **no client-side threshold** that decides Lively vs Busy.
The engine writes the label. The only client thresholds are:

- `CapacityRing` renders when `capacity_pct >= 0.30`.
- `MarketLiveVenueBubbleInner` shows `.lvb-pill` only when
  `confidence_pct >= 35` and `state_label !== 'Unknown'`.
- `LegacyLiveVenueBubbleInner` shows the bubble at all when
  `confidence_pct >= 20` and `state_label !== 'Unknown'`.
- `MapView.hasUsableEstimate` toggles the React mount visibility
  when `confidence_pct >= 10` and `state_label !== 'Unknown'`.

The capacity-to-state thresholds for ground-truth comparison live
in SQL (`derive_true_state` quoted above):
`>= 0.85 Packed, >= 0.60 Busy, >= 0.30 Lively, else Quiet`.

---

## 5. Stock-market / momentum logic

### Where the % delta is computed

Server-side. The fusion function `compute_venue_estimate(uuid)`
(SQL, several migrations — most recently
`00043_compute_venue_estimate_weights_from_config.sql`) computes
`delta_pct` as a venue's current `estimate_pct` divided by its own
forecast `expected_pct` minus 1, expressed as percent. The
client never recomputes it.

The two views the ticker reads from:

`supabase/migrations/00049_city_pulse_view.sql`:

```sql
CREATE OR REPLACE VIEW public.city_pulse AS
WITH confident_estimates AS (
  SELECT
    v.city,
    he.delta_pct,
    he.confidence_pct,
    he.state_label,
    he.estimate
  FROM public.headcount_estimates he
  JOIN public.venues v ON v.id = he.venue_id
  WHERE v.is_active = true
    AND v.city IN ('knoxville', 'tampa', 'st_petersburg')
    AND (v.category IS NULL OR v.category NOT IN ('greek', 'fraternity'))
    AND he.confidence_pct >= 35
    AND he.delta_pct IS NOT NULL
    AND he.computed_at >= now() - interval '5 minutes'
)
SELECT
  city,
  COUNT(*) AS venues_with_signal,
  ROUND(AVG(delta_pct), 1) AS avg_delta_pct,
  ROUND(MAX(delta_pct), 1) AS top_riser_delta,
  ROUND(MIN(delta_pct), 1) AS top_faller_delta,
  COUNT(*) FILTER (WHERE state_label = 'Surging') AS surging_count,
  COUNT(*) FILTER (WHERE state_label IN ('Packed', 'Busy')) AS busy_count,
  COUNT(*) FILTER (WHERE state_label = 'Quiet') AS quiet_count,
  now() AS computed_at
FROM confident_estimates
GROUP BY city;
```

`supabase/migrations/00050_tonight_movers_view.sql`:

```sql
CREATE OR REPLACE VIEW public.tonight_movers AS
SELECT
  v.id AS venue_id,
  v.name AS venue_name,
  v.slug AS venue_slug,
  v.city,
  v.lat,
  v.lng,
  v.image_url,
  he.delta_pct,
  he.estimate,
  he.state_label,
  he.confidence_pct,
  he.trend,
  he.trend_rate,
  he.computed_at,
  CASE
    WHEN he.delta_pct >= 30 THEN 'top_riser'
    WHEN he.delta_pct >= 15 THEN 'rising'
    WHEN he.delta_pct <= -30 THEN 'top_faller'
    WHEN he.delta_pct <= -15 THEN 'falling'
    ELSE 'flat'
  END AS movement_tier,
  RANK() OVER (PARTITION BY v.city ORDER BY he.delta_pct DESC NULLS LAST) AS rank_in_city_desc,
  RANK() OVER (PARTITION BY v.city ORDER BY he.delta_pct ASC NULLS LAST) AS rank_in_city_asc
FROM public.headcount_estimates he
JOIN public.venues v ON v.id = he.venue_id
WHERE v.is_active = true
  AND v.city IN ('knoxville', 'tampa', 'st_petersburg')
  AND (v.category IS NULL OR v.category NOT IN ('greek', 'fraternity'))
  AND he.confidence_pct >= 35
  AND he.delta_pct IS NOT NULL
  AND he.computed_at >= now() - interval '5 minutes';
```

### Time window for delta

The view's `now() - interval '5 minutes'` is a **freshness gate**,
not the delta's measurement window. The actual delta measures
`estimate_pct` against `expected_pct` (the venue's own historical
forecast curve at the current hour). The freshness gate just says
"only show data that was fused in the last 5 minutes".

The fusion cron — see comment in `useHeatField.ts:147–150` — runs
**once per minute** producing ~78 events per minute (one per
active venue).

### Ranking selector for ticker

Client-side in `src/components/Market/MarketTicker.tsx:30–34`:

```tsx
const allMovers = [...risers, ...fallers]
  .filter(m => Math.abs(m.delta_pct) >= 3)
  .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));
```

Risers and fallers are fetched separately by `useTonightMovers`:

```ts
const [risersRes, fallersRes] = await Promise.all([
  supabase
    .from('tonight_movers')
    .select('*')
    .eq('city', city)
    .order('delta_pct', { ascending: false })
    .limit(limit),
  supabase
    .from('tonight_movers')
    .select('*')
    .eq('city', city)
    .order('delta_pct', { ascending: true })
    .limit(limit),
]);
```

`limit` defaults to 5, the ticker calls with 6, the panel calls
with 10.

### Cool Beans-style "rising fast • 31% in 10m" callout

**Not found.** The current ticker entry is:

```tsx
<span className="market-ticker__name">
  {m.venue_name.replace(/^The\s+/i, '').toUpperCase()}
</span>
<span className={`market-ticker__delta market-ticker__delta--${direction}`}>
  {direction === 'up' ? '▲' : '▼'}
  {sign}{Math.round(m.delta_pct)}%
</span>
<span className="market-ticker__sep" aria-hidden>·</span>
```

There is no "in 10m" annotation and no separate callout component.
The `trend_rate` field exists in `headcount_estimates` but is
currently only consumed to pick the breath-halo cycle speed (1.2s
/ 2.0s / 3.5s) via `pulseRateFor`.

`interpretBubble.ts` (the templated narrator at
`src/lib/interpretBubble.ts`) does produce phrases like *"Running
hot above a typical Friday"*, *"Going off right now — more than
double a typical night"*, *"Lit up tonight — way above a typical
Saturday"*, but the output of `interpretBubble` is **not used by
any current component**. It is imported by zero files
(grep confirmed). It exists for the Phase 5.2 card refactor that
hasn't shipped.

---

## 6. Halo / heatmap / "alive" feel

### Heatmap layer config

`src/components/Map/HeatFieldLayer.tsx` lines 70–146:

```ts
const BASE_LAYER_SPEC: any = {
  type: 'heatmap',
  source: BASE_SOURCE_ID,
  maxzoom: 16,
  paint: {
    'heatmap-weight': [
      'interpolate', ['linear'], ['get', 'heat_weight'],
      0,    0,
      0.3,  0.4,
      0.5,  0.6,
      0.7,  0.85,
      0.85, 1.0,
      1.0,  1.2,
    ],
    'heatmap-intensity': [
      'interpolate', ['exponential', 1.6], ['zoom'],
      6,  1.5,    // continental view — heat is THE map
      8,  2.5,    // regional view — venuu cities glow as constellation
      10, 2.8,    // metro view — neighborhood-level pulse
      12, 2.0,    // city view — heat strong but bubbles emerging
      13, 1.4,    // bubble layer takes over
      15, 0.8,    // bubbles dominate
      16, 0.3,    // heat fades to background haze
    ],
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0,    'rgba(10, 14, 28, 0)',         // transparent void
      0.08, 'rgba(45, 28, 78, 0.50)',      // softer entry purple
      0.20, 'rgba(78, 38, 110, 0.68)',     // deeper amethyst
      0.35, 'rgba(140, 70, 50, 0.74)',     // warm copper
      0.50, 'rgba(180, 75, 45, 0.80)',     // burnt orange
      0.65, 'rgba(165, 35, 60, 0.84)',     // crimson
      0.78, 'rgba(110, 25, 90, 0.86)',     // magenta-wine
      0.88, 'rgba(0, 130, 90, 0.86)',      // pre-Surging emerald
      0.95, 'rgba(0, 220, 145, 0.78)',
      1.0,  'rgba(50, 255, 175, 0.70)',    // peak luminous green
    ],
    'heatmap-radius': [
      'interpolate', ['exponential', 1.5], ['zoom'],
      6,  18,     // continental dots
      8,  35,     // city-sized blooms
      10, 60,
      12, 90,     // neighborhood smears blend together
      14, 120,
      16, 160,    // per-venue halos at high zoom
    ],
    'heatmap-opacity': 1.0, // overwritten every tick by the breath loop
  },
};

const HALO_LAYER_SPEC: any = {
  type: 'circle',
  source: HALO_SOURCE_ID,
  minzoom: 13,
  paint: {
    'circle-radius': [
      'interpolate', ['linear'], ['get', 'heat_weight'],
      0,    0,
      0.3,  30,
      0.5,  50,
      0.7,  75,
      0.85, 100,
      1.0,  130,
    ],
    'circle-color': [
      'match', ['get', 'state_label'],
      'Quiet',   'rgba(61, 42, 94, 0.45)',     // purple
      'Lively',  'rgba(94, 73, 35, 0.50)',
      'Busy',    'rgba(139, 64, 36, 0.55)',
      'Packed',  'rgba(125, 28, 51, 0.58)',
      'Surging', 'rgba(0, 200, 130, 0.50)',
      'rgba(0, 0, 0, 0)',                       // Unknown invisible
    ],
    'circle-blur': 1.0,
    'circle-opacity': 0.0, // overwritten every tick by the breath loop
  },
};
```

### Breath loop (the "alive" tick)

Lines 204–234 of the same file:

```ts
useEffect(() => {
  if (!mapLoaded) return;
  const interval = window.setInterval(() => {
    if (!layersAddedRef.current) return;
    const now = Date.now();
    const zoom = map.getZoom();

    // 60-second sinusoidal breath, ±5% amplitude
    const phase = (now % 60_000) / 60_000;
    const breathe = 0.95 + 0.10 * Math.sin(phase * Math.PI * 2);

    // 15% burst that decays linearly over 600ms (no hard step)
    const remaining = burstUntilRef.current - now;
    const burst = remaining > 0 ? 1.0 + 0.15 * (remaining / 600) : 1.0;

    // 10% intensity boost during nightlife hours
    const nightBoost = mode === 'night' ? 1.10 : 1.0;

    const baseOpacity = evalLinearStops(BASE_OPACITY_STOPS, zoom) * breathe * burst * nightBoost;
    const haloOpacity = evalLinearStops(HALO_OPACITY_STOPS, zoom) * breathe * burst * nightBoost;

    try {
      map.setPaintProperty(BASE_LAYER_ID, 'heatmap-opacity', Math.min(1.0, baseOpacity));
      map.setPaintProperty(HALO_LAYER_ID, 'circle-opacity', Math.min(1.0, haloOpacity));
    } catch {
      // layer briefly gone during a style swap — next tick recovers
    }
  }, 100);

  return () => window.clearInterval(interval);
}, [map, mapLoaded, mode]);
```

Opacity stops:

```ts
const BASE_OPACITY_STOPS: ReadonlyArray<readonly [number, number]> = [
  [6, 0.95],   // dominant at continental zoom
  [11, 1.0],
  [13, 0.85],  // letting bubbles through
  [15, 0.45],
  [17, 0.2],
];

const HALO_OPACITY_STOPS: ReadonlyArray<readonly [number, number]> = [
  [13, 0.0],
  [14, 0.6],
  [16, 0.85],
  [18, 0.5],
];
```

### Layer insertion order

```ts
// Halo first → base on top of halo, both below 3d-buildings.
if (!map.getLayer(HALO_LAYER_ID)) {
  map.addLayer({ id: HALO_LAYER_ID, ...HALO_LAYER_SPEC }, beforeId);
}
if (!map.getLayer(BASE_LAYER_ID)) {
  map.addLayer({ id: BASE_LAYER_ID, ...BASE_LAYER_SPEC }, beforeId);
}
```

`beforeId` is `'3d-buildings'` when that style layer exists. So
order from bottom to top: **halo (circle) → base (heatmap) → 3d-buildings → markers (HTML, separate layer)**.

### Per-marker glow / shadow

Already quoted in §2 — `.lvb-breath-halo` (radial-gradient child),
`.lvb-market-shell` box-shadow with `var(--state-glow)`, and
`.lvb-pill` box-shadow. No Skia, no SVG `feGaussianBlur` — only
`backdrop-filter: blur(14px) / blur(16px)` on the pills.

### Z-index map

From `src/index.css` design tokens (lines 86–96) and the inline
styles:

```
--z-map-base: 0
--z-map-controls: 5
--z-map-pulse-bar: 40
--z-map-fab: 45
--z-map-toggle: 45
--z-drawer-scrim: 100
--z-drawer-sheet: 101
--z-venny-scrim: 110
--z-venny-sheet: 111
--z-modal: 200
--z-toast: 300
```

VennyBar inline `zIndex: 590`. TheDrop inline `zIndex: 600`.
Inside the bubble: pill = z 3, name label = z 3, state-change ring
unset, halo = z -1.

---

## 7. Data flow — single pill from Supabase to pixels

### Supabase query / RPC

`src/hooks/useVenuesInBounds.ts` lines 61–93:

```ts
const fetchVenues = useCallback(async () => {
  if (!envReady) return;
  setError(false);

  const { data, error: err } = await supabase
    .from('venues')
    .select(`${VENUE_COLUMNS}, headcount_estimates(${ESTIMATE_COLUMNS})`)
    .in('city', LAUNCH_MARKETS as unknown as string[])
    .or('is_active.eq.true,is_active.is.null')
    .order('sort_order');
  // …
}, []);
```

Selected columns (lines 36–37):

```ts
const VENUE_COLUMNS = 'id, created_at, name, slug, city, category, address, lat, lng, image_url, deals, hours, instagram, vibe, has_live_cam, live_cam_url, cam_coming_soon, is_active, sort_order, capacity, is_clicker_live, staff_code, phone, website, description, rating, review_count, tonight_special, special_updated_at, cover_charge, featured, featured_label, loyalty_active, nfc_tag_id, nfc_required';
const ESTIMATE_COLUMNS = 'estimate, estimate_low, estimate_high, confidence_pct, capacity_pct, state_label, trend, trend_rate, computed_at, source_breakdown, delta_pct, expected_pct';
const LAUNCH_MARKETS = ['knoxville', 'tampa', 'st_petersburg'] as const;
```

The heatmap pulls from a separate view (`heat_points`) — see
`useHeatField.ts:69–73`:

```ts
const { data, error } = await supabase
  .from('heat_points')
  .select('venue_id, name, city, lat, lng, capacity, estimate, confidence_pct, capacity_pct, state_label, heat_weight, computed_at')
  .in('city', LAUNCH_MARKETS as unknown as string[]);
```

Market overlays pull from `city_pulse` and `tonight_movers` views
quoted in §5.

### Realtime channel subscriptions

`useVenuesInBounds.ts` has two channels:

1. `venues` table UPDATE — merges cover_charge / specials in place.
2. `headcount_estimates` table ALL — replaces the joined estimate.

Lines 130–183:

```ts
useEffect(() => {
  if (!envReady) return;
  const channel = supabase
    .channel(`estimates-rt-global-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'headcount_estimates' },
      (payload) => {
        const row = (payload.new ?? payload.old) as { venue_id?: string } | null;
        const venueId = row?.venue_id;
        if (!venueId) return;

        setVenues(prev => {
          const idx = prev.findIndex(v => v.id === venueId);
          if (idx === -1) return prev;
          const next = [...prev];
          if (payload.eventType === 'DELETE') {
            next[idx] = { ...next[idx], headcount_estimates: [] };
          } else {
            const newRow = payload.new as Record<string, unknown>;
            const estimate: HeadcountEstimate = {
              estimate: Number(newRow.estimate ?? 0),
              estimate_low: Number(newRow.estimate_low ?? 0),
              estimate_high: Number(newRow.estimate_high ?? 0),
              confidence_pct: Number(newRow.confidence_pct ?? 0),
              capacity_pct: newRow.capacity_pct == null
                ? null : Number(newRow.capacity_pct),
              state_label: String(newRow.state_label ?? 'Unknown'),
              trend: newRow.trend == null ? null : String(newRow.trend),
              trend_rate: newRow.trend_rate == null ? null : Number(newRow.trend_rate),
              computed_at: String(newRow.computed_at ?? new Date().toISOString()),
              source_breakdown: (newRow.source_breakdown as Record<string, unknown> | null) ?? null,
              delta_pct: newRow.delta_pct == null ? null : Number(newRow.delta_pct),
              expected_pct: newRow.expected_pct == null ? null : Number(newRow.expected_pct),
            };
            next[idx] = { ...next[idx], headcount_estimates: [estimate] };
          }
          return next;
        });
      }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, []);
```

`useHeatField` also subscribes to `headcount_estimates` for the
heatmap refresh, throttled to one refetch every 5 seconds.

A third event-bus handler listens for `'venues-cover-update'`
window events (Portal dispatches these for instant cover updates).

### State layer

**Local component state only.** No Zustand, no Redux, no React
Query, no Context for venue data. `useVenuesInBounds` holds a
single `useState<VenueWithEstimate[]>` array. Components subscribe
by calling the hook directly (or by being passed venues as props
from `TonightPage`).

Confirmed dependencies — no state library in `package.json`:

```
@stripe/stripe-js
@supabase/supabase-js
canvas-confetti
framer-motion
lucide-react
mapbox-gl
react / react-dom
```

### Where % delta is joined onto the venue object

`headcount_estimates.delta_pct` lives in the joined nested array
`venue.headcount_estimates[0].delta_pct`. The same field is also
exposed via the `tonight_movers` view as a top-level column when
queried directly.

Type definition (`useVenuesInBounds.ts:16-29`):

```ts
export interface HeadcountEstimate {
  estimate: number;
  estimate_low: number;
  estimate_high: number;
  confidence_pct: number;
  capacity_pct: number | null;
  state_label: string;
  trend: string | null;
  trend_rate: number | null;
  computed_at: string;
  source_breakdown: Record<string, unknown> | null;
  delta_pct: number | null;
  expected_pct: number | null;
}
```

### Refresh cadence

- Initial fetch on mount.
- Realtime push from Postgres on every UPDATE/INSERT to
  `headcount_estimates` (~78 events/min during operating hours).
- `useTonightMovers` and `useCityPulse` each set a 60-second
  `window.setInterval` poll on top of (no) realtime — they only
  poll, no realtime channel.
- `useHeatField` realtime + 5 s throttle to coalesce bursts.
- The HeatFieldLayer's breath loop is a 100 ms client tick (not a
  data refresh — just an opacity oscillation).

---

## 8. Design tokens

### Color palette / theme tokens — `src/index.css` lines 4–97

```css
:root {
  --font-display: 'Satoshi', -apple-system, sans-serif;

  /* Brand */
  --brand-orange: #FF8200;
  --brand-orange-hover: #FF5E1A;
  --brand-orange-glow: rgba(255, 130, 0, 0.45);
  --brand-orange-tint: rgba(255, 130, 0, 0.18);
  --brand-orange-tint-strong: rgba(255, 130, 0, 0.25);

  /* Backgrounds */
  --bg-page: #050507;
  --bg-card: #111114;
  --bg-elevated: #1C1C2E;
  --bg-glass: rgba(15, 15, 22, 0.92);

  /* Borders */
  --border-hairline: #1A1A1E;
  --border-card: #2A2A30;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-glass: rgba(255, 255, 255, 0.06);

  /* Text */
  --text-primary: #FFFFFF;
  --text-secondary: #8A8A95;
  --text-muted: #55555F;
  --text-faded: #2A2A30;

  /* State colors — declared but unconsumed via var() anywhere */
  --state-surging: #00FFA3;
  --state-busy: #FF4444;
  --state-quiet: #C9B4E0;
  --state-lively: #F2D58A;

  /* Avatar palette */
  --avatar-orange: #FF8200;
  --avatar-cyan: #00D4FF;
  --avatar-purple: #9B5EFF;
  --avatar-green: #00CC66;
  --avatar-pink: #FF5E9C;
  --avatar-gold: #FFD700;
  --avatar-sienna: #B8623A;
  --avatar-wine: #8B2543;

  /* Type ramp */
  --fs-caption: 11px;
  --fs-meta: 12px;
  --fs-small: 13px;
  --fs-body: 14px;
  --fs-emphasis: 15px;
  --fs-section: 16px;
  --fs-title: 20px;
  --fs-display: 28px;
  --fs-hero: 36px;

  /* Radius */
  --r-chip: 8px;
  --r-card: 12px;
  --r-modal: 16px;
  --r-pill: 999px;
  --r-sheet: 24px;

  /* Motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --d-fast: 180ms;
  --d-base: 280ms;
  --d-slow: 480ms;

  /* Z-INDEX SCALE */
  --z-map-base: 0;
  --z-map-controls: 5;
  --z-map-pulse-bar: 40;
  --z-map-fab: 45;
  --z-map-toggle: 45;
  --z-drawer-scrim: 100;
  --z-drawer-sheet: 101;
  --z-venny-scrim: 110;
  --z-venny-sheet: 111;
  --z-modal: 200;
  --z-toast: 300;
}
```

The market-mode bubble palette (which IS the live state palette
actually used) is in TS not CSS — see §4 STATE_COLORS.

### Typography scale

- Display font: Satoshi (`@import url('https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap')` at top of `index.css`).
- Size ramp: `--fs-caption 11 / --fs-meta 12 / --fs-small 13 / --fs-body 14 / --fs-emphasis 15 / --fs-section 16 / --fs-title 20 / --fs-display 28 / --fs-hero 36`.
- The bubble pill uses 8 px / 17 px / 9 px (state / count / capacity) — these are inline, not from the ramp.

### Spacing scale

Implicit. No `--space-*` tokens. Spacing in the bubble pill is
inline `padding: 6px 12px`, `gap: 1px / 2px`, `top: calc(100% + 8px)`,
`top: calc(100% + 68px)` (name label below pill).

### Animation duration / easing tokens

```
--ease-out: cubic-bezier(0.16, 1, 0.3, 1)
--d-fast:  180ms
--d-base:  280ms
--d-slow:  480ms
```

These are declared but used inconsistently. Most pill animation
durations are inline:
- `lvb-pill-rise` 280 ms `cubic-bezier(0.34, 1.56, 0.64, 1)`
- `lvb-fade-in` 220 ms `cubic-bezier(0.4, 0, 0.2, 1)`
- `lvb-market-breath` 3.5 s ease-in-out
- `lvb-market-dot-pulse` 2.4 s ease-in-out
- `lvb-state-change-ring` 920 ms `cubic-bezier(0.16, 1, 0.3, 1)`
- `lvb-mv-enter` 560 ms `cubic-bezier(0.16, 1, 0.3, 1)`
- `lvb-spotlight-pulse` 1.6 s `cubic-bezier(0.4, 0, 0.6, 1)`
- `lvb-mv-surging-ring-1/2` 2 s `cubic-bezier(0.4, 0, 0.6, 1)`
- `lvb-breath` `var(--pulse-cycle, 3.5s)` ease-in-out
  (`--pulse-cycle` = 1.2s / 2s / 3.5s based on `trend_rate`).
- `market-ticker-scroll` 30 s linear infinite
- `city-pulse-sweep` 3.2 s ease-in-out infinite

---

## 9. Known unknowns

- **Two pill systems coexisting.** The legacy DOM `.venue-bubble`
  pill is still constructed by `MapView.tsx` for **every marker**,
  and is only hidden (not removed) when the React `LiveVenueBubble`
  mount becomes "usable". When `confidence_pct < 10` or `state_label === 'Unknown'`,
  the legacy DOM bubble carries the visual. `.venue-bubble` + the
  React pill have completely different visual languages, color
  palettes, and animation durations.
- **Two LiveVenueBubble paths inside one file** —
  `LegacyLiveVenueBubbleInner` (lines 251–517) and
  `MarketLiveVenueBubbleInner` (lines 805–989). They share the same
  `LiveVenueBubbleProps`. The public export branches on
  `FEATURE_FLAGS.MARKET_UX === 'true'`. With the env var set to
  true (current state per `.env`), only the Market path renders;
  Legacy is dead code in production but TypeScript-checked.
- **`interpretBubble.ts` is imported by zero callers.** It's the
  intended source of truth for narration sentences ("Lit up
  tonight — way above a typical Friday") but no component reads it.
- **`MoversDrawer` exported but never rendered.** `MoversChip` is
  the only consumer of `useTonightMovers`'s output that the user
  actually sees beyond the ticker. The bottom-sheet
  `<MoversDrawer>` is dead in the tree.
- **`--state-*` tokens in `:root` are unused.** `--state-surging`,
  `--state-busy`, `--state-quiet`, `--state-lively` are declared
  but no `var(--state-*)` reference exists in the tree.
- **Inconsistent Surging colors.** Legacy `visualsFor()` uses
  `#00FFA3`. Modern explore mode uses `#1FE89A`. Modern market mode
  uses `#00FFB0`. Heatmap halo Surging uses `rgba(0, 200, 130, 0.50)`.
  `.lvb-surging-stack .lvb-state` text-shadow uses
  `rgba(0, 255, 163, 0.45)`. **Five different "Surging greens"**
  across the codebase. (Also see `index.css:40 --state-surging: #00FFA3`.)
- **Inconsistent state name capitalization across systems.** The DB
  stores PascalCase (`Quiet | Lively | Busy | Packed | Surging | Unknown`).
  CSS uses lowercase (`lvb-state-quiet`, `mover-row__state--quiet`).
  Mapbox `match` expressions use PascalCase. Heatmap config uses
  PascalCase. Consumer-visible text on the pill is uppercased via
  `text-transform: uppercase`.
- **`useVenues.ts` is `@deprecated` per its own JSDoc** but still
  imported. Grep should be re-run to confirm whether anyone other
  than the deprecated file itself uses the deprecated re-export.
- **Hardcoded thresholds scattered.**
  - `confidence_pct >= 35` appears in `LiveVenueBubble` (pill gate),
    `city_pulse` view (`>= 35`), `tonight_movers` view (`>= 35`),
    and `interpretBubble.ts` (`< 35` triggers "reading is light").
  - `confidence_pct >= 20` appears in `LegacyLiveVenueBubbleInner`
    (legacy gate) and `getConfTier` boundaries (`>= 60 / >= 30 / >= 20`).
  - `confidence_pct >= 10` appears in `MapView.hasUsableEstimate`.
  - `capacity_pct >= 0.30` appears in `CapacityRing` default
    threshold and in `derive_true_state` SQL function (also
    `>= 0.30 Lively`).
  - `capacity_pct >= 0.05` appears in the pill conditional render.
  - `capacity_pct >= 0.85 / 0.60 / 0.30` in `derive_true_state` SQL.
  - `delta_pct >= 30 / 15 / -15 / -30` in `tonight_movers` SQL
    (movement_tier).
  - `|delta_pct| >= 3` in `MarketTicker` filter (was 10 in a
    previous iteration).
  - `|trend_rate| > 1.0 / > 0.5` in `pulseRateFor` and
    `getPulseClass`.
- **`getZoomTier` and the prior `zoomTier` have different
  thresholds.** `zoomTier` (legacy) used `< 13` for wide.
  `getZoomTier` (Phase 5.2) uses `< 12`. Both have lived in the
  same file at different times — only `getZoomTier` is current.
- **The Pile of `venue-*` legacy CSS in `index.css`** could be
  deleted but isn't, because `MapView.tsx`'s marker construction
  still references those class names for the underlying DOM
  bubble. Any refactor that kills the legacy DOM bubble must also
  delete those rules (lines ~173–600 of `index.css`).
- **`featureFlags.ts` is untracked.** Removing the flag (e.g. ship
  Market UX permanently) requires either committing it first or
  inlining the constant.
- **No mismatch between "mobile" and "operator web" pill prop
  names** because there is no separate operator web app. The
  Portal tab uses entirely different surfaces (no map markers).

---

## 10. Environment

```
Node:    v22.22.2
npm:     10.9.7
Package manager: npm (lockfile: package-lock.json)
React Native:    — (not used; this is Capacitor + Vite)
Expo:            — (not used)
Mapbox GL JS:    mapbox-gl ^3.18.1
react-native-maps / MapLibre: — (not used)
Reanimated:      — (not used)
react-native-skia: — (not used)
react-native-svg: — (not used)
framer-motion:   ^12.38.0
Vite:            ^7.3.1
Supabase JS:     @supabase/supabase-js ^2.95.3
Capacitor:       @capacitor/core ^8.1.0  (ios ^8.3.0, cli ^8.1.0)
React:           ^19.2.0  /  react-dom ^19.2.0
Tailwind:        tailwindcss ^4.1.18 + @tailwindcss/vite ^4.1.18
TypeScript:      ~5.9.3
```

Lockfile present at `./package-lock.json`. No `yarn.lock`, no
`pnpm-lock.yaml`.

Scripts:
```
dev:        vite
build:      tsc -b && vite build
lint:       eslint .
preview:    vite preview
postinstall: bash scripts/patch-apple-sign-in.sh
```
