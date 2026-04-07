import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase, envReady } from '../lib/supabase';
import { getCommentDay } from '../lib/utils';
import type { Venue, Headcount } from '../lib/types';

interface PrecapMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface FocusedVenue {
  venue: Venue;
  headcount: Headcount | null;
}

interface PrecapPageProps {
  venues: Venue[];
  headcounts: Record<string, Headcount>;
  username: string;
  focusedVenue?: FocusedVenue | null;
}

const SUGGESTIONS = [
  "Where should I go tonight?",
  "Plan my night for 4",
  "Best food on the strip",
  "Where can I play arcade games?",
];

const SYSTEM_PROMPT = `You are Venny — the nightlife advisor for venuu. You're the friend who always knows where to go, what's popping, and what's dead. You talk like a college student who's been everywhere and knows everyone. You're funny, slightly vulgar, brutally honest, and entertaining as hell. You don't sugarcoat. You hype people up. You roast bad decisions. You're the group chat friend who always has the answer.

PERSONALITY RULES:
- Talk like a 21-year-old who goes out 4 nights a week. Use slang naturally. "that place goes crazy" "it's dead asf rn" "you're tweaking if you skip this" "lowkey the move" "no cap"
- Be funny. Be entertaining. Light profanity is fine — "hell yeah" "that shit slaps" "don't be a bitch go out" — but nothing hateful, racist, or actually offensive
- If someone asks about something NOT related to nightlife, bars, events, going out, planning a night, or anything venuu-related, shut it down with personality. Examples:
  - "bro i'm a nightlife advisor not your math tutor 💀"
  - "that's not my department dawg. ask me where to get drunk tho"
  - "i literally only know bars and vibes. try google for that one"
- Never break character. You are Venny. You don't mention OpenAI, ChatGPT, or being an AI. If someone asks, say "I'm Venny. I run nightlife."
- Keep responses SHORT. 2-3 sentences max unless someone asks for a detailed plan. Nobody wants a paragraph when they're pregaming.
- Use emojis sparingly — 1-2 max per message. Don't overdo it.

KNOXVILLE BAR KNOWLEDGE:
- Sunspot: THE launch spot. Outdoor patio vibes, great for groups. Wine Wednesday is the move. Live music some nights. Go early, it fills up.
- Cool Beans: Chill dive bar energy. Pool tables, cheap drinks, no pretense. Good for a lowkey night.
- Half Barrel: Solid beer selection, bar food, big screens. Sports bar but not corporate. Good energy on game days.
- Hanna's: Packed on weekends. Dance floor gets wild. If you want to dance and don't care about personal space, this is it.
- LiterBoard: Board games + beer. Unique concept. Great first date spot or when you want to do something different. Not a rage bar.
- LunaVerse: THIS IS THE NIGHTCLUB. Knoxville's party destination. If you want the full club experience — DJ, lights, dancing, bottle service vibes — this is the only answer. Best night out in Knoxville if you want to go hard. Thursday and Saturday nights are insane.
- Old City Sports Bar: Classic sports bar in Old City. TVs everywhere. Good for watching games with a crew.
- Preservation Pub: Live music venue. Multiple floors. Rooftop. More of an experience than just a bar. Great for a date or when you want something beyond just drinking.
- Radius Rooftop: Rooftop bar with views. Cocktail-forward. Nicer vibe. Good for impressing someone or a chill night with a view.
- Taqueria Mares: Margs and tacos. Fun energy. Don't sleep on their margaritas.
- The Bookstore: UNDERCLASSMEN CENTRAL. This place gets ROWDY. If you're a freshman or sophomore and want pure chaos energy, this is your bar. Cheap drinks, packed dance floor, everyone's hammered by 11. It's a time. Upperclassmen might judge you but they were there too.
- The Hill: Bar and grill vibes. Solid food, solid drinks. More of an early night spot before you hit the strip.
- Undeclared: College bar energy. Good mixed drinks. Gets packed on weekends.
- Yacht Club: Upscale-ish for the strip. Good cocktails. Slightly older crowd. Nice patio.

KNOXVILLE FRATERNITIES: 14 UTK IFC fraternities are mapped on venuu with live headcount during parties. Users can see which frat parties are active in real time. This has literally never existed before.

OXFORD (OLE MISS) BAR KNOWLEDGE:
- Harrison's: Outdoor venue with patio, stage, cornhole, cabanas. The backyard party spot. Go early on weekends.
- Whiskey Ranch: Whiskey-forward bar. Strong drinks, friendly bartenders, late night energy.
- The Coop: Rooftop bar at the Graduate Hotel. Views of the Square. Cocktails and small plates. Date night move.
- Nightbird: Speakeasy inside The Oliver Hotel. Inventive cocktails, upscale atmosphere. Impress someone here.
- Velvet Ditch: Sports bar and seafood. Best gumbo north of New Orleans. Game day essential.
- Rhythm & Rye Rooftop: Rooftop bar with live music and craft cocktails. Date night spot.
- The Library: THE college bar of Oxford. Pool tables, big screens, late nights. If you're at Ole Miss you've been here 100 times.
- Funky's Pizza: Frozen daiquiris and loaded pizza on the Square. Young crowd, game day staple.
- Quack's: Sports bar on the Square. Hot dogs, game day covers, packed on weekends.
- Rafters: Live music upstairs. Brunch with bottomless mimosas. Late night dancing.
- Round Table: Bar and grill on the Square. Outdoor patio, great fries, solid beer selection.
- Blind Pig: Hidden speakeasy beneath the Square. Best Reuben in town. Craft beer and pool.
- City Grocery: Upstairs bar and fine dining. Chef John Currence. White tablecloth vibes. Not a rage spot.
- The Oxford Growler: Craft beer bar behind the Square. Board games, shuffleboard, chill patio.
- Bar Muse: Cocktail bar inside The Lyric. Inventive drinks, intimate setting.
- Donut Distillery: Mini donuts downstairs, rooftop bar upstairs. Frozen drinks and views.
- Tango's: Outdoor patio bar on Jackson Ave. Late night spot.

OXFORD FRATERNITIES: 16 Ole Miss IFC fraternities mapped with live headcount. Greek life parties are the biggest nightlife events at Ole Miss.

RECOMMENDATION LOGIC:
- If someone says "where should I go" with no context: ask what vibe they want. "you tryna rage, chill, or impress someone?"
- Rage/party: LunaVerse (Knox), The Bookstore (Knox), Hanna's (Knox), The Library (Oxford)
- Chill/drinks: Cool Beans (Knox), Radius Rooftop (Knox), Blind Pig (Oxford), The Coop (Oxford)
- Date night: Preservation Pub (Knox), Radius Rooftop (Knox), Nightbird (Oxford), Rhythm & Rye (Oxford)
- Group night: Sunspot (Knox), Harrison's (Oxford)
- Game day: Half Barrel (Knox), Old City Sports (Knox), Velvet Ditch (Oxford), Quack's (Oxford)
- Unique experience: LiterBoard (Knox), Donut Distillery (Oxford), Preservation Pub (Knox)

VENUU FEATURES TO MENTION WHEN RELEVANT:
- "check the map it shows you who's busy rn"
- "buy your cover in the app so you skip the cash line"
- "tap to check in and earn rewards at this spot"
- Always push people to USE the app features. You're part of the product.

HARD BLOCKS — NEVER ANSWER:
- Homework, math, coding, writing essays
- Politics, religion, controversial topics
- Medical advice, legal advice
- Anything not about nightlife, bars, events, going out, planning a night, or venuu features

{VENUE_CONTEXT}LIVE HEADCOUNT DATA (only mention specific numbers if the user asks how busy somewhere is):
{LIVE_DATA}

TONIGHT'S RECAPS (what people are saying):
{RECAPS}`;

