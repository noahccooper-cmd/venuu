import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_API = "https://api.stripe.com/v1";

function generateTicketQR(ticketId: string, eventId: string): string {
  const tPart = ticketId.replace(/-/g, "").substring(0, 8).toUpperCase();
  const ePart = eventId.replace(/-/g, "").substring(0, 8).toUpperCase();
  return `VENUU-TKT-${tPart}-${ePart}`;
}

async function stripeGet(path: string, secretKey: string) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { "Authorization": `Bearer ${secretKey}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Stripe error");
  return data;
}

interface FinalizeRequest {
  payment_intent_id: string;
  event_id: string;
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
    const { payment_intent_id, event_id }: FinalizeRequest = await req.json();
    if (!payment_intent_id || !event_id) {
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

    // Verify PaymentIntent with Stripe
    const pi = await stripeGet(`/payment_intents/${payment_intent_id}`, stripeKey);
    if (pi.status !== "succeeded") {
      return new Response(JSON.stringify({
        error: "payment_not_confirmed",
        message: `Payment status: ${pi.status}`,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = pi.metadata?.user_id;
    const venueId = pi.metadata?.venue_id || null;
    const pricePaid = pi.amount; // cents
    const platformFeeRate = parseFloat(pi.metadata?.platform_fee_rate ?? "0.08");

    if (!userId) {
      return new Response(JSON.stringify({ error: "invalid_metadata" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: check if already finalized
    const { data: existing } = await supabase
      .from("event_tickets")
      .select("id, qr_code")
      .eq("stripe_payment_intent_id", payment_intent_id)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({
        success: true,
        qr_code: existing.qr_code,
        price_paid: pricePaid,
        already_finalized: true,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const platformFee = Math.round(pricePaid * platformFeeRate);
    const ticketId = crypto.randomUUID();
    const qrCode = generateTicketQR(ticketId, event_id);

    // Insert ticket record
    const { error: insertErr } = await supabase.from("event_tickets").insert({
      id: ticketId,
      event_id,
      venue_id: venueId || null,
      user_id: userId,
      price_paid: pricePaid,
      platform_fee: platformFee,
      stripe_payment_intent_id: payment_intent_id,
      qr_code: qrCode,
      status: "completed",
    });

    if (insertErr) {
      console.error("[finalize-event-ticket] Insert error:", insertErr.message);
      return new Response(JSON.stringify({ error: "db_error", message: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Increment tickets_sold on the event
    const { data: eventRow } = await supabase
      .from("events")
      .select("tickets_sold")
      .eq("id", event_id)
      .maybeSingle();

    await supabase
      .from("events")
      .update({ tickets_sold: (eventRow?.tickets_sold ?? 0) + 1 })
      .eq("id", event_id);

    // Fetch event name for response
    const { data: evtRow } = await supabase
      .from("events")
      .select("title")
      .eq("id", event_id)
      .maybeSingle();

    return new Response(JSON.stringify({
      success: true,
      qr_code: qrCode,
      price_paid: pricePaid,
      event_name: evtRow?.title ?? "",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[finalize-event-ticket]", err);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
