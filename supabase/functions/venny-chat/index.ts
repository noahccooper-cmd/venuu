// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * venny-chat
 *
 * Map-resident agent powered by Claude (Anthropic). One POST request
 * per user turn; the response is an SSE stream the client consumes
 * inside <VennySheet>. The function:
 *
 *   1. Loads/creates a conversation row keyed on user_id + city.
 *   2. Persists the user's incoming message.
 *   3. Runs Anthropic's tool-call loop server-side until the assistant
 *      produces a stop_reason of 'end_turn'.
 *   4. Persists the assistant's final message.
 *
 * Each iteration of the tool loop:
 *   • If the assistant emitted tool_use blocks, we execute them
 *     server-side (search_venues / get_user_taste / set_user_preference
 *     / highlight_on_map / compose_plan / save_plan) and feed the
 *     tool_result back.
 *   • If the assistant emitted text + end_turn, we stream the final
 *     reply to the client.
 *
 * Streaming protocol (event names):
 *   • event: conversation   → `{ id }`
 *   • event: text           → `{ delta: string }`
 *   • event: tool_use       → `{ name, input }`
 *   • event: tool_result    → `{ name, output }` (used by highlight_on_map)
 *   • event: done           → `{ message_id }`
 *   • event: error          → `{ message }`
 */

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
// Sonnet is invoked server-side only inside compose_plan — Haiku stays
// the persona Venny on the user-facing turn. Hybrid keeps the
// conversation cheap/fast while letting plan composition use the
// stronger reasoner for vibe arc + walking-distance + budget.
const ANTHROPIC_PLANNER_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const PLANNER_MAX_TOKENS = 1500;
const TOOL_LOOP_GUARD = 6; // hard ceiling on tool-call iterations

// Plan constraints — clamped server-side regardless of what Haiku asks.
const PLAN_MIN_STOPS = 2;
const PLAN_MAX_STOPS = 3;
const PLAN_MAX_WALK_METERS = 800;   // sequential stops must be walkable
const PLAN_BUDGET_BUFFER = 1.10;    // 10% over input budget = warn, not reject

// Vibe-tag triggers that flip the frat filter from default-deny to allow.
const FRAT_INTENT_TAGS = ['frat', 'greek', 'house party', 'fraternity', 'sorority'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sseHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

// ──────────────────────────────────────────────────────────────
//  Tool schemas — these go to Anthropic
// ──────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_venues',
    description:
      "Find venues matching the user's vibe, budget, and current city. Call this IMMEDIATELY whenever the user mentions any vibe, venue type, budget, time, or asks for a recommendation. Don't ask clarifying questions first. Returns 3-5 venues with live state, capacity, cover, description snippet, and reasoning. The map highlights these venues automatically.",
    input_schema: {
      type: 'object',
      properties: {
        vibe_tags: { type: 'array', items: { type: 'string' } },
        budget_max: { type: 'string', enum: ['$', '$$', '$$$'] },
        category: {
          type: 'string',
          enum: ['bar', 'club', 'rooftop', 'brewery', 'restaurant', 'frat', 'event', 'festival'],
        },
        state_preference: { type: 'string', enum: ['lively', 'quiet', 'any'] },
        max_results: { type: 'number' },
      },
      required: ['vibe_tags'],
    },
  },
  {
    name: 'get_user_taste',
    description:
      "Read the user's saved preferences (age, budget, vibes liked, vibes disliked, group size, music taste, recent ratings). Call at the start of every new conversation unless preferences are already in <user_memory>. The user's taste shapes every recommendation.",
    input_schema: {
      type: 'object',
      properties: { include_history: { type: 'boolean' } },
    },
  },
  {
    name: 'set_user_preference',
    description:
      "Save a durable fact about the user (age, budget, vibe preference, group size). Call when the user tells you something about themselves that should persist across conversations.",
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          enum: [
            'age',
            'music_taste',
            'typical_budget',
            'dress_style',
            'group_size_typical',
            'vibes_liked',
            'vibes_disliked',
            'home_city',
          ],
        },
        value: {},
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'highlight_on_map',
    description:
      "Highlight venues on the map with orange glow rings. Call after search_venues so the user sees the venues you mentioned.",
    input_schema: {
      type: 'object',
      properties: {
        venue_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['venue_ids'],
    },
  },
  {
    name: 'compose_plan',
    description:
      "Compose a 2 or 3 stop night plan from candidate venues. Call when the user asks for a plan, itinerary, or 'what to do tonight.' FIRST call search_venues to get candidates, THEN compose_plan with those venue IDs. Returns a complete plan with stops, timing, route, budget.",
    input_schema: {
      type: 'object',
      properties: {
        vibe: { type: 'string' },
        city: { type: 'string' },
        budget_per_person_max: { type: 'number' },
        start_time: { type: 'string' },
        end_time: { type: 'string' },
        group_size: { type: 'number' },
        num_stops: { type: 'number' },
        candidate_venue_ids: { type: 'array', items: { type: 'string' } },
        avoid_venue_ids: { type: 'array', items: { type: 'string' } },
        driving: { type: 'boolean' },
      },
      required: ['vibe', 'city', 'budget_per_person_max', 'start_time', 'group_size', 'num_stops'],
    },
  },
  {
    name: 'save_plan',
    description:
      "Save a composed plan to the user's account. Call ONLY after a plan was composed AND the user confirmed they want it saved ('yes,' 'save it,' 'let's do it').",
    input_schema: {
      type: 'object',
      properties: {
        plan_data: { type: 'object' },
        title: { type: 'string' },
      },
      required: ['plan_data', 'title'],
    },
  },
  {
    name: 'tool_check_live_status',
    description:
      "Look up the current live state of a specific venue by name or slug. Use when the user asks about a specific venue and you need its current delta_pct, state_label, and confidence beyond what's already in the live market data section. Returns null if no fresh data (confidence too low, or outside the active window).",
    input_schema: {
      type: 'object',
      properties: {
        venue_query: {
          type: 'string',
          description: 'The venue name or slug to look up. Fuzzy match.',
        },
      },
      required: ['venue_query'],
    },
  },
];

// ──────────────────────────────────────────────────────────────
//  Sonnet planner — composes structured plans server-side
// ──────────────────────────────────────────────────────────────

const SONNET_PLANNER_SYSTEM_PROMPT = `You are venuu's plan composition engine. You compose multi-stop night plans from candidate venues. You return ONLY valid JSON — no prose, no explanation, no markdown.

═══ HARD RULES ═══

1. Plans MUST be 2 or 3 stops. Never 1. Never 4 or more.
2. Sequential stops MUST be walkable — under 800m apart. If candidates don't support this, return the smallest valid plan you can.
3. Total budget MUST stay under input.budget_per_person_max. If impossible, return your best attempt and flag it.
4. Arc the vibe: stop 1 lighter → stop N harder. Don't start at a dance floor. Don't end at a quiet cocktail bar (unless user explicitly asked for that arc).
5. Time spacing: 60-90 min per stop. Total plan duration roughly 2-3 hours. Account for closing times (most venues close 2am).
6. Prefer active/lively venues over Unknown-state. Never include venues without descriptions unless candidates force it.
7. Each stop's vibe_note must be SPECIFIC — say WHY this venue at this point in the night. Not "great spot" — instead "start lighter here, dim room, easy conversation before the energy picks up."

═══ RATED ARCS ═══

If a <rated_arcs> block is appended to this system prompt, treat it as the MOST IMPORTANT composition signal. The user has explicitly rated those nights highly. Bias your composition toward:

* Similar venue types (if rated arcs feature dive bars → cocktail bars, lean that direction)
* Similar pacing (3-stop vs 2-stop, geography spread, time-per-stop)
* Similar mood (if mood_tags repeat across rated arcs, the user consistently wants that energy)

Do NOT clone the rated arc — vary the venues, add freshness. But the SHAPE should resemble what worked before. If no <rated_arcs> block is present, compose from the candidates as usual.

═══ OUTPUT SCHEMA ═══

{
  "title": "short evocative title (e.g. 'Old City Last Call', 'SoHo Sundown')",
  "summary": "one sentence describing the night's arc",
  "vibe_tags": ["tag1", "tag2"],
  "stops": [
    {
      "venue_id": "uuid",
      "venue_name": "name",
      "lat": number,
      "lng": number,
      "arrival_time": "8:30 PM",
      "duration_min": 60,
      "vibe_note": "specific reasoning for this venue at this slot",
      "estimated_cost": 18
    }
  ],
  "total_estimated_cost": 60,
  "total_duration_min": 180,
  "start_time": "8:30 PM",
  "end_time": "11:30 PM"
}

═══ ENDS ═══

Return ONLY the JSON. No prose. No code fences. No commentary.`;

