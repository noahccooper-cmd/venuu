import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface EventPushRequest {
  title: string;
  venue_name: string;
  host_name: string;
  city: string;
  start_time: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    + " at "
    + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { title, venue_name, host_name, city, start_time }: EventPushRequest = await req.json();

    if (!title || !city || !start_time) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: title, city, start_time" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // venue_name falls back to host_name for backwards compatibility
    const displayVenue = venue_name || host_name || "A venue";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Flexible city matching
    const cityName = city.split(",")[0].trim();

    const { data: tokens, error: tokenError } = await supabase
      .from("push_tokens")
      .select("token")
      .ilike("city", `%${cityName}%`);

    if (tokenError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch tokens", details: tokenError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!tokens?.length) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No tokens found for city" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Deduplicate tokens
    const uniqueTokens = [...new Set(tokens.map((t: { token: string }) => t.token))];

    const pushRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          title: "New Event",
          body: `${displayVenue}: ${title}`,
          tokens: uniqueTokens,
          data: { type: "event", city },
        }),
      },
    );

    const result = await pushRes.json();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
