import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get all users with loyalty visits, their visit counts per venue, and reward thresholds
    const { data: visits, error: visitsError } = await supabase
      .from("loyalty_visits")
      .select("user_id, venue_id");

    if (visitsError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch visits", details: visitsError }),
        { status: 500 },
      );
    }

    // Get all venue rewards
    const { data: rewards, error: rewardsError } = await supabase
      .from("venue_rewards")
      .select("venue_id, reward_text, visits_required")
      .eq("is_active", true);

    if (rewardsError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch rewards", details: rewardsError }),
        { status: 500 },
      );
    }

    // Get venue names
    const venueIds = [...new Set(rewards?.map((r) => r.venue_id) ?? [])];
    const { data: venues } = await supabase
      .from("venues")
      .select("id, name")
      .in("id", venueIds);

    const venueMap = new Map(venues?.map((v) => [v.id, v.name]) ?? []);
    const rewardMap = new Map(
      rewards?.map((r) => [r.venue_id, r.visits_required]) ?? [],
    );

    // Count visits per user per venue
    const userVenueVisits = new Map<string, Map<string, number>>();
    for (const visit of visits ?? []) {
      if (!userVenueVisits.has(visit.user_id)) {
        userVenueVisits.set(visit.user_id, new Map());
      }
      const venueVisits = userVenueVisits.get(visit.user_id)!;
      venueVisits.set(visit.venue_id, (venueVisits.get(visit.venue_id) ?? 0) + 1);
    }

    // Get already-redeemed combos so we don't nag users who already claimed
    const { data: redemptions } = await supabase
      .from("loyalty_redemptions")
      .select("user_id, venue_id");

    const redeemedSet = new Set(
      redemptions?.map((r) => `${r.user_id}:${r.venue_id}`) ?? [],
    );

    // For each user, find their closest-to-reward venue
    const notifications: { user_id: string; title: string; body: string }[] = [];

    for (const [userId, venueVisits] of userVenueVisits) {
      let bestVenue: string | null = null;
      let bestRemaining = Infinity;

      for (const [venueId, count] of venueVisits) {
        const required = rewardMap.get(venueId);
        if (!required) continue;
        if (redeemedSet.has(`${userId}:${venueId}`)) continue;

        const remaining = required - count;
        if (remaining > 0 && remaining < bestRemaining) {
          bestRemaining = remaining;
          bestVenue = venueId;
        }
      }

      if (bestVenue && bestRemaining < Infinity) {
        const venueName = venueMap.get(bestVenue) ?? "your favorite spot";
        notifications.push({
          user_id: userId,
          title: "You're almost there!",
          body: `You're ${bestRemaining} visit${bestRemaining === 1 ? "" : "s"} away from a free beer at ${venueName}!`,
        });
      }
    }

    if (!notifications.length) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No users to notify" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Get push tokens for each user and send
    let totalSent = 0;
    let totalFailed = 0;

    for (const notif of notifications) {
      const { data: tokens } = await supabase
        .from("push_tokens")
        .select("token")
        .eq("user_id", notif.user_id);

      if (!tokens?.length) continue;

      const pushRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            title: notif.title,
            body: notif.body,
            tokens: tokens.map((t: { token: string }) => t.token),
            data: { type: "loyalty_reminder" },
          }),
        },
      );

      const result = await pushRes.json();
      totalSent += result.sent ?? 0;
      totalFailed += result.failed ?? 0;
    }

    return new Response(
      JSON.stringify({
        users_notified: notifications.length,
        sent: totalSent,
        failed: totalFailed,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500 },
    );
  }
});