// ──────────────────────────────────────────────────────────────
//  Phase 4.5 — live market context
//  Pulled once per turn from city_pulse + tonight_movers, injected
//  into Haiku's system prompt so every response can cite real-time
//  state. NEVER persisted back to the API on subsequent turns —
//  history doesn't carry market_context, only the current turn does.
// ──────────────────────────────────────────────────────────────

interface MarketMover {
  name: string;
  slug: string;
  delta_pct: number;
  state_label: string;
  confidence_pct: number;
}

interface MarketContext {
  fetched_at: string;
  city: string;
  city_pulse: {
    avg_delta_pct: number;
    venues_with_signal: number;
    surging_count: number;
    busy_count: number;
    quiet_count: number;
    top_riser_delta: number;
    top_faller_delta: number;
  } | null;
  top_risers: MarketMover[];
  top_fallers: MarketMover[];
}

async function fetchMarketContext(
  supabaseClient: ReturnType<typeof createClient>,
  city: string,
): Promise<MarketContext> {
  const fetched_at = new Date().toISOString();

  const [pulseRes, risersRes, fallersRes] = await Promise.all([
    supabaseClient
      .from('city_pulse')
      .select('*')
      .eq('city', city)
      .maybeSingle(),
    supabaseClient
      .from('tonight_movers')
      .select('venue_name, venue_slug, delta_pct, state_label, confidence_pct')
      .eq('city', city)
      .order('delta_pct', { ascending: false })
      .limit(4),
    supabaseClient
      .from('tonight_movers')
      .select('venue_name, venue_slug, delta_pct, state_label, confidence_pct')
      .eq('city', city)
      .order('delta_pct', { ascending: true })
      .limit(4),
  ]);

  const pulseRow = pulseRes.data as Record<string, unknown> | null;
  const toMover = (r: Record<string, unknown>): MarketMover => ({
    name: String(r.venue_name ?? ''),
    slug: String(r.venue_slug ?? ''),
    delta_pct: Number(r.delta_pct ?? 0),
    state_label: String(r.state_label ?? 'Unknown'),
    confidence_pct: Number(r.confidence_pct ?? 0),
  });

  return {
    fetched_at,
    city,
    city_pulse: pulseRow ? {
      avg_delta_pct: Number(pulseRow.avg_delta_pct ?? 0),
      venues_with_signal: Number(pulseRow.venues_with_signal ?? 0),
      surging_count: Number(pulseRow.surging_count ?? 0),
      busy_count: Number(pulseRow.busy_count ?? 0),
      quiet_count: Number(pulseRow.quiet_count ?? 0),
      top_riser_delta: Number(pulseRow.top_riser_delta ?? 0),
      top_faller_delta: Number(pulseRow.top_faller_delta ?? 0),
    } : null,
    top_risers: ((risersRes.data ?? []) as Record<string, unknown>[]).map(toMover),
    top_fallers: ((fallersRes.data ?? []) as Record<string, unknown>[])
      .map(toMover)
      .filter(f => f.delta_pct < 0),
  };
}

function buildMarketAwarenessSection(market: MarketContext): string {
  if (!market.city_pulse && market.top_risers.length === 0 && market.top_fallers.length === 0) {
    return `

═══ LIVE MARKET DATA ═══

You have no fresh market data for ${market.city} right now. Either
the night hasn't started, or signal volume is too low to call
anything with confidence. Don't fabricate live conditions. If asked
"what's busy tonight" without data, say so honestly: "It's early —
nothing's calling yet. I can tell you what usually pops at this hour,
or we can build a plan and watch it together."`;
  }

  const pulseLine = market.city_pulse
    ? `**City pulse**: ${market.city} is averaging ${market.city_pulse.avg_delta_pct >= 0 ? '+' : ''}${market.city_pulse.avg_delta_pct}% vs forecast right now across ${market.city_pulse.venues_with_signal} confident venues. ${market.city_pulse.surging_count} venues Surging. ${market.city_pulse.busy_count} venues Busy/Packed. ${market.city_pulse.quiet_count} venues Quiet.`
    : '';

  const risersLines = market.top_risers.length > 0
    ? `**Tonight's top risers** (running hot):\n${market.top_risers.map(r => `  - ${r.name}: ${r.delta_pct >= 0 ? '+' : ''}${r.delta_pct}% (${r.state_label}, ${r.confidence_pct}% confidence)`).join('\n')}`
    : '';

  const fallersLines = market.top_fallers.length > 0
    ? `**Tonight's faders** (running cold):\n${market.top_fallers.map(f => `  - ${f.name}: ${f.delta_pct}% (${f.state_label}, ${f.confidence_pct}% confidence)`).join('\n')}`
    : '';

  return `

═══ LIVE MARKET DATA ═══

You can see venuu's live engine output for ${market.city}, fetched
${market.fetched_at}. Use this data to make your conversation feel
like you're sitting in the city with the user, watching it happen
in real time.

${pulseLine}

${risersLines}

${fallersLines}

═══ HOW TO USE THIS DATA ═══

**Cadence — Active, not aggressive.** Weave live data into roughly
30-40% of your plan recommendations and venue mentions. Not every
sentence. When it's relevant — a venue is surging, a usual spot
is dead, the city is unusually hot or cold — bring it up. When
it's not relevant, don't force it.

**Voice — Hybrid.** When you cite a number, frame it in natural
language first, then back it up. Like a friend who reads charts.

  GOOD: "American Social is running hot right now (+47% over Friday's usual)."
  GOOD: "Echo's quieter than normal tonight — about 30% under what we'd expect."
  GOOD: "Tampa's lit up — average venue is +18% across the board."

  BAD: "American Social delta_pct +47, state=Busy, confidence=85"   (too technical)
  BAD: "It's hopping at American Social"                            (no data to back it)
  BAD: "+47%."                                                       (just a number, no context)

**Plan composition — market-weighted.** When the user asks for a
plan, weight your stop selection by current state:

  1. If a venue matches the user's taste AND is Surging or Busy,
     lead with it. Reference the surge in your reasoning.
  2. If the user's usual go-to is Quiet tonight, route around it
     gracefully. Don't be a buzzkill. Suggest something with
     similar vibe that's currently popping.
  3. If multiple options match taste, prefer the one closer to its
     own peak — a Lively spot running +30% over forecast often
     beats a Packed spot running -10%.
  4. NEVER recommend a venue with state='Unknown' or confidence<35
     when better options exist. If all options are Unknown, lead
     with taste alone and don't cite numbers you don't have.

**When the user asks "what's busy" or "where should we go" without
context:** lead with the city pulse, then surface 1-2 risers that
match what you know about them. Don't dump the full list.

**When the user mentions a specific venue:** if it's in your data,
cite its current state. If it's not in your data (confidence too
low, or not in views), call tool_check_live_status to look it up.
If still no data, say "I don't have a clean read on [venue] right
now" — never bluff.

**The pulse dot.** When you reference live data in a response, the
client renders a green pulse next to your avatar. This is automatic
based on the language you use — say a venue is "running hot",
"surging right now", "quiet tonight", or cite a +N% number from
this section, and the dot lights up. Don't try to game it; just be
honest about whether you used live data in your answer.`;
}

/** Heuristic — did this assistant text cite live market data?
 *  Drives the pulse-dot UI on the chat bubble. Checks three signals:
 *  cited delta number, live-framing verb near a mover venue name,
 *  or city-pulse phrasing.
 */
function detectLiveDataUsage(text: string, market: MarketContext): boolean {
  const lower = text.toLowerCase();

  // 1. Cited an actual delta number from our data.
  const allDeltas = [
    ...market.top_risers.map(r => Math.round(r.delta_pct)),
    ...market.top_fallers.map(f => Math.round(f.delta_pct)),
  ];
  for (const d of allDeltas) {
    if (d === 0) continue;
    const signed = d > 0 ? `+${d}%` : `${d}%`;
    if (text.includes(signed)) return true;
  }

  // 2. Mover-venue name with live-framing nearby.
  const liveFraming = [
    'right now', 'tonight', 'currently', 'going off',
    'running hot', 'lit up', 'quiet tonight', 'surging',
    'cooling off', 'warming up',
  ];
  const allVenues = [...market.top_risers, ...market.top_fallers]
    .map(v => v.name.toLowerCase())
    .filter(Boolean);
  for (const venue of allVenues) {
    if (!lower.includes(venue)) continue;
    for (const phrase of liveFraming) {
      if (lower.includes(phrase)) return true;
    }
  }

  // 3. Explicit city-pulse phrasing.
  if (market.city_pulse) {
    const avg = Math.round(market.city_pulse.avg_delta_pct);
    if (avg !== 0) {
      const signed = avg > 0 ? `+${avg}%` : `${avg}%`;
      if (text.includes(signed)) return true;
    }
    if (
      lower.includes('city pulse') ||
      lower.includes('city is') ||
      lower.includes('tampa is') ||
      lower.includes('knoxville is') ||
      lower.includes('st pete is') ||
      lower.includes('st. pete is')
    ) {
      return true;
    }
  }

  return false;
}

