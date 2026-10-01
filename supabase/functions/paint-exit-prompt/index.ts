// supabase/functions/paint-exit-prompt/index.ts
//
// Phase D: Rate-on-Exit paint prompt fanout.
//
// Two trigger paths:
//   1. CRON: called every 1 minute. Sweeps paint_prompts WHERE
//      status='queued' AND fire_not_before <= now(). Fires push for each.
//   2. RPC: called by useProximityDetection after a confirmed exit
//      becomes a user_visits row. Calls compute_paint_prompt_due() and
//      lets the cron pick it up 5+ min later.
//
// Push deep-link payload:
//   data.type = 'paint_prompt'
//   data.venue_id = <uuid>
//   data.paint_prompt_id = <uuid>
//   data.venue_name = <string>
//
// Auth: x-cron-secret header (cron) OR service_role JWT (RPC).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SEND_PUSH_URL = `${SUPABASE_URL}/functions/v1/send-push`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PaintPromptRow {
  id: string;
  user_id: string;
  venue_id: string;
  visit_first_seen_at: string;
  visit_last_seen_at: string;
  visit_duration_min: number;
}

interface PushTokenRow {
  user_id: string;
  token: string;
}

interface VenueRow {
  id: string;
  name: string;
}

interface SendPushPayload {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}

async function fireBatch(supabase: ReturnType<typeof createClient>, prompts: PaintPromptRow[]) {
  if (prompts.length === 0) return { fired: 0, skipped: 0 };

  const userIds = Array.from(new Set(prompts.map((p) => p.user_id)));
  const venueIds = Array.from(new Set(prompts.map((p) => p.venue_id)));

  // Push tokens — keyed by profiles.id (paint_prompts.user_id) which
  // requires a join through profiles -> auth.users.id. push_tokens.user_id
  // is the auth_id, so we need to resolve.
  const { data: profileRows, error: profErr } = await supabase
    .from("profiles")
    .select("id, auth_id")
    .in("id", userIds);

  if (profErr) {
    console.error("[paint-exit-prompt] profiles fetch error", profErr);
    return { fired: 0, skipped: prompts.length };
  }

  const profileIdToAuthId = new Map<string, string>();
  (profileRows ?? []).forEach((r: any) => {
    if (r.auth_id) profileIdToAuthId.set(r.id, r.auth_id);
  });

  const authIds = Array.from(profileIdToAuthId.values());

  const { data: tokens, error: tokErr } = await supabase
    .from("push_tokens")
    .select("user_id, token")
    .in("user_id", authIds);

  if (tokErr) {
    console.error("[paint-exit-prompt] push_tokens fetch error", tokErr);
    return { fired: 0, skipped: prompts.length };
  }

  // Fetch venue names
  const { data: venues, error: venErr } = await supabase
    .from("venues")
    .select("id, name")
    .in("id", venueIds);

  if (venErr) {
    console.error("[paint-exit-prompt] venues fetch error", venErr);
    return { fired: 0, skipped: prompts.length };
  }

  const tokensByAuthId = new Map<string, string[]>();
  (tokens as PushTokenRow[] ?? []).forEach((t) => {
    if (!tokensByAuthId.has(t.user_id)) tokensByAuthId.set(t.user_id, []);
    tokensByAuthId.get(t.user_id)!.push(t.token);
  });

  const venueById = new Map<string, VenueRow>();
  (venues as VenueRow[] ?? []).forEach((v) => venueById.set(v.id, v));

  let fired = 0;
  let skipped = 0;

  for (const prompt of prompts) {
    const authId = profileIdToAuthId.get(prompt.user_id);
    const userTokens = authId ? (tokensByAuthId.get(authId) ?? []) : [];
    const venue = venueById.get(prompt.venue_id);

    if (userTokens.length === 0 || !venue) {
      // No tokens or venue missing — mark as pushed anyway so it
      // doesn't loop forever. User just won't get the push this session.
      await supabase.from("paint_prompts")
        .update({ status: "pushed", pushed_at: new Date().toISOString() })
        .eq("id", prompt.id);
      skipped++;
      continue;
    }

    const title = `How did ${venue.name} feel tonight?`;
    const body = ""; // intentional — title carries it, body kept clean

    const pushPayload: SendPushPayload = {
      tokens: userTokens,
      title,
      body,
      data: {
        type: "paint_prompt",
        venue_id: prompt.venue_id,
        venue_name: venue.name,
        paint_prompt_id: prompt.id,
      },
    };

    try {
      const resp = await fetch(SEND_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify(pushPayload),
      });

      if (!resp.ok) {
        console.error("[paint-exit-prompt] send-push non-OK", await resp.text());
      }

      await supabase.from("paint_prompts")
        .update({ status: "pushed", pushed_at: new Date().toISOString() })
        .eq("id", prompt.id);

      fired++;
    } catch (err) {
      console.error("[paint-exit-prompt] send-push threw", err);
      skipped++;
    }
  }

  return { fired, skipped };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Auth: cron secret OR service-role bearer
  const cronHeader = req.headers.get("x-cron-secret");
  const auth = req.headers.get("authorization") ?? "";
  const isCron = CRON_SECRET && cronHeader === CRON_SECRET;
  const isServiceRole = auth.includes(SERVICE_ROLE_KEY);

  if (!isCron && !isServiceRole) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Mode 1: cron sweep
  if (isCron || new URL(req.url).searchParams.get("mode") === "sweep") {
    const { data: queued, error } = await supabase
      .from("paint_prompts")
      .select("id, user_id, venue_id, visit_first_seen_at, visit_last_seen_at, visit_duration_min")
      .eq("status", "queued")
      .lte("fire_not_before", new Date().toISOString())
      .order("queued_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("[paint-exit-prompt] queued fetch error", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Also sweep expired
    await supabase.rpc("expire_stale_paint_prompts");

    const result = await fireBatch(supabase, (queued ?? []) as PaintPromptRow[]);
    return new Response(JSON.stringify({ mode: "sweep", ...result }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Mode 2: RPC from client (after user_visit row created)
  let body: { user_visit_id?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  if (!body.user_visit_id) {
    return new Response(JSON.stringify({ error: "user_visit_id required" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const { data: promptId, error: rpcErr } = await supabase
    .rpc("compute_paint_prompt_due", { p_user_visit_id: body.user_visit_id });

  if (rpcErr) {
    console.error("[paint-exit-prompt] compute_paint_prompt_due error", rpcErr);
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ mode: "queued", paint_prompt_id: promptId }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
