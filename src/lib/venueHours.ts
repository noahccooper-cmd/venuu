// venueHours.ts — real-time open/close engine for venuu.
// Reads venues.hours_json. Handles after-midnight correctly: a bar open
// "Fri 6 PM–3 AM" is still OPEN at 1 AM Saturday (checks prior-day spillover).

export type Interval = [string, string];
export type HoursJson =
  | { event_based: true }
  | Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", Interval[]>>
  | null
  | undefined;

export type VenueStatus = {
  open: boolean;
  status: "open" | "closed" | "varies" | "unknown";
  label: string;
  detail: string;
  closesAtMin?: number;
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DEFAULT_TZ = "America/New_York";

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

function nowParts(now: Date, timeZone: string): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wk: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const dow = wk[get("weekday")] ?? 0;
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0;
  const minutes = hh * 60 + parseInt(get("minute"), 10);
  return { dow, minutes };
}

function dayIntervals(h: Exclude<HoursJson, { event_based: true } | null | undefined>, dow: number): Interval[] {
  return (h as Record<string, Interval[]>)[DAYS[dow]] ?? [];
}

function fmtTime(min: number): string {
  let m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return mm === 0 ? `${h12} ${ampm}` : `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function getVenueStatus(
  hours: HoursJson,
  opts: { now?: Date; timeZone?: string } = {}
): VenueStatus {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone ?? DEFAULT_TZ;

  if (!hours) return { open: false, status: "unknown", label: "Hours unavailable", detail: "" };
  if ((hours as any).event_based)
    return { open: false, status: "varies", label: "Hours vary", detail: "by event" };

  const h = hours as Exclude<HoursJson, { event_based: true } | null | undefined>;
  const { dow, minutes } = nowParts(now, tz);

  for (const [oS, cS] of dayIntervals(h, dow)) {
    const o = toMin(oS), c = toMin(cS);
    if (c > o) {
      if (o <= minutes && minutes < c)
        return { open: true, status: "open", label: "Open", detail: `closes ${fmtTime(c)}`, closesAtMin: c };
    } else {
      if (minutes >= o)
        return { open: true, status: "open", label: "Open", detail: `closes ${fmtTime(c)}`, closesAtMin: c };
    }
  }
  for (const [oS, cS] of dayIntervals(h, (dow + 6) % 7)) {
    const o = toMin(oS), c = toMin(cS);
    if (c <= o && minutes < c)
      return { open: true, status: "open", label: "Open", detail: `closes ${fmtTime(c)}`, closesAtMin: c };
  }

  for (let d = 0; d < 8; d++) {
    const checkDow = (dow + d) % 7;
    const ivs = [...dayIntervals(h, checkDow)].sort((a, b) => toMin(a[0]) - toMin(b[0]));
    for (const [oS] of ivs) {
      const o = toMin(oS);
      if (d === 0 && o <= minutes) continue;
      const when = d === 0 ? `opens ${fmtTime(o)}` : `opens ${DAY_LABEL[checkDow]} ${fmtTime(o)}`;
      return { open: false, status: "closed", label: "Closed", detail: when };
    }
  }
  return { open: false, status: "closed", label: "Closed", detail: "" };
}

export function isOpenNow(hours: HoursJson, opts?: { now?: Date; timeZone?: string }): boolean {
  return getVenueStatus(hours, opts).open;
}
