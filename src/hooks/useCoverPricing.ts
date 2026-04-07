import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, envReady } from '../lib/supabase';
import { CITIES, type CityKey } from '../lib/constants';
import { getTonightDate } from '../lib/nightlyCode';
import type { CoverConfig } from '../lib/types';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5b3V2aHRnendjYnFweWxjc3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzQ5NDYsImV4cCI6MjA4Njc1MDk0Nn0.kr1qQ1jyFBaNDP351aMihxNO3K4GFf_XJEfHRZ9MZ-E';
const TICK_URL = 'https://tyouvhtgzwcbqpylcssk.supabase.co/functions/v1/tick-cover-prices';

export interface CoverPriceInfo {
  configId: string;
  currentPrice: number;      // display price (may include micro-tick)
  serverPrice: number;       // last confirmed price from DB
  previousPrice: number;
  priceDirection: 'up' | 'down' | 'stable';
  priceColor: string;        // '#00FF88' (above base), '#FFFFFF' (at base), '#FF8200' (dropping)
  coversRemaining: number;
  capacity: number;
  coversSold: number;
  basePrice: number;
  capPrice: number;
  isSoldOut: boolean;
  isFlat: boolean;           // base === cap → no ticking
}

function getPriceColor(current: number, base: number, previous: number): string {
  if (current > base) return '#00FF88';   // above base = green
  if (current < previous) return '#FF8200'; // dropping = orange
  return '#FFFFFF';                        // at base = white
}

export function useCoverPricing(city: CityKey) {
  const [coverPrices, setCoverPrices] = useState<Map<string, CoverPriceInfo>>(new Map());
  const prevPricesRef = useRef<Map<string, number>>(new Map());
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const microTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const nightOf = getTonightDate();

  const buildInfo = useCallback((config: CoverConfig, prevPrice: number): CoverPriceInfo => {
    let direction: 'up' | 'down' | 'stable' = 'stable';
    if (config.current_price > prevPrice) direction = 'up';
    else if (config.current_price < prevPrice) direction = 'down';
    const remaining = Math.max(0, config.capacity - config.covers_sold);
    const isFlat = config.base_price === config.cap_price;

    return {
      configId: config.id,
      currentPrice: config.current_price,
      serverPrice: config.current_price,
      previousPrice: prevPrice,
      priceDirection: isFlat ? 'stable' : direction,
      priceColor: isFlat ? '#FFFFFF' : getPriceColor(config.current_price, config.base_price, prevPrice),
      coversRemaining: remaining,
      capacity: config.capacity,
      coversSold: config.covers_sold,
      basePrice: config.base_price,
      capPrice: config.cap_price,
      isSoldOut: remaining === 0,
      isFlat,
    };
  }, []);

  const fetchConfigs = useCallback(async () => {
    if (!envReady) return;
    console.debug('[covers] Fetching configs for night_of:', nightOf, 'city:', city);

    // Step 1: Get venue IDs for this city (avoid fragile inner join)
    const dbCity = CITIES[city].dbCity;
    const { data: venueRows } = await supabase
      .from('venues')
      .select('id')
      .ilike('city', `%${dbCity}%`);

    if (!venueRows?.length) {
      console.debug('[covers] No venues found for city:', dbCity);
      return;
    }

    const venueIds = venueRows.map((v: { id: string }) => v.id);

    // Step 2: Get active cover configs for those venues tonight
    const { data, error } = await supabase
      .from('cover_configs')
      .select('*')
      .in('venue_id', venueIds)
      .eq('night_of', nightOf)
      .eq('is_active', true);

    if (error) {
      console.warn('[covers] Query error:', error.message);
      return;
    }

    console.debug(`[covers] Found ${data?.length ?? 0} active configs`);

    if (data) {
      const map = new Map<string, CoverPriceInfo>();
      for (const config of data as CoverConfig[]) {
        const prevPrice = prevPricesRef.current.get(config.venue_id) ?? config.current_price;
        map.set(config.venue_id, buildInfo(config, prevPrice));
        prevPricesRef.current.set(config.venue_id, config.current_price);
      }
      setCoverPrices(map);
      console.debug(`[covers] Price map set with ${map.size} venues`);
    }
  }, [city, nightOf, buildInfo]);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  // Realtime subscription for REAL price updates (purchases, server ticks)
  useEffect(() => {
    if (!envReady) return;
    const channel = supabase
      .channel(`cover-prices-rt-${city}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cover_configs' },
        (payload) => {
          const row = payload.new as CoverConfig;
          if (row.night_of !== nightOf || !row.is_active) return;
          setCoverPrices(prev => {
            const next = new Map(prev);
            const prevPrice = next.get(row.venue_id)?.serverPrice ?? row.current_price;
            next.set(row.venue_id, buildInfo(row, prevPrice));
            prevPricesRef.current.set(row.venue_id, row.current_price);
            return next;
          });
        }
      )
      .subscribe();
    // Also subscribe to cover_purchases for purchase spike visual
    const purchaseChannel = supabase
      .channel(`cover-purchases-rt-${city}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cover_purchases' },
        (payload) => {
          const row = payload.new as { venue_id: string };
          console.debug('[covers] Purchase detected at', row.venue_id);
          // Trigger a refetch to get updated covers_sold count
          fetchConfigs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(purchaseChannel);
    };
  }, [city, nightOf, buildInfo, fetchConfigs]);

  // Server tick: recalculate every 30 seconds
  useEffect(() => {
    if (!envReady) return;
    tickIntervalRef.current = setInterval(() => {
      fetch(TICK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ night_of: nightOf }),
      }).catch(() => {});
    }, 30000);
    return () => { if (tickIntervalRef.current) clearInterval(tickIntervalRef.current); };
  }, [nightOf]);

  // Client-side micro-ticks: small cosmetic fluctuation every 10 seconds (no server call)
  useEffect(() => {
    microTickRef.current = setInterval(() => {
      setCoverPrices(prev => {
        let changed = false;
        const next = new Map(prev);
        next.forEach((info, venueId) => {
          if (info.isFlat || info.isSoldOut) return;
          // ±$0.05-0.15 random fluctuation around server price
          const jitter = Math.round((Math.random() - 0.5) * 20); // -10 to +10 cents
          const microPrice = Math.max(info.basePrice, Math.min(info.capPrice, info.serverPrice + jitter));
          const rounded = Math.round(microPrice / 10) * 10;
          if (rounded !== info.currentPrice) {
            changed = true;
            next.set(venueId, {
              ...info,
              previousPrice: info.currentPrice,
              currentPrice: rounded,
              priceDirection: rounded > info.currentPrice ? 'up' : rounded < info.currentPrice ? 'down' : 'stable',
              priceColor: getPriceColor(rounded, info.basePrice, info.currentPrice),
            });
          }
        });
        return changed ? next : prev;
      });
    }, 10000);
    return () => { if (microTickRef.current) clearInterval(microTickRef.current); };
  }, []);

  return { coverPrices };
}
