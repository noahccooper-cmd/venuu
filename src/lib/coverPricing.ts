/**
 * venuu Dynamic Cover Pricing Algorithm
 * Pure functions — no side effects, no API calls, no database access.
 * All prices in CENTS (integers). $7.40 = 740. Never floats.
 * DETERMINISTIC — same inputs always produce same output.
 *
 * EXPECTED BEHAVIOR:
 * ─────────────────────────────────────────────────────────────────
 * base=500, cap=2000, capacity=100
 *
 *   0 sold,  early night (10% time) → $5.00 (base price, no demand)
 *  10 sold,  80% through night     → $5.00 (time decay pulls down — slow night)
 *  25 sold,  25% through night     → $6.90 (demand on schedule)
 *  50 sold,  25% through night     → $10.30 (demand AHEAD of schedule — price climbs)
 *  50 sold,  50% through night     → $10.30 (demand matches time — on schedule)
 *  50 sold,  75% through night     → $9.70 (demand behind — time decay kicks in)
 *  80 sold,  60% through night     → $15.70 (selling fast — convex curve accelerating)
 *  80 sold,  60% + 8 recent sales  → $17.10 (velocity surge on top)
 *  95 sold,  any time              → $19.10 (almost sold out — near cap)
 * 100 sold (sold out)              → $20.00 (cap price, isSoldOut=true)
 *   0 sold,  past close_time       → $5.00 (isClosed=true, base price returned)
 * ─────────────────────────────────────────────────────────────────
 */

export interface PricingInputs {
  basePrice: number;       // cents — floor price
  capPrice: number;        // cents — ceiling price
  capacity: number;        // total covers available
  coversSold: number;      // how many sold so far
  openTime: Date;          // when covers went on sale
  closeTime: Date;         // when covers stop selling
  currentTime: Date;       // right now
  recentSales?: number;    // covers sold in last 5 minutes (for velocity surge)
  lastRecordedPrice?: number; // cents — previous tick price (for direction)
}

export interface PricingOutput {
  currentPrice: number;    // cents — what the next cover costs
  priceDirection: 'up' | 'down' | 'stable';
  soldPercentage: number;  // 0-100
  timePercentage: number;  // 0-100
  coversRemaining: number;
  estimatedRevenue: number; // cents — projected total if sold out at current trajectory
  isSoldOut: boolean;
  isClosed: boolean;
}

/**
 * Calculate the current dynamic cover price.
 *
 * Three forces:
 * 1. DEMAND PRESSURE (↑): convex curve soldRatio^1.5 — accelerates as you sell out
 * 2. TIME DECAY (↓): gentle pull when demand lags behind time schedule
 * 3. VELOCITY SURGE (↑): short-term spike during rapid sales (5min window)
 *
 * Formula:
 *   priceFactor = clamp(0, 1, demandFactor + velocityBonus - timeDiscount)
 *   price = basePrice + priceRange * priceFactor, rounded to 10 cents
 */
