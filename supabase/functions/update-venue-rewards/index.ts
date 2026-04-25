import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_REWARD_TEXT_LEN = 100;
const MAX_REWARD_DESC_LEN = 100;
const MIN_VISITS_REQUIRED = 3;
const MAX_VISITS_REQUIRED = 20;

interface UpdateRewardsRequest {
  venue_id: string;
  portal_pin: string;
  reward_text: string;
  visits_required: number;
  reward_description: string | null;
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
    const { venue_id, portal_pin, reward_text, visits_required, reward_description }: UpdateRewardsRequest = await req.json();

    if (!venue_id || !portal_pin) {
      return new Response(JSON.stringify({ error: "missing_fields", message: "venue_id and portal_pin required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate reward_text
    const trimmedText = typeof reward_text === "string" ? reward_text.trim() : "";
    if (!trimmedText || trimmedText.length > MAX_REWARD_TEXT_LEN) {
      return new Response(JSON.stringify({ error: "invalid_reward_text", message: `reward_text must be non-empty and <= ${MAX_REWARD_TEXT_LEN} chars` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate visits_required
    if (
      typeof visits_required !== "number" ||
      !Number.isInteger(visits_required) ||
      visits_required < MIN_VISITS_REQUIRED ||
      visits_required > MAX_VISITS_REQUIRED
    ) {
      return new Response(JSON.stringify({ error: "invalid_visits_required", message: `visits_required must be an integer between ${MIN_VISITS_REQUIRED} and ${MAX_VISITS_REQUIRED}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate reward_description — null OR trimmed string <= MAX_REWARD_DESC_LEN
    let trimmedDesc: string | null = null;
    if (reward_description !== null && reward_description !== undefined) {
      if (typeof reward_description !== "string") {
        return new Response(JSON.stringify({ error: "invalid_reward_description", message: `reward_description must be null or a string <= ${MAX_REWARD_DESC_LEN} chars` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = reward_description.trim();
      if (t.length > MAX_REWARD_DESC_LEN) {
        return new Response(JSON.stringify({ error: "invalid_reward_description", message: `reward_description must be null or a string <= ${MAX_REWARD_DESC_LEN} chars` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      trimmedDesc = t.length > 0 ? t : null;
    }

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
      if (venueErr) console.error("[update-venue-rewards] venue lookup error:", venueErr.message);
      return new Response(JSON.stringify({ error: "unauthorized", message: "Invalid portal credentials" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert venue_rewards row
    const { data: upserted, error: upsertErr } = await supabase
      .from("venue_rewards")
      .upsert({
        venue_id: venue.id,
        reward_text: trimmedText,
        visits_required,
        reward_description: trimmedDesc,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "venue_id" })
      .select("id")
      .single();

    if (upsertErr || !upserted) {
      console.error("[update-venue-rewards] upsert error:", upsertErr?.message);
      return new Response(JSON.stringify({ error: "upsert_failed", message: upsertErr?.message ?? "Failed to save reward" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, reward_id: upserted.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[update-venue-rewards] internal error:", (err as Error).message);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
