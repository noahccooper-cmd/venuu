import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TEAM_ID = "K67367A56J";
const KEY_ID = "YC67XHV6J5";
const BUNDLE_ID = "com.venuu.app";
// Use sandbox for dev/TestFlight builds, production for App Store builds.
// Set APNS_SANDBOX=true in Supabase Edge Function secrets for dev builds.
const APNS_HOST = Deno.env.get("APNS_SANDBOX") === "true"
  ? "https://api.sandbox.push.apple.com"
  : "https://api.push.apple.com";

interface PushRequest {
  title: string;
  body: string;
  tokens: string[];
  data?: Record<string, unknown>;
  test?: boolean;
  token?: string;
}

/** Import a PEM-encoded PKCS#8 EC private key for ES256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** Base64url encode bytes. */
function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Create an ES256-signed JWT for APNs authentication. */
async function createAPNsJWT(privateKey: CryptoKey): Promise<string> {
  const header = b64url(
    new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: KEY_ID })),
  );
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) }),
    ),
  );
  const signingInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    signingInput,
  );
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

/** Send a single push notification via APNs. */
async function sendToDevice(
  token: string,
  jwt: string,
  payload: Record<string, unknown>,
): Promise<{ token: string; success: boolean; status: number; reason?: string }> {
  try {
    const res = await fetch(`${APNS_HOST}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return { token, success: true, status: res.status };
    }
    const body = await res.json().catch(() => ({}));
    return {
      token,
      success: false,
      status: res.status,
      reason: body.reason ?? "unknown",
    };
  } catch (err) {
    return {
      token,
      success: false,
      status: 0,
      reason: (err as Error).message,
    };
  }
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
    const body: PushRequest = await req.json();

    // --- Test mode ---
    if (body.test && body.token) {
      const apnsKey = Deno.env.get("APNS_KEY");
      if (!apnsKey) {
        return new Response(
          JSON.stringify({ error: "APNS_KEY secret not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const privateKey = await importPrivateKey(apnsKey);
      const jwt = await createAPNsJWT(privateKey);
      const payload = {
        aps: {
          alert: { title: "venuu", body: "Push notifications are working!" },
          sound: "default",
          badge: 1,
        },
      };
      const result = await sendToDevice(body.token, jwt, payload);
      return new Response(JSON.stringify({ test: true, result }), {
        status: result.success ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Normal mode ---
    const { title, body: pushBody, tokens, data } = body;
    if (!title || !pushBody || !tokens?.length) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: title, body, tokens" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apnsKey = Deno.env.get("APNS_KEY");
    if (!apnsKey) {
      return new Response(
        JSON.stringify({ error: "APNS_KEY secret not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const privateKey = await importPrivateKey(apnsKey);
    const jwt = await createAPNsJWT(privateKey);

    const apnsPayload: Record<string, unknown> = {
      aps: {
        alert: { title, body: pushBody },
        sound: "default",
        badge: 1,
      },
    };
    if (data) {
      apnsPayload.data = data;
    }

    // Send to all tokens concurrently
    const results = await Promise.all(
      tokens.map((token) => sendToDevice(token, jwt, apnsPayload)),
    );

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const failures = results.filter((r) => !r.success);

    // Clean up tokens that APNs has permanently rejected.
    // BadDeviceToken = token was never valid or the device was wiped.
    // Unregistered = app was uninstalled. Both are permanent — safe to delete.
    const staleReasons = new Set(["BadDeviceToken", "Unregistered"]);
    const staleTokens = failures
      .filter((r) => r.reason && staleReasons.has(r.reason))
      .map((r) => r.token);

    if (staleTokens.length > 0) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { error: deleteError } = await supabase
          .from("push_tokens")
          .delete()
          .in("token", staleTokens);
        if (deleteError) {
          console.error("[send-push] Failed to delete stale tokens:", deleteError.message);
        } else {
          console.log(`[send-push] Deleted ${staleTokens.length} stale token(s)`);
        }
      } catch (err) {
        console.error("[send-push] Token cleanup error:", (err as Error).message);
      }
    }

    return new Response(
      JSON.stringify({ sent: succeeded, failed, total: tokens.length, failures }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