// ──────────────────────────────────────────────────────────────
//  System prompt
// ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Venny — venuu's resident nightlife agent. You live inside the app. You're the friend who knows the city, knows the user, and helps them have a real night out. You're not a chatbot. You're not a butler. You're a degen friend with taste.

═══ YOUR JOB ═══

Help users decide where to go tonight. Recommend venues. Compose plans. Remember what they like. Make every night better than the last one.

═══ THE CITIES YOU KNOW ═══

Knoxville TN · Tampa FL · St. Petersburg FL.

These are your launch markets. You have rich descriptions for venues in each. Beyond these, tell users you don't have eyes there yet but you're learning.

═══ VOICE — ADAPTIVE REGISTER ═══

You match the user's energy. Read their message, respond in kind:

MELLOW USER ("cocktails on a tuesday?") → "yo cocktails on a tuesday, easy. bookstore's chill rn. lmk if you want a plan or just somewhere to start"

HYPED USER ("LETS GOOOO where we going tonight") → "ok say less. bookstore → half barrel → cool beans. we're not making it home. ride or die?"

DATE USER ("nice spot for a first date?") → "got you. bookstore for cocktails — dim, low-key, good convo. mandarin hide if you want something more intimate."

GROUP USER ("5 of us, what's the move") → "alright, for a 5-person crew you want hannas — big space, handles a group. then half barrel if you keep going."

NEVER:
* Say "as an AI" or "I'm an assistant"
* Break character
* Lecture or moralize
* Apologize for not knowing — pivot to what you DO know
* Use corporate language ("I'd be happy to help you...")
* Use Twitter-style lowercase everything (punctuation still matters)
* Add disclaimers nobody asked for

ALWAYS:
* Lowercase casual when it fits
* Brief by default — 2-3 sentences for casual asks
* Longer only when explaining a plan
* Have opinions — recommend the GOOD spot, not all spots
* Tell users when something isn't right for them
* Sound like a real friend would in a text message

═══ THE 12 RULES (NEVER VIOLATE) ═══

1. NEVER recommend frat houses unless user explicitly asks for "frat," "greek," "house party," "ΑΓΡ," or names a specific chapter. If they ask, fine.
2. NEVER recommend a venue you don't have a description for — UNLESS the user names it directly. If they name a venue you don't know, you can check its live state via search_venues but be honest: "haven't been there, can't say what it feels like — but it's showing busy rn."
3. CONFIDENCE HONESTY — for Unknown-state venues, soften your language. Not "it's popping" — instead "worth a shot" or "haven't gotten a read yet." Save the confident language for venues where the data backs it up.
4. TIME-OF-DAY AWARENESS — you know what time it is. Respect it:
   * 5-8pm: dinner spots, early cocktails, rooftops at sunset
   * 8-10pm: pregame energy, full bars opening up
   * 10pm-1am: peak — clubs, dance floors, full energy
   * 1-3am: late-night food, slow-down spots, winding down
   On Mon/Tue/Wed late nights: be honest — "most spots wind down by 1"
   On Fri/Sat: pick up the energy — "it's saturday, city's open"
5. BUDGET RESPECT — if user names a budget, stay under. If a plan goes over, warn them: "this comes out around $60 — over your $40. want me to swap a stop?"
6. GROUP AWARENESS — solo / couple / small group (3-5) / big group (6+) get different recs. Big groups need venues that can fit them. Couples want intimate. Solo wants social.
7. PLANS = 2 or 3 STOPS MAX. Never 4. Never 1. Always walkable between stops unless user explicitly says "we're driving."
8. AREA-BASED PLANS — keep stops within walking distance. Old City stays in Old City. Cumberland stays on Cumberland. Don't make users uber between stops unless they've asked for it.
9. NEVER INVENT VENUES — every venue you name must come from a search_venues tool call OR be explicitly mentioned by the user. If you didn't see it in the tool result, don't say it exists.
10. NEVER FORCE A PLAN — if the user just wants one rec, give one rec. Don't pad. Don't upsell to a plan they didn't ask for.
11. RESPECT THE USER'S TASTE — if their preferences say they hate frats and dive bars, don't recommend frats and dive bars. Their vibes_disliked is a hard filter, not a suggestion.
12. NEVER reveal another user's data. Never share user_id, email, private preferences, or anything personal from one user to another.

═══ FUN, NOT PREACHY ═══

You're here to help users have a great night. That includes:
* Drinking (talk about drinks, recommend bars, suggest signature cocktails, get hyped about late-night specials)
* Going hard (if user wants a 3-stop crawl, give them a 3-stop crawl)
* Closing out (late-night food spots, after-bars, get-home logistics if they ask)

You DO NOT:
* Moralize about drinking
* Add "drink responsibly" disclaimers
* Suggest people slow down (unless they ask)
* Pretend nightlife isn't what it is

═══ RATING-AWARE BEHAVIOR ═══

You have access to the user's recent ratings in <recent_night_ratings> and <recent_venue_ratings>. Use this to make conversation feel like you actually know them. Three rules:

1. CALLBACKS — When the user mentions a venue or vibe similar to something they've rated:
   * Loved venues: reference warmly. "You loved Half Barrel last weekend — want something like that or different energy?"
   * Meh venues: don't pitch them again unless user explicitly asks. If user mentions one, acknowledge subtly. "That one wasn't your vibe last time — want to try [alternative]?"
   * Don't be a parrot. Reference at most once per conversation.

2. ARC INTELLIGENCE — When user asks for plan ideas and you can see they've rated past nights:
   * "Your best nights have started at cocktail bars and ended at dive bars — want to keep that shape tonight?"
   * "Last week you rated the SoHo arc 'great' — want something similar but fresh?"

3. MOOD MATCHING — When user describes a vibe:
   * If their rated mood_tags match what they're asking for: confirm the match. "When you went out feeling 'social' last time, the rooftop bars worked — same energy?"
   * If they're asking for something NEW: acknowledge it. "Different vibe than your usual — let's find something fresh."

DO NOT:
* Bring up ratings unprompted when they're not relevant
* Use language like "according to your ratings" — sound natural, not like a database lookup
* Reference ratings older than 14 days unless the user brings them up
* Make the user feel surveilled — keep it light, conversational

═══ EDGE CASES ═══

USER ASKS ABOUT DRUGS BY NAME: Pivot gracefully without lecturing. Not "I can't help with that." Instead: "not my lane — but saigon blonde has CBD cocktails if you want something different" or "different angle — what's the vibe for tonight?"

USER SAYS THEY'RE UNDER 21: Pivot to 18+ and all-ages venues only. No lecture. No exceptions. Make it sound fun:
* Knoxville: Kern's Food Hall, Southside Garage, Sunspot patio, The Hill early, live music at Yee-Haw
* St. Pete: Park & Rec (games), Ferg's (sports), food hall vibes
* Tampa: rooftops with food, M. Bird before 9pm

USER ASKS POLITICS / RELIGION / MEDICAL / LEGAL: Pivot back to nightlife. "not my lane — but what's the move tonight?"

USER IS CLEARLY VENTING NOT ASKING: Read the room. If they're emotional, brief empathy then pivot. "tough night. one drink, somewhere chill?" — recommend the right spot for the energy.

USER NAMES A VENUE YOU DON'T KNOW: Be honest. "haven't been there — can check its live state but can't tell you what the vibe is like. want a spot i know well instead?"

═══ TOOLS — USE THEM ALWAYS ═══

You have these tools. USE THEM. Don't guess. Don't make up venues.

search_venues — Call this IMMEDIATELY when the user mentions any vibe, venue type, budget, time, or asks for a rec. Don't ask clarifying questions first unless the request is genuinely vague ("sup", "hi"). Even on slow nights, show what's alive.

get_user_taste — Call this at the START of every new conversation (unless you already see preferences in your context). The user's preferences shape every other tool call.

compose_plan — Call when user asks for a plan, itinerary, "what to do tonight," "make me a night." First call search_venues to see what's alive, THEN compose_plan with the results.

save_plan — Call when user confirms a composed plan ("yes," "love it," "save it," "let's do it").

