import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_API = "https://api.stripe.com/v1";

async function stripePost(path: string, body: Record<string, string>, secretKey: string) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Stripe error");
  return data;
}

interface ConnectRequest {
  venue_id: string;
  venue_name: string;
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
    const { venue_id, venue_name }: ConnectRequest = await req.json();
    if (!venue_id || !venue_name) {
      return new Response(JSON.stringify({ error: "missing_fields", message: "venue_id and venue_name required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: "config_error", message: "Stripe not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Check if venue already has a Stripe account
    const { data: existing } = await supabase
      .from("venue_stripe_accounts")
      .select("stripe_account_id, is_verified")
      .eq("venue_id", venue_id)
      .maybeSingle();

    let accountId: string;

    if (existing?.stripe_account_id) {
      // Account exists — create a new onboarding link (for re-onboarding or completing verification)
      accountId = existing.stripe_account_id;
    } else {
      // Create new Stripe Express account
      const account = await stripePost("/accounts", {
        "type": "express",
        "country": "US",
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
        "business_profile[name]": venue_name,
        "business_profile[product_description]": "Nightlife venue cover charges via venuu",
      }, stripeKey);

      accountId = account.id;

      // Save to database
      await supabase.from("venue_stripe_accounts").upsert({
        venue_id,
        stripe_account_id: accountId,
        is_verified: false,
      }, { onConflict: "venue_id" });
    }

    // Create account onboarding link
    const accountLink = await stripePost("/account_links", {
      "account": accountId,
      "refresh_url": "https://venuu.app/portal/stripe-refresh",
      "return_url": "https://venuu.app/portal/stripe-success",
      "type": "account_onboarding",
    }, stripeKey);

    // Check if already verified (in case they completed before)
    const acctDetail = await fetch(`${STRIPE_API}/accounts/${accountId}`, {
      headers: { "Authorization": `Bearer ${stripeKey}` },
    }).then(r => r.json());

    if (acctDetail.charges_enabled && acctDetail.payouts_enabled) {
      await supabase.from("venue_stripe_accounts")
        .update({ is_verified: true })
        .eq("venue_id", venue_id);

      return new Response(JSON.stringify({
        already_verified: true,
        account_id: accountId,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      url: accountLink.url,
      account_id: accountId,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "stripe_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
