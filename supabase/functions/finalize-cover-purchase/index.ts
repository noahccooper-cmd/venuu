import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_API = "https://api.stripe.com/v1";
const DEFAULT_PLATFORM_FEE_RATE = 0.08;

/* ── Inline pricing algorithm ── */

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

/* ── QR code generation ── */

function generateQRCode(purchaseId: string, venueId: string): string {
  const pPart = purchaseId.replace(/-/g, "").substring(0, 8).toUpperCase();
  const vPart = venueId.replace(/-/g, "").substring(0, 8).toUpperCase();
  return `VENUU-${pPart}-${vPart}`;
}

/* ── Stripe GET helper ── */

async function stripeGet(path: string, secretKey: string) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { "Authorization": `Bearer ${secretKey}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Stripe error");
  return data;
}

/* ── Main handler ── */

interface FinalizeRequest {
  payment_intent_id: string;
  cover_config_id: string;
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
    const { payment_intent_id, cover_config_id }: FinalizeRequest = await req.json();
    if (!payment_intent_id || !cover_config_id) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: "config_error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify PaymentIntent status with Stripe
    const pi = await stripeGet(`/payment_intents/${payment_intent_id}`, stripeKey);

    if (pi.status !== "succeeded") {
      return new Response(JSON.stringify({
        error: "payment_not_confirmed",
        message: `Payment status: ${pi.status}`,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract metadata
    const userId = pi.metadata?.user_id;
    const venueId = pi.metadata?.venue_id;
    const pricePaid = pi.amount; // cents
    if (!userId || !venueId) {
      return new Response(JSON.stringify({ error: "invalid_metadata" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check not already finalized (idempotency)
    const { data: existingPurchase } = await supabase
      .from("cover_purchases")
      .select("id, qr_code")
      .eq("stripe_payment_intent_id", payment_intent_id)
      .maybeSingle();

    if (existingPurchase) {
      // Already finalized — return existing QR code (idempotent)
      return new Response(JSON.stringify({
        success: true,
        qr_code: existingPurchase.qr_code,
        price_paid: pricePaid,
        already_finalized: true,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch fee percentages from config
    const { data: configForFees } = await supabase
      .from("cover_configs")
      .select("security_fee_percent, platform_fee_percent")
      .eq("id", cover_config_id)
      .single();

    const securityFeeRate = configForFees?.security_fee_percent ?? 0;
    const platformFeeRate = configForFees?.platform_fee_percent ?? DEFAULT_PLATFORM_FEE_RATE;

    // Calculate three-way split: venue + venuu + security org
    const platformFee = Math.round(pricePaid * platformFeeRate);
    const securityFee = Math.round(pricePaid * securityFeeRate);
    const venuePayout = pricePaid - platformFee - securityFee;

    // Generate QR code
    const purchaseId = crypto.randomUUID();
    const qrCode = generateQRCode(purchaseId, venueId);

    // Insert purchase record
    const { error: insertErr } = await supabase.from("cover_purchases").insert({
      id: purchaseId,
      cover_config_id,
      venue_id: venueId,
      user_id: userId,
      price_paid: pricePaid,
      platform_fee: platformFee,
      security_fee: securityFee,
      venue_payout: venuePayout,
      stripe_payment_intent_id: payment_intent_id,
      stripe_transfer_id: pi.transfer_data?.destination ?? null,
      status: "completed",
      qr_code: qrCode,
    });

    if (insertErr) {
      // Unique constraint = already purchased (race condition)
      if (insertErr.code === "23505") {
        return new Response(JSON.stringify({ error: "already_purchased", message: "You already have a cover for tonight" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(insertErr.message);
    }

    // Increment covers_sold on the config
    const { data: config } = await supabase
      .from("cover_configs")
      .select("base_price, cap_price, capacity, covers_sold, open_time, close_time")
      .eq("id", cover_config_id)
      .single();

    if (config) {
      const newCoversSold = (config.covers_sold ?? 0) + 1;

      // Recalculate current price with updated sold count
      const newPrice = calculateCurrentPrice(
        config.base_price, config.cap_price, config.capacity, newCoversSold,
        new Date(config.open_time).getTime(), new Date(config.close_time).getTime(), Date.now(),
      );

      await supabase
        .from("cover_configs")
        .update({ covers_sold: newCoversSold, current_price: newPrice, updated_at: new Date().toISOString() })
        .eq("id", cover_config_id);

      // Record price tick
      await supabase.from("cover_price_history").insert({
        cover_config_id,
        price: newPrice,
        covers_sold_at_tick: newCoversSold,
      });
    }

    // Get venue name for the response
    const { data: venue } = await supabase
      .from("venues")
      .select("name")
      .eq("id", venueId)
      .single();

    return new Response(JSON.stringify({
      success: true,
      qr_code: qrCode,
      price_paid: pricePaid,
      platform_fee: platformFee,
      security_fee: securityFee,
      venue_payout: venuePayout,
      venue_name: venue?.name ?? "",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "finalize_failed", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