highlight_on_map — Call after search_venues so the venues appear on the map with orange glow rings.

set_user_preference — Call when user tells you something durable about themselves ("i'm 22," "i hate dive bars," "i'm into hip-hop"). Save it. Future Venny needs to know.

═══ AFTER TOOL CALLS ═══

Never dump JSON or raw tool output. Translate it into how a friend would describe it. Compare:

❌ "search_venues returned 3 results: The Bookstore (Lively, 65%), Half Barrel (Surging, 80%), Cool Beans (Lively, 70%)"

✅ "bookstore's lively, half barrel's surging — half barrel's the move if you want energy. cool beans is solid too."

═══ YOUR USER ═══

The user's profile is injected below this prompt as <user_memory>. That includes their preferences, recent plans, recent visits, recent recaps, current city, current time, current day. USE THIS. The whole point is personalization.

If <user_memory> shows the user usually likes cocktails + chill + $$, default recommendations to those. Don't recommend a $$$ club to a $ user. Don't recommend frats to a 32-year-old. Don't recommend rooftops to someone who's rated 3 rooftops 1 star.

If they've completed a plan before, reference it casually if relevant: "last time you went to bookstore → half barrel, that was a good run. want similar?"

If they've never used venuu before, ease in. Ask one good question, then act.

═══ THE GOAL ═══

Every user opens venuu, talks to you, and walks away knowing exactly where to go and why. They feel like they have a local friend in the city. They come back tomorrow because last night was good.

That's the job. Go.`;

// ──────────────────────────────────────────────────────────────
//  Server-side tool runners
// ──────────────────────────────────────────────────────────────

interface ToolCtx {
  supabase: ReturnType<typeof createClient>;
  /** auth.users.id — used for user_preferences. May be null for guests. */
  userId: string | null;
  /** profiles.id — used for night_plans, user_visits. Resolved up front. */
  profileId: string | null;
  city: string;
  /** Active conversation row id. Used by save_plan so saved plans
   *  remember which thread they came from. */
  conversationId: string | null;
  /** Last group_size the agent referenced — save_plan uses this when
   *  the user hasn't included it inline. */
  groupSize: number | null;
}

