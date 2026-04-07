import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface BroadcastRequest {
  title: string;
  body: string;
  city?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
    });
  }

  try {
    const { title, body: pushBody, city }: BroadcastRequest = await req.json();

    if (!title || !pushBody) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: title, body" }),
        { status: 400 },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Build query — filter by city if provided
    let query = supabase.from("push_tokens").select("token");
    if (city) {
      query = query.ilike("city", city);
    }

    const { data: tokens, error: tokenError } = await query;

    if (tokenError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch tokens", details: tokenError }),
        { status: 500 },
      );
    }

    if (!tokens?.length) {
      return new Response(
        JSON.stringify({
          sent: 0,
          message: city ? `No tokens found for city: ${city}` : "No tokens found",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
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
          title,
          body: pushBody,
          tokens: uniqueTokens,
          data: { type: "broadcast", city: city ?? "all" },
        }),
      },
    );

    const result = await pushRes.json();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500 },
    );
  }
});
