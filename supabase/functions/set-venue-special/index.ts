import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_SPECIAL_LEN = 100;

interface SetSpecialRequest {
  venue_id: string;
  portal_pin: string;
  special_text: string | null;
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
    const { venue_id, portal_pin, special_text }: SetSpecialRequest = await req.json();

    if (!venue_id || !portal_pin) {
      return new Response(JSON.stringify({ error: "missing_fields", message: "venue_id and portal_pin required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize special_text: null, empty, or whitespace-only → clear operation
    let trimmed: string | null = null;
    if (special_text !== null && special_text !== undefined) {
      if (typeof special_text !== "string") {
        return new Response(JSON.stringify({ error: "invalid_special_text", message: "special_text must be a string or null" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = special_text.trim();
      if (t.length > MAX_SPECIAL_LEN) {
        return new Response(JSON.stringify({ error: "invalid_special_text", message: `special_text must be <= ${MAX_SPECIAL_LEN} chars` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      trimmed = t.length > 0 ? t : null;
    }

    const cleared = trimmed === null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Server-side PIN check against venues.staff_code
    const { data: venue, error: venueErr } = await supabase
      .from("venues")
      .select("id")
      .eq("id", venue_id)
      .eq("staff_code", portal_pin)
      .eq("is_active", true)
      .maybeSingle();

    if (venueErr || !venue) {
      if (venueErr) console.error("[set-venue-special] venue lookup error:", venueErr.message);
      return new Response(JSON.stringify({ error: "unauthorized", message: "Invalid portal credentials" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update tonight_special + special_updated_at (server-authoritative timestamp)
    const { error: updateErr } = await supabase
      .from("venues")
      .update({
        tonight_special: trimmed,
        special_updated_at: cleared ? null : new Date().toISOString(),
      })
      .eq("id", venue.id);

    if (updateErr) {
      console.error("[set-venue-special] update error:", updateErr.message);
      return new Response(JSON.stringify({ error: "update_failed", message: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, cleared }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[set-venue-special] internal error:", (err as Error).message);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