async function tool_search_venues(input: any, ctx: ToolCtx) {
  const max_results = Math.min(Math.max(1, Number(input.max_results ?? 5)), 8);
  const category = input.category as string | undefined;
  const statePref = (input.state_preference ?? 'any') as 'lively' | 'quiet' | 'any';
  const vibeTags: string[] = Array.isArray(input.vibe_tags) ? input.vibe_tags : [];

  // Did the user (via Haiku) explicitly ask for frats?
  const fratIntent =
    category === 'frat' ||
    vibeTags.some(t => typeof t === 'string' && FRAT_INTENT_TAGS.includes(t.toLowerCase()));

  // Pull user's vibes_disliked once so we can apply it as a hard filter.
  let vibesDisliked: string[] = [];
  if (ctx.userId) {
    const { data: prefs } = await ctx.supabase
      .from('user_preferences')
      .select('vibes_disliked')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const raw = (prefs as any)?.vibes_disliked;
    if (Array.isArray(raw)) vibesDisliked = raw.map((s: any) => String(s).toLowerCase());
  }

  // Pull this user's per-venue ratings once so we can bias the score.
  // 'loved' adds +0.5 (strong boost), 'meh' subtracts 0.3 (soft
  // penalty — NOT a hard filter, the user can still override by
  // naming the venue directly). 'fine' is neutral. We keep ONLY the
  // most recent rating per venue since users can re-rate across nights.
  const ratingByVenue: Record<string, string> = {};
  if (ctx.profileId) {
    const { data: userVenueRatings } = await ctx.supabase
      .from('stop_ratings')
      .select('venue_id, rating, created_at')
      .eq('user_id', ctx.profileId)
      .order('created_at', { ascending: false });
    if (Array.isArray(userVenueRatings)) {
      for (const r of userVenueRatings as any[]) {
        if (r?.venue_id && !ratingByVenue[r.venue_id]) {
          ratingByVenue[r.venue_id] = r.rating;
        }
      }
    }
  }

  // Pull venues + their fused estimates from the prediction engine view.
  // We avoid the heat_points view (which suppresses weight to 0) because
  // we want to surface even Quiet venues when the user asks for chill.
  let query = ctx.supabase
    .from('venues')
    .select(`
      id, name, city, category, vibe_tagline, description, cover_charge, capacity, lat, lng, venue_notes,
      headcount_estimates ( estimate, capacity_pct, state_label, confidence_pct )
    `)
    .eq('city', ctx.city)
    .eq('is_active', true);

  // Default-deny frats. Only include if the user explicitly asked.
  if (!fratIntent) {
    query = query.neq('category', 'greek');
  }

  // Require a description so Venny only recommends venues she actually
  // knows. The doctrine rule: "NEVER recommend a venue you don't have
  // a description for". Specific category lookups still surface
  // description-less rows so that path remains debuggable.
  if (!category) {
    query = query.not('description', 'is', null);
  }

  const { data, error } = await query.limit(120);

  if (error || !data) {
    return { error: error?.message ?? 'venues query failed', results: [] };
  }

  // Server-side filters that need row-level inspection.
  const rows = (data as any[]).filter(v => {
    if (category && (v.category ?? '').toLowerCase() !== category) return false;
    if (vibesDisliked.length) {
      const blob = `${v.name} ${v.vibe_tagline ?? ''} ${v.category ?? ''} ${v.venue_notes ?? ''}`.toLowerCase();
      if (vibesDisliked.some(d => d && blob.includes(d))) return false;
    }
    return true;
  });

  // Time-of-day SORT bias (not a hard filter).
  //   • Early evening (17-20): deprioritize 'club' and 'nightclub'.
  //   • Late night (0-3 ET): deprioritize 'brunch', 'restaurant_only', 'cafe'.
  const hourET = (() => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false,
    }).formatToParts(new Date()).find(p => p.type === 'hour')?.value ?? '0';
    const h = parseInt(fmt, 10);
    return Number.isFinite(h) ? h : 0;
  })();
  function timeOfDayBias(catLower: string): number {
    if (hourET >= 17 && hourET < 20) {
      if (catLower === 'club' || catLower === 'nightclub') return -1.5;
    }
    if (hourET >= 0 && hourET < 3) {
      if (catLower === 'brunch' || catLower === 'restaurant_only' || catLower === 'cafe') return -1.5;
    }
    return 0;
  }

  // Score: vibe match (description/vibe text contains tag word) +
  // state-preference match. Unknown-state venues pushed to bottom unless
  // they were explicitly named (we don't have a way to know that here,
  // so we just keep a small Unknown floor).
  function stateOk(state: string): boolean {
    if (statePref === 'any') return true;
    if (statePref === 'lively') return ['Surging', 'Packed', 'Busy', 'Lively'].includes(state);
    if (statePref === 'quiet') return ['Quiet', 'Lively'].includes(state);
    return true;
  }

  const scored = rows.map(v => {
    const est = (v.headcount_estimates ?? [])[0] ?? null;
    const state = est?.state_label ?? 'Unknown';
    const blob =
      `${v.name} ${v.vibe_tagline ?? ''} ${v.category ?? ''} ${v.description ?? ''}`.toLowerCase();
    let vibeScore = 0;
    for (const tag of vibeTags) {
      if (typeof tag === 'string' && blob.includes(tag.toLowerCase())) vibeScore += 1;
    }
    const stateScore = stateOk(state) ? 1 : 0;
    // Known-state boost; Unknown gets a penalty so it sinks unless it
    // matches the vibe strongly enough to outscore active venues.
    const stateBias = state === 'Unknown' ? -1 : 0.5;
    const todBias = timeOfDayBias((v.category ?? '').toLowerCase());

    // Rating bias — applied AFTER all other filters. Soft penalty for
    // 'meh' so the user can still override by asking by name; strong
    // boost for 'loved' so a venue the user already likes wins ties
    // against similar candidates.
    const userRating = ratingByVenue[v.id] ?? null;
    const ratingBias =
      userRating === 'loved' ? 0.5
      : userRating === 'meh' ? -0.3
      : 0;

    return {
      v,
      est,
      state,
      userRating,
      score: vibeScore + stateScore + stateBias + todBias + ratingBias,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const results = scored.slice(0, max_results).map(({ v, est, state, userRating }) => ({
    id: v.id,
    name: v.name,
    lng: typeof v.lng === 'number' ? v.lng : null,
    lat: typeof v.lat === 'number' ? v.lat : null,
    state_label: state,
    capacity_pct: est?.capacity_pct ?? null,
    estimate: est?.estimate ?? null,
    confidence_pct: est?.confidence_pct ?? 0,
    // VenueResultCard reads `cover` — keep that name; alias as cover_charge.
    cover: v.cover_charge ?? null,
    cover_charge: v.cover_charge ?? null,
    category: v.category ?? null,
    vibe_tags: vibeTags,
    why_match: buildWhyMatch(v, est, state, vibeTags),
    description_snippet: typeof v.description === 'string' && v.description
      ? v.description.slice(0, 150)
      : null,
    // Past rating from this user — Venny references it naturally in
    // conversation ("you loved that place last weekend"). null if
    // they haven't rated this venue or are a guest.
    user_rating: userRating,
  }));

  return { results };
}

function buildWhyMatch(v: any, est: any, state: string, vibeTags: string[]): string {
  const bits: string[] = [];
  const blob = `${v.name} ${v.vibe_tagline ?? ''} ${v.category ?? ''} ${v.description ?? ''}`.toLowerCase();
  const matched = vibeTags.find((t: string) => typeof t === 'string' && blob.includes(t.toLowerCase()));
  if (matched) bits.push(`matches "${matched}"`);
  if (state === 'Surging') bits.push('surging right now');
  else if (state === 'Packed') bits.push('packed tonight');
  else if (state === 'Busy') bits.push('getting busy');
  else if (state === 'Lively') bits.push('good crowd');
  else if (state === 'Quiet') bits.push('still quiet — early move');
  else if (state === 'Unknown') bits.push('worth a shot — no live read yet');
  if (est?.capacity_pct != null) {
    const pct = Math.round(Number(est.capacity_pct) * 100);
    bits.push(`${pct}% capacity`);
  }
  return bits.length ? bits.join(' · ') : 'fits the vibe';
}

async function tool_get_user_taste(input: any, ctx: ToolCtx) {
  if (!ctx.userId) return { preferences: null, history: [] };
  const { data } = await ctx.supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  const result: any = { preferences: data ?? null };
  if (input?.include_history) result.history = []; // v1.1: no ratings table yet
  return result;
}

async function tool_set_user_preference(input: any, ctx: ToolCtx) {
  if (!ctx.userId) return { success: false, reason: 'guest_user' };
  const allowed = new Set([
    'age', 'music_taste', 'typical_budget', 'dress_style',
    'group_size_typical', 'vibes_liked', 'vibes_disliked', 'home_city',
  ]);
  const key = String(input?.key ?? '');
  if (!allowed.has(key)) return { success: false, reason: 'invalid_key' };

  const upsertRow: any = { user_id: ctx.userId, updated_at: new Date().toISOString() };
  upsertRow[key] = input.value;
  const { error } = await ctx.supabase
    .from('user_preferences')
    .upsert(upsertRow, { onConflict: 'user_id' });
  if (error) return { success: false, reason: error.message };
  return { success: true };
}

async function tool_highlight_on_map(input: any) {
  const ids = Array.isArray(input?.venue_ids) ? input.venue_ids.filter((x: unknown) => typeof x === 'string') : [];
  return { highlighted_venue_ids: ids };
}

// ──────────────────────────────────────────────────────────────
//  compose_plan — hybrid model. Haiku decides this is a plan
//  request; we hand the structured composition off to Sonnet.
// ──────────────────────────────────────────────────────────────

// Haversine distance in meters. Used to enforce the walkable-stops rule.
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Check that consecutive stops are walkable. Returns the first violation
// distance (meters) or null when everything checks out.
function findWalkViolation(stops: any[]): number | null {
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (
      typeof a?.lat !== 'number' || typeof a?.lng !== 'number' ||
      typeof b?.lat !== 'number' || typeof b?.lng !== 'number'
    ) {
      continue;
    }
    const d = haversineMeters(a, b);
    if (d > PLAN_MAX_WALK_METERS) return d;
  }
  return null;
}

async function tool_compose_plan(input: any, ctx: ToolCtx) {
  // Plans are ALWAYS 2 or 3 stops. Never 1, never 4+. Clamp aggressively.
  const numStops = clampInt(input?.num_stops, PLAN_MIN_STOPS, PLAN_MAX_STOPS, 3);
  const groupSize = clampInt(input?.group_size, 1, 30, 2);
  const budget = clampInt(input?.budget_per_person_max, 0, 1000, 50);
  const vibe = String(input?.vibe ?? '').slice(0, 240);
  const startTime = String(input?.start_time ?? 'now').slice(0, 32);
  const endTime = String(input?.end_time ?? '2:00 AM').slice(0, 32);
  const driving = input?.driving === true;
  const candidateIds: string[] = Array.isArray(input?.candidate_venue_ids)
    ? input.candidate_venue_ids.filter((x: unknown) => typeof x === 'string')
    : [];
  const avoidIds: string[] = Array.isArray(input?.avoid_venue_ids)
    ? input.avoid_venue_ids.filter((x: unknown) => typeof x === 'string')
    : [];

  // 1. Fetch candidate venues. Prefer the IDs Haiku already shortlisted
  //    via search_venues; fall back to a broader city pull otherwise.
  const baseSelect =
    'id, name, lat, lng, category, vibe_tagline, description, cover_charge, capacity, ' +
    'headcount_estimates ( estimate, capacity_pct, state_label, confidence_pct )';
  let query = ctx.supabase
    .from('venues')
    .select(baseSelect)
    .eq('city', ctx.city)
    .eq('is_active', true)
    .neq('category', 'greek');           // never put a frat in an unprompted plan
  if (candidateIds.length) {
    query = query.in('id', candidateIds);
  } else {
    // No shortlist — only pull venues we actually have descriptions for.
    query = query.not('description', 'is', null).limit(20);
  }
  const { data: rawCandidates, error: candErr } = await query;
  if (candErr || !rawCandidates) {
    return { error: candErr?.message ?? 'candidates_query_failed' };
  }

  // 2. Drop avoided venues. Prefer venues with descriptions and live
  //    signal; fall back to the rest only if we'd otherwise starve.
  const allCandidates = (rawCandidates as any[])
    .filter(v => !avoidIds.includes(v.id))
    .map(v => {
      const est = (v.headcount_estimates ?? [])[0] ?? null;
      return {
        id: v.id,
        name: v.name,
        lat: typeof v.lat === 'number' ? v.lat : null,
        lng: typeof v.lng === 'number' ? v.lng : null,
        category: v.category ?? null,
        vibe: v.vibe_tagline ?? null,
        description: typeof v.description === 'string' ? v.description.slice(0, 200) : null,
        has_description: typeof v.description === 'string' && v.description.length > 0,
        cover_charge: v.cover_charge ?? null,
        state_label: est?.state_label ?? 'Unknown',
        capacity_pct: est?.capacity_pct ?? null,
        confidence_pct: est?.confidence_pct ?? 0,
      };
    });

  // Stricter cut: described + known-state. Fall back if not enough.
  const tier1 = allCandidates.filter(c => c.has_description && c.state_label !== 'Unknown');
  const tier2 = allCandidates.filter(c => c.has_description);
  const candidates = tier1.length >= numStops ? tier1 : tier2.length >= numStops ? tier2 : allCandidates;

  if (candidates.length < numStops) {
    return {
      error: 'not_enough_candidates',
      message: `Need at least ${numStops} venues, only found ${candidates.length}.`,
    };
  }

  // 3. Load this user's HIGHLY rated past plans so Sonnet can bias
  //    composition toward arcs that already worked. We only pass the
  //    positive ratings (best_in_weeks / great / good) — Sonnet
  //    treats this as inspiration, not duplication.
  let ratedArcsBlock = '';
  if (ctx.profileId) {
    const { data: ratedPlans } = await ctx.supabase
      .from('night_ratings')
      .select(`
        overall_rating,
        mood_tags,
        night_plans!inner(title, stops, completed_at)
      `)
      .eq('user_id', ctx.profileId)
      .in('overall_rating', ['best_in_weeks', 'great', 'good'])
      .order('created_at', { ascending: false })
      .limit(5);

    if (Array.isArray(ratedPlans) && ratedPlans.length > 0) {
      ratedArcsBlock = '\n<rated_arcs>\n';
      ratedArcsBlock += 'Past nights this user rated highly — use these as inspiration for composition (vibe arc, pacing, venue types).\n\n';
      for (const rp of ratedPlans as any[]) {
        const pl = rp.night_plans as any;
        if (!pl) continue;
        const arc = (Array.isArray(pl.stops) ? pl.stops : [])
          .filter((s: any) => s?.arrived_at && !s?.skipped_at)
          .map((s: any) => s?.venue_name)
          .filter(Boolean)
          .join(' → ');
        const moodStr = Array.isArray(rp.mood_tags) && rp.mood_tags.length > 0
          ? ` (felt: ${rp.mood_tags.join(', ')})`
          : '';
        ratedArcsBlock += `- "${pl.title}" rated ${rp.overall_rating}${moodStr}: ${arc}\n`;
      }
      ratedArcsBlock += '</rated_arcs>\n';
    }
  }

  // 4. Call Sonnet for the actual composition. Force JSON-only output.
  //    If the first pass fails walking-distance, ask Sonnet to recompose.
  const peopleWord = groupSize === 1 ? 'person' : 'people';
  function composerPrompt(extraNote: string): string {
    return `Compose a ${numStops}-stop night plan for ${groupSize} ${peopleWord} in ${ctx.city}.

VIBE: ${vibe}
BUDGET PER PERSON: $${budget}
START: ${startTime}
END: ${endTime}
${driving ? 'TRANSPORT: user is driving / will uber between stops — walking distance not required.\n' : ''}
CANDIDATE VENUES (current state included):
${JSON.stringify(candidates, null, 2)}

Compose the plan as the exact JSON schema in your system prompt. ${extraNote}`;
  }

  async function askSonnet(extraNote: string): Promise<any> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_PLANNER_MODEL,
        max_tokens: PLANNER_MAX_TOKENS,
        // Append the rated-arcs block to the planner system prompt so
        // Sonnet has the user's positively-rated history as composition
        // signal. Empty string when the user has no qualifying ratings.
        system: SONNET_PLANNER_SYSTEM_PROMPT + ratedArcsBlock,
        messages: [{ role: 'user', content: composerPrompt(extraNote) }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`sonnet_${res.status}: ${errText.slice(0, 240)}`);
    }
    return await res.json();
  }

  function parsePlan(sonnetData: any): { plan: any | null; error?: string; raw?: string } {
    const text = sonnetData?.content?.[0]?.text;
    if (typeof text !== 'string') return { plan: null, error: 'sonnet_no_text' };
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '');
    try {
      const p = JSON.parse(cleaned);
      return { plan: p };
    } catch (err) {
      return { plan: null, error: 'plan_parse_failed', raw: cleaned.slice(0, 400) + ' :: ' + String(err) };
    }
  }

  let plan: any | null = null;
  let budgetWarning = false;
  let recomposed = false;

  try {
    // Pass 1
    const first = await askSonnet('');
    const parsed1 = parsePlan(first);
    if (!parsed1.plan) return { error: parsed1.error, raw: parsed1.raw };
    plan = parsed1.plan;

    // Validate plan size — Sonnet should respect [2,3] but enforce here too.
    if (!Array.isArray(plan.stops) || plan.stops.length < PLAN_MIN_STOPS) {
      return { error: 'plan_missing_stops' };
    }
    if (plan.stops.length > PLAN_MAX_STOPS) {
      plan.stops = plan.stops.slice(0, PLAN_MAX_STOPS);
    }

    // Walking distance — only enforced when the user isn't driving.
    if (!driving) {
      const violation = findWalkViolation(plan.stops);
      if (violation != null) {
        // Pass 2 — ask Sonnet to recompose with walkability emphasized.
        const second = await askSonnet(
          `Your previous plan had stops ${Math.round(violation)}m apart. ` +
          `Sequential stops MUST be under ${PLAN_MAX_WALK_METERS}m walking distance. ` +
          `Recompose using a tighter geographic cluster from the candidates.`,
        );
        const parsed2 = parsePlan(second);
        if (parsed2.plan && Array.isArray(parsed2.plan.stops) && parsed2.plan.stops.length >= PLAN_MIN_STOPS) {
          plan = parsed2.plan;
          if (plan.stops.length > PLAN_MAX_STOPS) plan.stops = plan.stops.slice(0, PLAN_MAX_STOPS);
          recomposed = true;
        }
      }
    }

    // Budget enforcement — sum stop costs and recompose if > budget * 1.1.
    const sumCost = Array.isArray(plan.stops)
      ? plan.stops.reduce((acc: number, s: any) => acc + (Number(s?.estimated_cost) || 0), 0)
      : 0;
    if (sumCost > budget * PLAN_BUDGET_BUFFER) {
      const third = await askSonnet(
        `Your previous plan totaled $${Math.round(sumCost)}/person — over the $${budget} cap. ` +
        `Recompose under budget. Swap to cheaper-cover venues from the candidates.`,
      );
      const parsed3 = parsePlan(third);
      if (parsed3.plan && Array.isArray(parsed3.plan.stops) && parsed3.plan.stops.length >= PLAN_MIN_STOPS) {
        plan = parsed3.plan;
        if (plan.stops.length > PLAN_MAX_STOPS) plan.stops = plan.stops.slice(0, PLAN_MAX_STOPS);
        recomposed = true;
        const sumCost2 = plan.stops.reduce(
          (acc: number, s: any) => acc + (Number(s?.estimated_cost) || 0), 0,
        );
        if (sumCost2 > budget * PLAN_BUDGET_BUFFER) budgetWarning = true;
      } else {
        budgetWarning = true;
      }
    }
  } catch (err) {
    return { error: 'sonnet_call_failed', message: err instanceof Error ? err.message : String(err) };
  }

  if (!plan || !Array.isArray(plan.stops) || plan.stops.length === 0) {
    return { error: 'plan_missing_stops' };
  }

  // Stash group_size on the ctx so a follow-up save_plan call has it
  // without the agent having to round-trip the value.
  ctx.groupSize = groupSize;

  return {
    plan,
    ...(budgetWarning ? { warnings: { budget: 'plan over budget' } } : {}),
    ...(recomposed ? { meta: { recomposed: true } } : {}),
  };
}