export function calculatePrice(inputs: PricingInputs): PricingOutput {
  const {
    basePrice, capPrice, capacity, coversSold,
    openTime, closeTime, currentTime,
    recentSales = 0,
    lastRecordedPrice,
  } = inputs;

  const coversRemaining = Math.max(0, capacity - coversSold);
  const isSoldOut = coversRemaining === 0;
  const isClosed = currentTime >= closeTime;
  const priceRange = capPrice - basePrice;

  // Time ratios
  const totalWindow = closeTime.getTime() - openTime.getTime();
  const elapsed = Math.max(0, currentTime.getTime() - openTime.getTime());
  const timeRatio = totalWindow > 0 ? Math.min(elapsed / totalWindow, 1) : 1;
  const timePercentage = Math.round(timeRatio * 100);

  // Demand ratios
  const soldRatio = capacity > 0 ? coversSold / capacity : 0;
  const soldPercentage = Math.round(soldRatio * 100);

  // Terminal states
  if (isSoldOut) {
    return {
      currentPrice: capPrice,
      priceDirection: 'stable',
      soldPercentage,
      timePercentage,
      coversRemaining: 0,
      estimatedRevenue: coversSold * Math.round((basePrice + capPrice) / 2),
      isSoldOut: true,
      isClosed,
    };
  }
  if (isClosed) {
    return {
      currentPrice: basePrice,
      priceDirection: 'stable',
      soldPercentage,
      timePercentage,
      coversRemaining,
      estimatedRevenue: coversSold * Math.round((basePrice + capPrice) / 2),
      isSoldOut: false,
      isClosed: true,
    };
  }

  // ── FORCE 1: Demand Pressure ──
  // Convex curve: first 50% sold → ~35% of range, last 50% → ~65%
  const demandFactor = Math.pow(soldRatio, 1.5);

  // ── FORCE 2: Time Decay ──
  // Only activates when demand LAGS behind time (slow night)
  const demandDeficit = Math.max(0, timeRatio - soldRatio);
  const timeDiscount = demandDeficit * 0.15;

  // ── FORCE 3: Velocity Surge ──
  // 5+ in 5 min = surge. Each recent sale adds 2%, capped at 10%.
  const velocityBonus = Math.min(0.1, recentSales * 0.02);

  // ── Combined ──
  const priceFactor = Math.max(0, Math.min(1, demandFactor + velocityBonus - timeDiscount));
  const rawPrice = basePrice + Math.round(priceRange * priceFactor);

  // Clamp and round to 10 cents
  const clampedPrice = Math.max(basePrice, Math.min(capPrice, rawPrice));
  const currentPrice = Math.round(clampedPrice / 10) * 10;

  // Direction: compare to last recorded price if available, else infer from previous sold count
  let priceDirection: 'up' | 'down' | 'stable' = 'stable';
  if (lastRecordedPrice !== undefined) {
    if (currentPrice > lastRecordedPrice) priceDirection = 'up';
    else if (currentPrice < lastRecordedPrice) priceDirection = 'down';
  } else {
    const prevSoldRatio = capacity > 0 ? Math.max(0, coversSold - 1) / capacity : 0;
    const prevFactor = Math.max(0, Math.min(1, Math.pow(prevSoldRatio, 1.5) - timeDiscount));
    const prevPrice = Math.round(Math.max(basePrice, Math.min(capPrice, basePrice + Math.round(priceRange * prevFactor))) / 10) * 10;
    if (currentPrice > prevPrice) priceDirection = 'up';
    else if (currentPrice < prevPrice) priceDirection = 'down';
  }

  // Revenue estimate: average of sold prices + remaining at current price
  const avgSoldPrice = coversSold > 0 ? Math.round((basePrice + currentPrice) / 2) : 0;
  const estimatedRevenue = (coversSold * avgSoldPrice) + (coversRemaining * currentPrice);

  return {
    currentPrice,
    priceDirection,
    soldPercentage,
    timePercentage,
    coversRemaining,
    estimatedRevenue,
    isSoldOut,
    isClosed,
  };
}

/* ── Display Formatting ── */

/** Format cents to dollar string: 740 → "$7.40" */
export function formatCoverPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format cents to compact string: 740 → "$7.40", 1000 → "$10" */
export function formatCoverPriceShort(cents: number): string {
  const d = cents / 100;
  return d % 1 === 0 ? `$${d}` : `$${d.toFixed(2)}`;
}

/* ── Fee Calculation ── */

/**
 * venuu takes 8%, bar gets 92%.
 * calculateFees(1000) → { platformFee: 80, venuePayout: 920 }
 */
export function calculateFees(priceCents: number): { platformFee: number; venuePayout: number } {
  const platformFee = Math.round(priceCents * 0.08);
  const venuePayout = priceCents - platformFee;
  return { platformFee, venuePayout };
}

/* ── Revenue Estimation ── */

/** Estimate total revenue if sold out at current price trajectory. */
export function estimateRevenue(inputs: PricingInputs): number {
  return calculatePrice(inputs).estimatedRevenue;
}

/* ── QR Code Generation & Validation ── */

/**
 * Generate a unique QR code string for a cover purchase.
 * Format: VENUU-{purchaseId first 8}-{venueId first 8}
 * Deterministic from IDs — no randomness, can be regenerated.
 */
export function generateQRCode(purchaseId: string, venueId: string): string {
  const pPart = purchaseId.replace(/-/g, '').substring(0, 8).toUpperCase();
  const vPart = venueId.replace(/-/g, '').substring(0, 8).toUpperCase();
  return `VENUU-${pPart}-${vPart}`;
}

