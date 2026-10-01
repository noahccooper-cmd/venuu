import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BRANDS_FROM_DEMO, DEMO_BRANDS, toBrand, type Brand } from '../lib/brands';

let cache: Brand[] | null = BRANDS_FROM_DEMO ? DEMO_BRANDS : null;

/**
 * Active partner brands (RLS: brands_read_active). Read once per session.
 * Before 00077 is applied the table doesn't exist → [] (no Partner Worlds).
 */
export function useBrands(refreshKey = 0): Brand[] {
  const [brands, setBrands] = useState<Brand[]>(cache ?? []);
  const first = useRef(true);
  useEffect(() => {
    // A refresh (pull-to-refresh) refetches; the first mount uses the cache.
    if (!first.current && !BRANDS_FROM_DEMO) cache = null;
    first.current = false;
    if (cache) { setBrands(cache); return; }
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('brands').select('*').eq('is_active', true);
        if (error) throw error;
        cache = (data ?? []).map(r => toBrand(r as Record<string, unknown>));
      } catch {
        cache = [];
      }
      if (live) setBrands(cache);
    })();
    return () => { live = false; };
  }, [refreshKey]);
  return brands;
}
