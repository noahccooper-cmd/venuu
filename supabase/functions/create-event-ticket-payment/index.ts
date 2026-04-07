import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_API = "https://api.stripe.com/v1";
const DEFAULT_PLATFORM_FEE_RATE = 0.08;
const FRAT_PLATFORM_FEE_RATE = 0.12;

async function stripeRequest(
  path: string,
  body: Record<string, string>,
  secretKey: string,
) {
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

interface CreateRequest {
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
    const { event_id }: CreateRequest = await req.json();
    if (!event_id) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: "config_error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth: require logged-in user
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(supabaseUrl, serviceKey);
    const { data: { user } } = await supabaseUser.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch event
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("*, venues!inner(category, name)")
      .eq("id", event_id)
      .eq("is_active", true)
      .maybeSingle();

    if (eventErr || !event) {
      return new Response(JSON.stringify({ error: "event_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ticket availability checks
    if (!event.has_tickets || !event.ticket_price) {
      return new Response(JSON.stringify({ error: "no_tickets", message: "This event does not have tickets" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();

    // Sale window check
    if (event.sale_starts_at && new Date(event.sale_starts_at) > now) {
      return new Response(JSON.stringify({
        error: "not_on_sale",
        message: "Tickets are not on sale yet",
        sale_starts_at: event.sale_starts_at,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event.sale_ends_at && new Date(event.sale_ends_at) < now) {
      return new Response(JSON.stringify({ error: "sale_ended", message: "Ticket sales have ended" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sold out check
    if (event.total_tickets && event.tickets_sold >= event.total_tickets) {
      return new Response(JSON.stringify({ error: "sold_out", message: "This event is sold out" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Duplicate purchase check
    const { data: existing } = await supabase
      .from("event_tickets")
      .select("id, qr_code")
      .eq("user_id", user.id)
      .eq("event_id", event_id)
      .in("status", ["completed", "used"])
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({
        error: "already_purchased",
        message: "You already have a ticket for this event",
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get venue's Stripe account
    const { data: stripeAccount } = await supabase
      .from("venue_stripe_accounts")
      .select("stripe_account_id, is_verified")
      .eq("venue_id", event.venue_id)
      .maybeSingle();

    if (!stripeAccount?.is_verified || !stripeAccount.stripe_account_id) {
      return new Response(JSON.stringify({
        error: "payments_not_configured",
        message: "This venue has not set up payments yet",
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isFrat = (event.venues as { category: string })?.category === "fraternity";
    const platformFeeRate = isFrat ? FRAT_PLATFORM_FEE_RATE : DEFAULT_PLATFORM_FEE_RATE;
    const ticketPrice = event.ticket_price as number; // cents
    const platformFee = Math.round(ticketPrice * platformFeeRate);

    // Create PaymentIntent
    const pi = await stripeRequest("/payment_intents", {
      amount: String(ticketPrice),
      currency: "usd",
      "automatic_payment_methods[enabled]": "true",
      application_fee_amount: String(platformFee),
      transfer_data: JSON.stringify({ destination: stripeAccount.stripe_account_id }),
      "metadata[user_id]": user.id,
      "metadata[event_id]": event_id,
      "metadata[venue_id]": event.venue_id ?? "",
      "metadata[platform_fee_rate]": String(platformFeeRate),
    }, stripeKey);

    return new Response(JSON.stringify({
      client_secret: pi.client_secret,
      payment_intent_id: pi.id,
      ticket_price: ticketPrice,
      event_name: event.title,
      venue_name: (event.venues as { name: string })?.name ?? "",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[create-event-ticket-payment]", err);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