/**
 * Parse and validate a QR code scanned at the door.
 * Returns the purchase and venue ID fragments, or null if invalid format.
 */
export function parseQRCode(qrString: string): { purchaseIdFragment: string; venueIdFragment: string } | null {
  const trimmed = qrString.trim().toUpperCase();
  const match = trimmed.match(/^VENUU-([A-Z0-9]{8})-([A-Z0-9]{8})$/);
  if (!match) return null;
  return { purchaseIdFragment: match[1], venueIdFragment: match[2] };
}

/* ── Future Price Projection ── */

/**
 * Project what the price will be in N minutes at a given sales rate.
 * Used for urgency display: "In 30 min this could be $12.40"
 */
export function projectFuturePrice(
  inputs: PricingInputs,
  minutesAhead: number,
  estimatedSalesPerMinute: number,
): number {
  const futureTime = new Date(inputs.currentTime.getTime() + minutesAhead * 60000);
  const futureSold = Math.min(
    inputs.capacity,
    inputs.coversSold + Math.round(estimatedSalesPerMinute * minutesAhead),
  );
  return calculatePrice({
    ...inputs,
    currentTime: futureTime,
    coversSold: futureSold,
    lastRecordedPrice: undefined,
    recentSales: 0,
  }).currentPrice;
}

/*
 * ═══════════════════════════════════════════════════════════
 * TEST CASES (expected behavior documentation)
 * base=500 ($5), cap=2000 ($20), capacity=100
 * open=6pm, close=1:30am (7.5 hour window)
 * ═══════════════════════════════════════════════════════════
 *
 * SCENARIO 1: Empty night, early
 *   coversSold=0, time=10% (6:45pm)
 *   demandFactor = 0^1.5 = 0
 *   timeDiscount = max(0, 0.1-0) * 0.15 = 0.015
 *   priceFactor = max(0, 0 - 0.015) = 0
 *   → $5.00 (base price, no demand)
 *
 * SCENARIO 2: Slow night — behind schedule
 *   coversSold=10, time=80% (12:30am)
 *   demandFactor = 0.1^1.5 = 0.032
 *   timeDiscount = max(0, 0.8-0.1) * 0.15 = 0.105
 *   priceFactor = max(0, 0.032 - 0.105) = 0
 *   → $5.00 (time decay pulls to floor — slow night, price stays low)
 *
 * SCENARIO 3: On schedule
 *   coversSold=50, time=50% (9:45pm)
 *   demandFactor = 0.5^1.5 = 0.354
 *   timeDiscount = max(0, 0.5-0.5) * 0.15 = 0
 *   priceFactor = 0.354
 *   → $5 + $15 * 0.354 = $10.30 (mid-range, fair price)
 *
 * SCENARIO 4: Demand AHEAD of schedule (selling fast)
 *   coversSold=50, time=25% (7:52pm)
 *   demandFactor = 0.5^1.5 = 0.354
 *   timeDiscount = max(0, 0.25-0.5) * 0.15 = 0 (demand ahead, no discount)
 *   priceFactor = 0.354
 *   → $10.30 (same price regardless — demand drives, not time)
 *
 * SCENARIO 5: Almost sold out
 *   coversSold=80, time=60% (10:30pm)
 *   demandFactor = 0.8^1.5 = 0.716
 *   timeDiscount = max(0, 0.6-0.8) * 0.15 = 0 (demand ahead)
 *   priceFactor = 0.716
 *   → $5 + $15 * 0.716 = $15.70
 *
 * SCENARIO 6: Velocity surge (rush hour)
 *   coversSold=80, time=60%, recentSales=8
 *   velocityBonus = min(0.1, 8*0.02) = 0.1
 *   priceFactor = 0.716 + 0.1 = 0.816
 *   → $5 + $15 * 0.816 = $17.20
 *
 * SCENARIO 7: Sold out
 *   coversSold=100 → $20.00 (cap price, isSoldOut=true)
 *
 * SCENARIO 8: Past close time
 *   currentTime > closeTime → $5.00 (base, isClosed=true)
 */