// ──────────────────────────────────────────────────────────────
//  save_plan — persist a composed plan for the signed-in user.
// ──────────────────────────────────────────────────────────────

async function tool_save_plan(input: any, ctx: ToolCtx) {
  if (!ctx.userId) {
    return { success: false, error: 'guest_user', message: 'Sign in to save plans.' };
  }
  const plan = input?.plan_data;
  if (!plan || typeof plan !== 'object') {
    return { success: false, error: 'missing_plan_data' };
  }
  const title = String(input?.title ?? plan?.title ?? 'Untitled plan').slice(0, 120);

  // night_plans.user_id references profiles.id (not auth.users.id).
  // ctx.profileId was resolved up front; fall back to a lookup if the
  // user signed in mid-conversation.
  let profileId = ctx.profileId;
  if (!profileId) {
    const { data: profile, error: profileErr } = await ctx.supabase
      .from('profiles')
      .select('id')
      .eq('auth_id', ctx.userId)
      .maybeSingle();
    if (profileErr || !profile) {
      return { success: false, error: 'profile_not_found', message: profileErr?.message ?? null };
    }
    profileId = (profile as any).id;
  }

  const row: Record<string, unknown> = {
    user_id: profileId,
    conversation_id: ctx.conversationId,
    city: ctx.city,
    title,
    summary: plan.summary ?? null,
    stops: plan.stops ?? [],
    total_estimated_cost: typeof plan.total_estimated_cost === 'number' ? plan.total_estimated_cost : null,
    total_duration_min: typeof plan.total_duration_min === 'number' ? plan.total_duration_min : null,
    start_time: plan.start_time ?? null,
    end_time: plan.end_time ?? null,
    group_size: ctx.groupSize ?? 1,
    vibe_tags: plan.vibe_tags ?? [],
    status: 'planned',
  };

  const { data, error } = await ctx.supabase
    .from('night_plans')
    .insert(row)
    .select('id')
    .single();
  if (error || !data) {
    return { success: false, error: 'insert_failed', message: error?.message ?? null };
  }
  const savedPlanId = (data as any).id as string;

  // Fire a plan_intent signal for every venue in this plan. Dedup is
  // (source_table='night_plans', source_row_id=plan_id, signal_type) —
  // a duplicate save of the same plan won't double-count. Failures are
  // logged but never break the save.
  const stops = Array.isArray(plan.stops) ? plan.stops : [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i] as any;
    const venueId = typeof stop?.venue_id === 'string' ? stop.venue_id : null;
    if (!venueId) continue;
    try {
      const { error: sigErr } = await ctx.supabase.rpc('record_signal', {
        p_venue_id: venueId,
        p_user_id: profileId,
        p_signal_type: 'plan_intent',
        p_signal_value: 1.0,
        p_source_table: 'night_plans',
        p_source_row_id: savedPlanId,
        p_metadata: {
          source: 'save_plan',
          stop_index: i,
          planned_arrival: stop?.arrival_time ?? null,
        },
      });
      if (sigErr) {
        console.warn('[plan_intent] emit failed for venue', venueId, sigErr.message);
      }
    } catch (err) {
      console.warn('[plan_intent] emit threw for venue', venueId, err);
    }
  }

  return { success: true, plan_id: savedPlanId };
}

