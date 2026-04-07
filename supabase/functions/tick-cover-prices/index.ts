import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* ── Inline pricing algorithm ── */

function calculateCurrentPrice(
  basePrice: number, capPrice: number, capacity: number,
  coversSold: number, openTime: number, closeTime: number, now: number,
): number {
  if (coversSold >= capacity) return capPrice;
  if (now >= closeTime) return basePrice;
  const priceRange = capPrice - basePrice;
  const soldRatio = capacity > 0 ? coversSold / capacity : 0;
  const totalWindow = closeTime - openTime;
  const elapsed = Math.max(0, now - openTime);
  const timeRatio = totalWindow > 0 ? Math.min(elapsed / totalWindow, 1) : 1;
  const demandFactor = Math.pow(soldRatio, 1.5);
  const timeDiscount = Math.max(0, timeRatio - soldRatio) * 0.15;
  const priceFactor = Math.max(0, Math.min(1, demandFactor - timeDiscount));
  const raw = basePrice + Math.round(priceRange * priceFactor);
  return Math.round(Math.max(basePrice, Math.min(capPrice, raw)) / 10) * 10;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const nightOf = body.night_of;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch all active configs for tonight
    let query = supabase
      .from("cover_configs")
      .select("id, base_price, cap_price, capacity, covers_sold, open_time, close_time, current_price")
      .eq("is_active", true);

    if (nightOf) query = query.eq("night_of", nightOf);

    const { data: configs, error: fetchErr } = await query;
    if (fetchErr || !configs) {
      return new Response(JSON.stringify({ error: "fetch_failed", details: fetchErr }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    let updated = 0;

    for (const config of configs) {
      // Skip flat pricing configs — their price doesn't auto-change
      if (config.base_price === config.cap_price) continue;

      const newPrice = calculateCurrentPrice(
        config.base_price, config.cap_price, config.capacity, config.covers_sold,
        new Date(config.open_time).getTime(), new Date(config.close_time).getTime(), now,
      );

      // Only update if price actually changed
      if (newPrice !== config.current_price) {
        await supabase
          .from("cover_configs")
          .update({ current_price: newPrice, updated_at: new Date().toISOString() })
          .eq("id", config.id);

        await supabase.from("cover_price_history").insert({
          cover_config_id: config.id,
          price: newPrice,
          covers_sold_at_tick: config.covers_sold,
        });

        updated++;
      }
    }

    return new Response(JSON.stringify({ ticked: configs.length, updated }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
