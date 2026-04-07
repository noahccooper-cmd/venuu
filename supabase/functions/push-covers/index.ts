import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CoversPushRequest {
  venue_name: string;
  city: string;
  base_price: number; // cents
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
    const { venue_name, city, base_price }: CoversPushRequest = await req.json();

    if (!venue_name || !city) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    if (tokenError || !tokens?.length) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No tokens for city" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const uniqueTokens = [...new Set(tokens.map((t: { token: string }) => t.token))];
    const priceStr = `$${(base_price / 100).toFixed(2)}`;

    const pushRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          title: `\uD83C\uDF9F\uFE0F Covers now selling at ${venue_name}`,
          body: `Starting at ${priceStr} \u2014 price goes up as they sell. Buy early!`,
          tokens: uniqueTokens,
          data: { type: "covers", city },
        }),
      },
    );

    const result = await pushRes.json();
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