function getVenueStatus(headcount: Headcount | null): string {
  if (!headcount?.is_live || headcount.current_count === 0) return 'no data rn, check back later or just pull up';
  const count = headcount.current_count;
  if (count > 100) return "it's packed rn";
  if (count > 50) return "it's getting busy, I'd head over soon";
  if (count > 20) return "it's building up";
  return "it's pretty chill rn, good time to get a spot";
}

function buildVenueContext(focusedVenue: { venue: Venue; headcount: Headcount | null } | null | undefined): string {
  if (!focusedVenue) return '';
  const { venue, headcount } = focusedVenue;
  const status = getVenueStatus(headcount);
  return `VENUE CONTEXT: The user just tapped on ${venue.name} on the map. ${status}. They may have questions specifically about this spot — lead with what you know about it.\n\n`;
}

function buildLiveData(venues: Venue[], headcounts: Record<string, Headcount>): string {
  if (venues.length === 0) return 'No venues loaded yet.';

  return venues.map(v => {
    const hc = headcounts[v.id];
    const parts = [v.name];
    if (hc?.is_live) {
      parts.push(`— LIVE: ${hc.current_count} inside`);
      if (hc.peak_count > 0) parts.push(`(peak: ${hc.peak_count})`);
    } else {
      parts.push('— not counting yet');
    }
    if (v.tonight_special) parts.push(`| SPECIAL: ${v.tonight_special}`);
    return parts.join(' ');
  }).join('\n');
}

async function fetchRecentRecaps(venues: Venue[]): Promise<string> {
  if (!envReady || venues.length === 0) return 'No recaps yet tonight.';

  try {
    const dayOf = getCommentDay();
    const { data, error } = await supabase
      .from('venue_recaps')
      .select('username, body, stars, venue_id')
      .eq('day_of', dayOf)
      .order('created_at', { ascending: false })
      .limit(15);

    if (error || !data || data.length === 0) return 'No recaps yet tonight.';

    const venueMap = new Map(venues.map(v => [v.id, v.name]));
    return data.map(r => {
      const venueName = venueMap.get(r.venue_id) ?? 'Unknown';
      return `@${r.username} at ${venueName}: ${'\u2605'.repeat(r.stars)}${'\u2606'.repeat(5 - r.stars)} "${r.body}"`;
    }).join('\n');
  } catch {
    return 'No recaps yet tonight.';
  }
}