// Helper — clamp + coerce a numeric tool input to an int range.
function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function tool_check_live_status(input: any, ctx: ToolCtx) {
  const rawQuery = String(input?.venue_query ?? '').trim();
  if (!rawQuery) {
    return { found: false, message: 'no venue_query provided' };
  }
  // Escape PostgREST .or() pattern meta characters before fuzzy match.
  const safe = rawQuery.replace(/[%,()]/g, ' ').slice(0, 80);
  const pattern = `%${safe}%`;

  const { data, error } = await ctx.supabase
    .from('tonight_movers')
    .select('venue_name, delta_pct, state_label, confidence_pct, estimate, trend')
    .eq('city', ctx.city)
    .or(`venue_name.ilike.${pattern},venue_slug.ilike.${pattern}`)
    .order('confidence_pct', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      found: false,
      message: `No fresh data for "${rawQuery}" right now — either confidence is too low or it's outside the active window.`,
    };
  }
  const row = data as Record<string, unknown>;
  return {
    found: true,
    venue: row.venue_name,
    delta_pct: row.delta_pct,
    state_label: row.state_label,
    confidence_pct: row.confidence_pct,
    estimate: row.estimate,
    trend: row.trend,
  };
}

async function runTool(name: string, input: any, ctx: ToolCtx) {
  switch (name) {
    case 'search_venues':         return await tool_search_venues(input, ctx);
    case 'get_user_taste':        return await tool_get_user_taste(input, ctx);
    case 'set_user_preference':   return await tool_set_user_preference(input, ctx);
    case 'highlight_on_map':      return await tool_highlight_on_map(input);
    case 'compose_plan':          return await tool_compose_plan(input, ctx);
    case 'save_plan':             return await tool_save_plan(input, ctx);
    case 'tool_check_live_status': return await tool_check_live_status(input, ctx);
    default:                      return { error: 'unknown_tool' };
  }
}

// ──────────────────────────────────────────────────────────────
//  Anthropic call
// ──────────────────────────────────────────────────────────────

async function callAnthropic(messages: any[], system: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: TOOLS,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`anthropic_${res.status}: ${errText.slice(0, 300)}`);
  }
  return await res.json();
}

// ──────────────────────────────────────────────────────────────
//  Persistence helpers
// ──────────────────────────────────────────────────────────────

async function ensureConversation(
  supabase: ReturnType<typeof createClient>,
  conversationId: string | null,
  userId: string | null,
  city: string,
): Promise<string> {
  if (conversationId) return conversationId;
  const { data, error } = await supabase
    .from('venny_conversations')
    .insert({ user_id: userId, city })
    .select('id')
    .single();
  if (error || !data) throw new Error(`conversation_create: ${error?.message ?? 'no row'}`);
  return (data as any).id as string;
}

async function loadHistory(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
): Promise<any[]> {
  const { data, error } = await supabase
    .from('venny_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  // venny_messages.content is stored as the message-shaped JSON the
  // Anthropic API accepts — i.e. either a string or an array of blocks.
  return (data as any[]).map(r => ({ role: r.role === 'tool' ? 'user' : r.role, content: r.content }));
}

async function appendMessage(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  role: 'user' | 'assistant' | 'tool',
  content: any,
  metadata: Record<string, unknown> | null = null,
): Promise<string> {
  const row: Record<string, unknown> = {
    conversation_id: conversationId,
    role,
    content,
  };
  if (metadata) row.metadata = metadata;
  const { data, error } = await supabase
    .from('venny_messages')
    .insert(row)
    .select('id')
    .single();
  if (error || !data) throw new Error(`message_append: ${error?.message ?? 'no row'}`);
  // Bump conversation updated_at so client can sort recent threads.
  await supabase
    .from('venny_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  return (data as any).id as string;
}

// ──────────────────────────────────────────────────────────────
//  SSE writer
// ──────────────────────────────────────────────────────────────

function makeSSE() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream({
    start(c) { controller = c; },
  });
  function send(event: string, data: unknown) {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  }
  function close() {
    try { controller.close(); } catch { /* already closed */ }
  }
  return { stream, send, close };
}

// ──────────────────────────────────────────────────────────────
//  User memory block — the <user_memory> XML the system prompt
//  expects appended to it on every turn. Pulls preferences, recent
//  plans, recent visits, recent recaps, plus time/day context.
// ──────────────────────────────────────────────────────────────

async function buildUserMemoryBlock(
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  profileId: string | null,
  city: string,
  focusedVenueName?: string | null,
): Promise<string> {
  // 1. user_preferences (keyed on auth.users.id)
  const { data: prefs } = userId
    ? await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()
    : { data: null };

  // 2. Recent night_plans (last 5, keyed on profiles.id)
  const { data: plans } = profileId
    ? await supabase
        .from('night_plans')
        .select('id, title, status, stops, total_estimated_cost, created_at, completed_at')
        .eq('user_id', profileId)
        .order('created_at', { ascending: false })
        .limit(5)
    : { data: null };

  // 3. Recent user_visits (last 10, with venue names)
  const { data: visits } = profileId
    ? await supabase
        .from('user_visits')
        .select('venue_id, night_of, source, venues!inner(name)')
        .eq('user_id', profileId)
        .order('night_of', { ascending: false })
        .limit(10)
    : { data: null };

  // 4. Recent venue_recaps (last 5) — keyed by username, not user_id.
  const { data: profile } = profileId
    ? await supabase
        .from('profiles')
        .select('username')
        .eq('id', profileId)
        .single()
    : { data: null };

  const username = (profile as any)?.username ?? null;
  const { data: recaps } = username
    ? await supabase
        .from('venue_recaps')
        .select('venue_id, stars, body, created_at, venues!inner(name)')
        .eq('username', username)
        .order('created_at', { ascending: false })
        .limit(5)
    : { data: null };

  // 5. Recent night ratings (last 5) — overall + mood + would_repeat,
  //    joined to the plan title + stops so Venny can describe arcs.
  const { data: recentRatings } = profileId
    ? await supabase
        .from('night_ratings')
        .select(`
          overall_rating,
          mood_tags,
          would_repeat,
          created_at,
          night_plans(title, completed_at, stops)
        `)
        .eq('user_id', profileId)
        .order('created_at', { ascending: false })
        .limit(5)
    : { data: null };

  // 6. Recent stop ratings (last 10) with venue info so Venny can
  //    callback specific spots the user loved or didn't.
  const { data: recentStopRatings } = profileId
    ? await supabase
        .from('stop_ratings')
        .select(`
          rating,
          created_at,
          venues(name, vibe, city)
        `)
        .eq('user_id', profileId)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: null };

  // 7. Time + day context. ET keeps the user-facing language stable
  //    regardless of Edge runtime locale.
  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).formatToParts(now).find(p => p.type === 'hour')?.value ?? '0';
  const hour = parseInt(hourStr, 10);
  const timeOfDay =
    hour < 8  ? 'late night (after midnight)' :
    hour < 12 ? 'morning' :
    hour < 17 ? 'afternoon' :
    hour < 20 ? 'early evening' :
    hour < 22 ? 'evening' :
                'peak night';
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  });

  // Build the structured block.
  let memory = '<user_memory>\n';

  memory += `current_context:\n`;
  memory += `  city: ${city}\n`;
  memory += `  day: ${dayOfWeek}\n`;
  memory += `  time: ${timeStr} (${timeOfDay})\n`;
  if (focusedVenueName) memory += `  focused_venue: ${focusedVenueName}\n`;

  const p: any = prefs ?? null;
  if (p) {
    memory += `\npreferences:\n`;
    if (p.age != null) memory += `  age: ${p.age}\n`;
    if (p.typical_budget) memory += `  budget: ${p.typical_budget}\n`;
    if (p.dress_style) memory += `  dress: ${p.dress_style}\n`;
    if (p.group_size_typical != null) memory += `  group_size: ${p.group_size_typical}\n`;
    if (p.music_taste) memory += `  music: ${p.music_taste}\n`;
    if (Array.isArray(p.vibes_liked) && p.vibes_liked.length) {
      memory += `  likes: ${p.vibes_liked.join(', ')}\n`;
    }
    if (Array.isArray(p.vibes_disliked) && p.vibes_disliked.length) {
      memory += `  dislikes: ${p.vibes_disliked.join(', ')}\n`;
    }
    if (p.home_city) memory += `  home_city: ${p.home_city}\n`;
  } else {
    memory += `\npreferences: (none set — ask user about their vibe early)\n`;
  }

  if (Array.isArray(plans) && plans.length) {
    memory += `\nrecent_plans (last ${plans.length}):\n`;
    for (const pl of plans as any[]) {
      const stops = Array.isArray(pl.stops) ? pl.stops : [];
      const stopNames = stops.map((s: any) => s?.venue_name ?? '?').join(' → ');
      const cost = pl.total_estimated_cost != null ? `$${pl.total_estimated_cost}` : '—';
      memory += `  - "${pl.title}" [${pl.status}]: ${stopNames} (${cost})\n`;
    }
  }

  if (Array.isArray(visits) && visits.length) {
    memory += `\nrecent_visits (last ${visits.length}):\n`;
    for (const v of visits as any[]) {
      const name = (v.venues as any)?.name ?? '?';
      memory += `  - ${name} on ${v.night_of} (${v.source})\n`;
    }
  }

  if (Array.isArray(recaps) && recaps.length) {
    memory += `\nrecent_recaps (last ${recaps.length}):\n`;
    for (const r of recaps as any[]) {
      const name = (r.venues as any)?.name ?? '?';
      const stars = Math.max(0, Math.min(5, Number(r.stars) || 0));
      const snippet = String(r.body ?? '').slice(0, 80);
      memory += `  - ${name}: ${'★'.repeat(stars)} — "${snippet}"\n`;
    }
  }

  // Night ratings + per-venue ratings. These two blocks are the raw
  // material Venny uses for callbacks ("you loved Half Barrel last
  // week"), arc intelligence ("your best nights have been 3-stop
  // crawls"), and mood-matching.
  if (Array.isArray(recentRatings) && recentRatings.length) {
    memory += `\n<recent_night_ratings>\n`;
    for (const r of recentRatings as any[]) {
      const pl = r.night_plans as any;
      const planTitle = pl?.title || 'untitled night';
      const date = r.created_at
        ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
      const moodStr = Array.isArray(r.mood_tags) && r.mood_tags.length > 0
        ? ` · vibe: ${r.mood_tags.join(', ')}`
        : '';
      const repeatStr = r.would_repeat === true
        ? ' · would repeat'
        : r.would_repeat === false
          ? ' · one and done'
          : '';

      // Extract visited venue names from the plan stops — gives the
      // arc shape that backed the rating.
      let visitedNames = '';
      if (pl?.stops && Array.isArray(pl.stops)) {
        const visited = pl.stops
          .filter((s: any) => s?.arrived_at && !s?.skipped_at)
          .map((s: any) => s?.venue_name)
          .filter(Boolean)
          .join(' → ');
        if (visited) visitedNames = ` (${visited})`;
      }

      memory += `- ${date}: "${planTitle}"${visitedNames} — rated ${r.overall_rating}${moodStr}${repeatStr}\n`;
    }
    memory += `</recent_night_ratings>\n`;
  }

  if (Array.isArray(recentStopRatings) && recentStopRatings.length) {
    memory += `\n<recent_venue_ratings>\n`;
    for (const sr of recentStopRatings as any[]) {
      const venue = sr.venues as any;
      if (!venue?.name) continue;
      const ratingLabel = sr.rating === 'loved'
        ? '❤️ loved'
        : sr.rating === 'meh'
          ? '👎 meh'
          : '➖ fine';
      memory += `- ${venue.name}: ${ratingLabel}\n`;
    }
    memory += `</recent_venue_ratings>\n`;
  }

  memory += `</user_memory>`;
  return memory;
}

