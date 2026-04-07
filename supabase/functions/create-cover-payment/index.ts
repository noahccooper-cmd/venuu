import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_API = "https://api.stripe.com/v1";
const DEFAULT_PLATFORM_FEE_RATE = 0.08;

/* ── Inline pricing algorithm (Edge Functions can't import from src/) ── */

function calculateCurrentPrice(
  basePrice: number, capPrice: number, capacity: number,
  coversSold: number, openTime: number, closeTime: number, now: number,
): number {
  if (coversSold >= capacity) return capPrice;
  if (now >= closeTime) return basePrice;

  const priceRange = capPrice - basePrice;
  const soldRatio = capacity > 0 ? coversSold / capacity : 0;
  const totalWindow = closeTime - openTime;
  const elapsed = Math.max(0, now - openTime);
  const timeRatio = totalWindow > 0 ? Math.min(elapsed / totalWindow, 1) : 1;

  const demandFactor = Math.pow(soldRatio, 1.5);
  const timeDiscount = Math.max(0, timeRatio - soldRatio) * 0.15;
  const priceFactor = Math.max(0, Math.min(1, demandFactor - timeDiscount));
  const raw = basePrice + Math.round(priceRange * priceFactor);
  return Math.round(Math.max(basePrice, Math.min(capPrice, raw)) / 10) * 10;
}

/* ── Stripe helper ── */

async function stripeRequest(path: string, body: Record<string, string>, secretKey: string) {
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

/* ── Main handler ── */

interface CreateRequest {
  cover_config_id: string;
  venue_id: string;
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
    const { cover_config_id, venue_id }: CreateRequest = await req.json();
    if (!cover_config_id || !venue_id) {
      return new Response(JSON.stringify({ error: "missing_fields", message: "cover_config_id and venue_id required" }), {
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

    // Get auth user from request
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized", message: "Sign in to buy covers" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch cover config
    const { data: config, error: configErr } = await supabase
      .from("cover_configs")
      .select("*")
      .eq("id", cover_config_id)
      .eq("venue_id", venue_id)
      .eq("is_active", true)
      .single();

    if (configErr || !config) {
      return new Response(JSON.stringify({ error: "not_found", message: "Cover config not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check sold out
    if (config.covers_sold >= config.capacity) {
      return new Response(JSON.stringify({ error: "sold_out", message: "Covers are sold out!" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check closed
    if (new Date() >= new Date(config.close_time)) {
      return new Response(JSON.stringify({ error: "closed", message: "Cover sales have ended" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check already purchased
    const { data: existing } = await supabase
      .from("cover_purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("cover_config_id", cover_config_id)
      .in("status", ["pending", "completed"])
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: "already_purchased", message: "You already have a cover for tonight" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate current price
    const currentPrice = calculateCurrentPrice(
      config.base_price, config.cap_price, config.capacity, config.covers_sold,
      new Date(config.open_time).getTime(), new Date(config.close_time).getTime(), Date.now(),
    );

    const platformFeeRate = config.platform_fee_percent ?? DEFAULT_PLATFORM_FEE_RATE;
    const platformFee = Math.round(currentPrice * platformFeeRate);

    // Get bar's Stripe Connected Account
    const { data: stripeAcct } = await supabase
      .from("venue_stripe_accounts")
      .select("stripe_account_id, is_verified")
      .eq("venue_id", venue_id)
      .single();

    if (!stripeAcct?.stripe_account_id || !stripeAcct.is_verified) {
      return new Response(JSON.stringify({ error: "stripe_not_setup", message: "This venue hasn't set up payments yet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Stripe PaymentIntent with platform fee and transfer
    const pi = await stripeRequest("/payment_intents", {
      "amount": String(currentPrice),
      "currency": "usd",
      "application_fee_amount": String(platformFee),
      "transfer_data[destination]": stripeAcct.stripe_account_id,
      "metadata[cover_config_id]": cover_config_id,
      "metadata[venue_id]": venue_id,
      "metadata[user_id]": user.id,
      "metadata[platform]": "venuu",
    }, stripeKey);

    return new Response(JSON.stringify({
      client_secret: pi.client_secret,
      payment_intent_id: pi.id,
      price: currentPrice,
      platform_fee: platformFee,
      venue_payout: currentPrice - platformFee,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "payment_failed", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