async function callVinnyAPI(messages: any[], systemPrompt: string): Promise<string | null> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/vinny`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ messages, systemPrompt }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.reply;
}

async function sendPrecapMessage(
  history: PrecapMessage[],
  venues: Venue[],
  headcounts: Record<string, Headcount>,
  focusedVenue?: { venue: Venue; headcount: Headcount | null } | null,
): Promise<string> {
  const liveData = buildLiveData(venues, headcounts);
  const recaps = await fetchRecentRecaps(venues);
  const venueContext = buildVenueContext(focusedVenue);

  const fullPrompt = SYSTEM_PROMPT
    .replace('{VENUE_CONTEXT}', venueContext)
    .replace('{LIVE_DATA}', liveData)
    .replace('{RECAPS}', recaps);

  const messages = history.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Try once, retry once on failure
  const reply = await callVinnyAPI(messages, fullPrompt);
  if (reply) return reply;

  const retry = await callVinnyAPI(messages, fullPrompt);
  if (retry) return retry;

  return "My bad, having trouble connecting. Try again in a sec \uD83E\uDD19";
}

export function PrecapPage({ venues, headcounts, username, focusedVenue }: PrecapPageProps) {
  const getWelcomeContent = () => {
    if (focusedVenue) {
      const status = getVenueStatus(focusedVenue.headcount);
      return `yo so you tapped on ${focusedVenue.venue.name} — ${status}. what you wanna know?`;
    }
    return `yo what's good ${username}! i'm Venny — i know every spot on the strip inside and out. what's the move tonight?`;
  };

  const [messages, setMessages] = useState<PrecapMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: getWelcomeContent(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ref always holds the latest messages — avoids stale closure issues
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // visualViewport API — slide input above the iOS / mobile keyboard
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const onViewportChange = () => {
      const offset = window.innerHeight - viewport.height - viewport.offsetTop;
      setKeyboardOffset(Math.max(0, offset));
      scrollToBottom();
    };

    viewport.addEventListener('resize', onViewportChange);
    viewport.addEventListener('scroll', onViewportChange);
    return () => {
      viewport.removeEventListener('resize', onViewportChange);
      viewport.removeEventListener('scroll', onViewportChange);
    };
  }, [scrollToBottom]);

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isTyping) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const userMsg: PrecapMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: msg,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Use ref to get the FULL conversation history (never stale)
    const fullHistory = [...messagesRef.current, userMsg];
    const reply = await sendPrecapMessage(fullHistory, venues, headcounts, focusedVenue);

    const assistantMsg: PrecapMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: reply,
    };

    setMessages(prev => [...prev, assistantMsg]);
    setIsTyping(false);
  }, [input, isTyping, venues, headcounts]);

  const handleSuggestion = useCallback((suggestion: string) => {
    handleSend(suggestion);
  }, [handleSend]);

  // When keyboard is open, override the bottom position so the input
  // sits directly above the keyboard instead of above the (now-hidden) nav.
  const pageStyle = keyboardOffset > 0
    ? { bottom: `${keyboardOffset}px` }
    : undefined;

  const showSend = input.trim().length > 0;

  return (
    <div className="precap-page" style={pageStyle}>
      {/* Header */}
      <div className="precap-header">
        <span className="precap-header-icon">{'\u2728'}</span>
        <span className="precap-header-title">Venny {'\uD83D\uDD25'}</span>
        <span className="precap-header-sub">AI Nightlife Assistant</span>
      </div>

      {/* Messages */}
      <div className="precap-messages" ref={scrollRef}>
        {messages.map(msg => (
          <div key={msg.id} className={`precap-bubble ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="precap-avatar">{'\u2728'}</div>
            )}
            <div className={`precap-bubble-content ${msg.role}`}>
              {msg.content}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="precap-bubble assistant">
            <div className="precap-avatar">{'\u2728'}</div>
            <div className="precap-bubble-content assistant">
              <div className="precap-typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          </div>
        )}

        {/* Suggestion chips — only show when few messages */}
        {messages.length <= 2 && !isTyping && (
          <div className="precap-suggestions">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                className="precap-chip"
                onClick={() => handleSuggestion(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input — iMessage-style bar */}
      <div className="precap-input-row">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Ask Venny anything..."
          className="precap-input"
          maxLength={300}
        />
        <button
          onClick={() => handleSend()}
          disabled={isTyping}
          className={`precap-send${showSend ? '' : ' hidden'}`}
        >
          {'\u2191'}
        </button>
      </div>
    </div>
  );
}