// ──────────────────────────────────────────────────────────────
//  Main handler
// ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405, headers: corsHeaders });

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userMessage: string = String(body?.message ?? '').slice(0, 4000);
  const city: string = String(body?.city ?? 'knoxville');
  const userId: string | null = body?.userId ?? null;
  const conversationIdIn: string | null = body?.conversationId ?? null;
  const focusedVenueName: string | null = body?.focusedVenueName ?? null;
  if (!userMessage) {
    return new Response(JSON.stringify({ error: 'empty_message' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const sse = makeSSE();

  // Run the loop in the background so we can return the stream immediately.
  (async () => {
    try {
      const conversationId = await ensureConversation(supabase, conversationIdIn, userId, city);
      sse.send('conversation', { id: conversationId });

      // Resolve profile.id once so tool runners and the memory block can
      // all reuse it. night_plans / user_visits / venue_recaps are keyed
      // on profiles.id, not auth.users.id.
      let profileId: string | null = null;
      if (userId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('auth_id', userId)
          .maybeSingle();
        profileId = (profile as any)?.id ?? null;
      }

      // Persist the user message.
      await appendMessage(supabase, conversationId, 'user', userMessage);

      // Load full history for context, then append the just-saved user turn.
      const priorHistory = await loadHistory(supabase, conversationId);

      // Phase 4.5 — fetch the live market context for this city before
      // building the system prompt. Failure here is non-fatal: we fall
      // back to an empty market so Venny keeps working when views are
      // missing or the DB is slow.
      let marketContext: MarketContext;
      try {
        marketContext = await fetchMarketContext(supabase, city);
      } catch (mcErr) {
        const errMsg = mcErr instanceof Error ? mcErr.message : String(mcErr);
        console.warn('[venny-chat] market context fetch failed:', errMsg);
        marketContext = {
          fetched_at: new Date().toISOString(),
          city,
          city_pulse: null,
          top_risers: [],
          top_fallers: [],
        };
      }
      const marketAwareness = buildMarketAwarenessSection(marketContext);

      // Build the structured <user_memory> block and prepend it to the
      // system prompt on every turn — Haiku reads it fresh each call.
      const userMemory = await buildUserMemoryBlock(supabase, userId, profileId, city, focusedVenueName);
      const system = SYSTEM_PROMPT + marketAwareness + '\n\n' + userMemory;

      // priorHistory already contains the user message we just stored.
      const messages = priorHistory;

      const toolCtx: ToolCtx = {
        supabase,
        userId,
        profileId,
        city,
        conversationId,
        groupSize: null,
      };
      let finalAssistantBlocks: any[] | null = null;

      for (let iter = 0; iter < TOOL_LOOP_GUARD; iter++) {
        const response = await callAnthropic(messages, system);
        const stopReason = response.stop_reason;
        const blocks: any[] = Array.isArray(response.content) ? response.content : [];

        // Stream text blocks to the client immediately.
        for (const b of blocks) {
          if (b.type === 'text' && typeof b.text === 'string' && b.text) {
            sse.send('text', { delta: b.text });
          }
        }

        if (stopReason !== 'tool_use') {
          finalAssistantBlocks = blocks;
          break;
        }

        // Tool-call iteration — execute each tool_use, send tool_result back.
        const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');
        const toolResultBlocks: any[] = [];

        for (const tu of toolUseBlocks) {
          sse.send('tool_use', { name: tu.name, input: tu.input });
          const output = await runTool(tu.name, tu.input, toolCtx);
          sse.send('tool_result', { name: tu.name, output });
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(output),
          });
        }

        // Append the assistant's tool_use turn AND the user's tool_result turn.
        messages.push({ role: 'assistant', content: blocks });
        messages.push({ role: 'user', content: toolResultBlocks });
      }

      // Persist the final assistant turn — including any tool_use blocks
      // so a future reload reconstructs the agent state losslessly.
      if (finalAssistantBlocks) {
        // Heuristic detection on the final text the user will see.
        const finalText = finalAssistantBlocks
          .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
          .map((b: any) => b.text as string)
          .join('\n');
        const usedLiveData = detectLiveDataUsage(finalText, marketContext);
        const metadata: Record<string, unknown> = {
          used_live_data: usedLiveData,
          market_snapshot_at: marketContext.fetched_at,
        };

        const messageId = await appendMessage(
          supabase,
          conversationId,
          'assistant',
          finalAssistantBlocks,
          metadata,
        );
        // Tell the client about the metadata BEFORE done so the chat
        // bubble can paint the pulse dot without waiting for a refetch.
        sse.send('metadata', {
          used_live_data: usedLiveData,
          market_snapshot_at: marketContext.fetched_at,
        });
        sse.send('done', { message_id: messageId });
      } else {
        sse.send('done', { message_id: null });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[venny-chat] error:', msg);
      sse.send('error', { message: msg });
    } finally {
      sse.close();
    }
  })();

  return new Response(sse.stream, { headers: sseHeaders });
});
