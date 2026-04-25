import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FRAT_PLATFORM_FEE_RATE = 0.12;
const DEFAULT_PLATFORM_FEE_RATE = 0.08;

interface UpsertCoverConfigRequest {
  venue_id: string;
  portal_pin: string;
  mode: "start" | "stop";
  // mode === 'start' only:
  night_of?: string;
  base_price?: number;
  cap_price?: number;
  capacity?: number;
  open_time?: string;
  close_time?: string;
  pricing_mode?: "flat" | "dynamic";
}

function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !s) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

function isNightOfDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
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
    const body: UpsertCoverConfigRequest = await req.json();
    const { venue_id, portal_pin, mode } = body;

    if (!venue_id || !portal_pin) {
      return new Response(JSON.stringify({ error: "missing_fields", message: "venue_id and portal_pin required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode !== "start" && mode !== "stop") {
      return new Response(JSON.stringify({ error: "invalid_mode", message: "mode must be 'start' or 'stop'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // PIN check + fetch category for server-derived platform fee
    const { data: venue, error: venueErr } = await supabase
      .from("venues")
      .select("id, category")
      .eq("id", venue_id)
      .eq("staff_code", portal_pin)
      .eq("is_active", true)
      .maybeSingle();

    if (venueErr || !venue) {
      if (venueErr) console.error("[upsert-cover-config] venue lookup error:", venueErr.message);
      return new Response(JSON.stringify({ error: "unauthorized", message: "Invalid portal credentials" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── STOP MODE ─────────────────────────────────────────────────────────
    if (mode === "stop") {
      const { data: active, error: findErr } = await supabase
        .from("cover_configs")
        .select("id")
        .eq("venue_id", venue.id)
        .eq("is_active", true)
        .maybeSingle();

      if (findErr) {
        console.error("[upsert-cover-config] active config lookup error:", findErr.message);
        return new Response(JSON.stringify({ error: "lookup_failed", message: findErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!active) {
        return new Response(JSON.stringify({ error: "no_active_config", message: "No active cover config to stop" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: updateErr } = await supabase
        .from("cover_configs")
        .update({ is_active: false })
        .eq("id", active.id);

      if (updateErr) {
        console.error("[upsert-cover-config] stop update error:", updateErr.message);
        return new Response(JSON.stringify({ error: "update_failed", message: updateErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, stopped: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── START MODE ────────────────────────────────────────────────────────
    const { night_of, base_price, cap_price, capacity, open_time, close_time, pricing_mode } = body;

    if (!Number.isInteger(base_price) || (base_price as number) <= 0) {
      return new Response(JSON.stringify({ error: "invalid_base_price", message: "base_price must be a positive integer (cents)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Number.isInteger(capacity) || (capacity as number) <= 0) {
      return new Response(JSON.stringify({ error: "invalid_capacity", message: "capacity must be a positive integer" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (pricing_mode !== "flat" && pricing_mode !== "dynamic") {
      return new Response(JSON.stringify({ error: "invalid_pricing_mode", message: "pricing_mode must be 'flat' or 'dynamic'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const basePriceNum = base_price as number;
    let capPriceNum: number;
    if (pricing_mode === "flat") {
      // Normalize: flat mode always has cap = base, regardless of what the client sent
      capPriceNum = basePriceNum;
    } else {
      if (!Number.isInteger(cap_price) || (cap_price as number) <= basePriceNum) {
        return new Response(JSON.stringify({ error: "invalid_cap_price", message: "cap_price must be an integer greater than base_price for dynamic pricing" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      capPriceNum = cap_price as number;
    }

    if (!isNightOfDate(night_of)) {
      return new Response(JSON.stringify({ error: "invalid_night_of", message: "night_of must be a YYYY-MM-DD date string" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isValidIsoDate(open_time) || !isValidIsoDate(close_time)) {
      return new Response(JSON.stringify({ error: "invalid_times", message: "open_time and close_time must be valid ISO date strings" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openMs = new Date(open_time as string).getTime();
    const closeMs = new Date(close_time as string).getTime();
    if (closeMs <= openMs) {
      return new Response(JSON.stringify({ error: "invalid_time_range", message: "close_time must be after open_time" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-derived platform fee — ignore anything the client may have sent
    const platformFeePercent = venue.category === "fraternity" ? FRAT_PLATFORM_FEE_RATE : DEFAULT_PLATFORM_FEE_RATE;

    // Preserve existing covers_sold — never trust client
    const { data: existing, error: existingErr } = await supabase
      .from("cover_configs")
      .select("covers_sold")
      .eq("venue_id", venue.id)
      .eq("night_of", night_of)
      .maybeSingle();

    if (existingErr) {
      console.error("[upsert-cover-config] existing lookup error:", existingErr.message);
      return new Response(JSON.stringify({ error: "lookup_failed", message: existingErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preservedCoversSold = existing?.covers_sold ?? 0;

    const { data: upserted, error: upsertErr } = await supabase
      .from("cover_configs")
      .upsert({
        venue_id: venue.id,
        night_of,
        base_price: basePriceNum,
        cap_price: capPriceNum,
        capacity,
        open_time,
        close_time,
        current_price: basePriceNum,
        covers_sold: preservedCoversSold,
        is_active: true,
        platform_fee_percent: platformFeePercent,
        pricing_mode,
      }, { onConflict: "venue_id,night_of" })
      .select()
      .single();

    if (upsertErr || !upserted) {
      console.error("[upsert-cover-config] upsert error:", upsertErr?.message);
      return new Response(JSON.stringify({ error: "upsert_failed", message: upsertErr?.message ?? "Failed to save cover config" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, config: upserted }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[upsert-cover-config] internal error:", (err as Error).message);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
