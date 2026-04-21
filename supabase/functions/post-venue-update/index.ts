import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_MESSAGE_LEN = 140;

interface PostVenueUpdateRequest {
  venue_id: string;
  portal_pin: string;
  message: string;
  expires_at: string;
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
    const { venue_id, portal_pin, message, expires_at }: PostVenueUpdateRequest = await req.json();

    if (!venue_id || !portal_pin || !message || !expires_at) {
      return new Response(JSON.stringify({ error: "missing_fields", message: "venue_id, portal_pin, message, and expires_at required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate message
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_LEN) {
      return new Response(JSON.stringify({ error: "invalid_message", message: `Message must be non-empty and <= ${MAX_MESSAGE_LEN} chars` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate expires_at
    const expiresDate = new Date(expires_at);
    if (isNaN(expiresDate.getTime()) || expiresDate.getTime() <= Date.now()) {
      return new Response(JSON.stringify({ error: "invalid_expires_at", message: "expires_at must be a valid future ISO timestamp" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Server-side PIN check against venues.staff_code
    const { data: venue, error: venueErr } = await supabase
      .from("venues")
      .select("id, name, city")
      .eq("id", venue_id)
      .eq("staff_code", portal_pin)
      .eq("is_active", true)
      .maybeSingle();

    if (venueErr || !venue) {
      if (venueErr) console.error("[post-venue-update] venue lookup error:", venueErr.message);
      return new Response(JSON.stringify({ error: "unauthorized", message: "Invalid portal credentials" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert venue_updates row
    const { data: inserted, error: insertErr } = await supabase
      .from("venue_updates")
      .insert({
        venue_id: venue.id,
        venue_name: venue.name,
        message: trimmed,
        expires_at: expiresDate.toISOString(),
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("[post-venue-update] insert error:", insertErr?.message);
      return new Response(JSON.stringify({ error: "insert_failed", message: insertErr?.message ?? "Failed to insert update" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fire-and-forget push-drop broadcast (do NOT await)
    fetch(`${supabaseUrl}/functions/v1/push-drop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        venue_id: venue.id,
        venue_name: venue.name,
        drop_text: trimmed,
        drop_id: inserted.id,
        city: venue.city,
      }),
    }).catch((err) => {
      console.error("[post-venue-update] push-drop fire-and-forget failed:", err?.message ?? err);
    });

    return new Response(JSON.stringify({ success: true, update_id: inserted.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[post-venue-update] internal error:", (err as Error).message);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
