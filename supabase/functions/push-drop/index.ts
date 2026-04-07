import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DropRequest {
  venue_id: string;
  message: string;
  city: string;
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
    const { venue_id, message, city }: DropRequest = await req.json();

    if (!venue_id || !message || !city) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: venue_id, message, city" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get venue name
    const { data: venue, error: venueError } = await supabase
      .from("venues")
      .select("name")
      .eq("id", venue_id)
      .single();

    if (venueError || !venue) {
      return new Response(
        JSON.stringify({ error: "Venue not found", details: venueError }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Extract just the city name (e.g. "Knoxville" from "Knoxville, TN")
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

    // Call send-push function
    const pushRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          title: venue.name,
          body: message,
          tokens: uniqueTokens,
          data: { type: "drop", venue_id },
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
