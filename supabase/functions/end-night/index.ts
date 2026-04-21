import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface EndNightRequest {
  venue_id: string;
  portal_pin: string;
  night_of: string;
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
    const { venue_id, portal_pin, night_of }: EndNightRequest = await req.json();

    if (!venue_id || !portal_pin) {
      return new Response(JSON.stringify({ error: "missing_fields", message: "venue_id and portal_pin required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isNightOfDate(night_of)) {
      return new Response(JSON.stringify({ error: "invalid_night_of", message: "night_of must be a YYYY-MM-DD date string" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // PIN check
    const { data: venue, error: venueErr } = await supabase
      .from("venues")
      .select("id")
      .eq("id", venue_id)
      .eq("staff_code", portal_pin)
      .eq("is_active", true)
      .maybeSingle();

    if (venueErr || !venue) {
      if (venueErr) console.error("[end-night] venue lookup error:", venueErr.message);
      return new Response(JSON.stringify({ error: "unauthorized", message: "Invalid portal credentials" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch peak BEFORE zeroing — client needs this for the summary panel.
    // Note: headcounts has no dedicated peak_time column — updated_at is used
    // as the proxy across the rest of the codebase, so we do the same here.
    const { data: existingHc, error: hcFetchErr } = await supabase
      .from("headcounts")
      .select("peak_count, updated_at")
      .eq("venue_id", venue.id)
      .eq("night_of", night_of)
      .maybeSingle();

    if (hcFetchErr) {
      console.error("[end-night] headcount fetch error:", hcFetchErr.message);
      return new Response(JSON.stringify({ error: "lookup_failed", message: hcFetchErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const peakCount = existingHc?.peak_count ?? 0;
    const peakTime = existingHc?.updated_at ?? null;

    // Write 1: zero out the headcount and mark it not live
    const { error: hcUpdateErr } = await supabase
      .from("headcounts")
      .update({ current_count: 0, is_live: false })
      .eq("venue_id", venue.id)
      .eq("night_of", night_of);

    if (hcUpdateErr) {
      console.error("[end-night] headcount update error:", hcUpdateErr.message);
      return new Response(JSON.stringify({ error: "headcount_update_failed", message: hcUpdateErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Write 2: clear cover, special, mark clicker not live on venue row
    const { error: venueUpdateErr } = await supabase
      .from("venues")
      .update({
        is_clicker_live: false,
        cover_charge: null,
        tonight_special: null,
        special_updated_at: null,
      })
      .eq("id", venue.id);

    if (venueUpdateErr) {
      // Headcount was already zeroed — state is coherent-enough for end-of-night;
      // log and return partial-failure so the client can still show the summary.
      console.error("[end-night] venues update error (headcount already zeroed):", venueUpdateErr.message);
      return new Response(JSON.stringify({ error: "venue_update_failed", message: venueUpdateErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      peak_count: peakCount,
      peak_time: peakTime,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[end-night] internal error:", (err as Error).message);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
