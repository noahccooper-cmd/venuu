import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, Footprints, MapPin, Moon, Search, Store, Users, X } from 'lucide-react';
import { hapticLight, hapticSelection, hapticWarning } from '../../lib/haptics';
import type { CityKey } from '../../lib/constants';
import type { SocialCategory, SocialEvent } from '../../lib/socialTypes';
import { brandColor, type Brand } from '../../lib/brands';
import { SOCIAL_CITY_LABEL } from '../../lib/socialTheme';
import {
  DESCRIPTION_MAX, POST_ERROR_COPY, TITLE_MAX, checkDraft, cityFor, searchPlaces,
  type PostDraft, type PostErrorCode, type PostPlace, type PostResult,
} from '../../lib/socialPost';
import { prefersReducedMotion } from '../../lib/socialGeo';
import type { GoingState } from '../../hooks/useGoing';
import { FeedCard } from './SocialFeed';

const FONT = 'Satoshi, sans-serif';
const TEXT = 13;

type Step = 'terms' | 'what' | 'when' | 'where' | 'look';
const STEPS: Step[] = ['what', 'when', 'where', 'look'];
const STEP_TITLE: Record<Step, string> = {
  terms: 'Before your first post',
  what: 'What’s happening?',
  when: 'When is it?',
  where: 'Where is it?',
  look: 'How it will look',
};

const CATEGORIES: { value: SocialCategory; label: string; Icon: typeof Moon }[] = [
  { value: 'run_club', label: 'Run Club', Icon: Footprints },
  { value: 'pop_up', label: 'Pop-Up', Icon: Store },
  { value: 'nightlife', label: 'Nightlife', Icon: Moon },
  { value: 'other', label: 'Other', Icon: Users },
];
const DURATIONS = [1, 2, 3, 4];

function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateInput(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** Space the on-screen keyboard takes (visualViewport); 0 on web without one. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const read = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener('resize', read);
    vv.addEventListener('scroll', read);
    return () => { vv.removeEventListener('resize', read); vv.removeEventListener('scroll', read); };
  }, []);
  return inset;
}

const label: React.CSSProperties = { fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)' };
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 52, padding: '0 16px', borderRadius: 14,
  background: 'var(--social-surface)', border: '1px solid var(--social-hairline)', color: 'var(--text-primary)',
  fontFamily: FONT, fontSize: 17, fontWeight: 700, outline: 'none',
};

function Toggle({ on, onChange, title, sub }: { on: boolean; onChange: (v: boolean) => void; title: string; sub: string }) {
  return (
    <button
      className="social-press"
      role="switch"
      aria-checked={on}
      onClick={() => { hapticSelection(); onChange(!on); }}
      style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '0 16px', borderRadius: 14, cursor: 'pointer', textAlign: 'left', background: 'var(--social-surface)', border: `1px solid ${on ? 'var(--text-primary)' : 'var(--social-hairline)'}` }}
    >
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-secondary)' }}>{sub}</span>
      </span>
      <span aria-hidden style={{ width: 44, height: 26, borderRadius: 13, background: on ? 'var(--text-primary)' : 'var(--social-surface-raised)', position: 'relative', transition: 'background-color 200ms ease-out' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 10, background: on ? '#0B0A09' : 'var(--text-secondary)', transition: 'left 220ms cubic-bezier(0.34, 1.36, 0.64, 1)' }} />
      </span>
    </button>
  );
}

const PREVIEW_GOING: GoingState = { count: () => 0, isGoing: () => false, faces: () => [], toggle: async () => true };

interface PostFlowProps {
  open: boolean;
  topInset: number;
  /** Hosts/admins: Date TBA, weekly repeats, partner. */
  canHost: boolean;
  isAdmin: boolean;
  termsAccepted: boolean;
  hostName: string;
  brands: Brand[];
  defaultCity: CityKey;
  /** Map tap fallback for Where: the sheet steps aside while picking. */
  picking: boolean;
  droppedPin: [number, number] | null;
  onPickOnMap: () => void;
  colorOf: (ev: SocialEvent) => string;
  onAcceptTerms: () => Promise<boolean>;
  onSubmit: (d: PostDraft) => Promise<PostResult>;
  onClose: () => void;
}

/**
 * Post an event, one question per screen: What → When → Where → Look
 * (Look shows the exact feed card). First post adds the posting rules.
 */
export function PostFlow(p: PostFlowProps) {
  const reduced = prefersReducedMotion();
  const kb = useKeyboardInset();
  const [step, setStep] = useState<Step>(p.termsAccepted ? 'what' : 'terms');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<SocialCategory>('pop_up');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [time, setTime] = useState('19:00');
  const [hours, setHours] = useState(2);
  const [dateTba, setDateTba] = useState(false);
  const [repeats, setRepeats] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PostPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [place, setPlace] = useState<PostPlace | null>(null);
  const [brandSlug, setBrandSlug] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<PostErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const resetOnOpen = useRef(false);
  useEffect(() => {
    if (!p.open || !resetOnOpen.current) return;
    resetOnOpen.current = false;
    setTitle(''); setDescription(''); setPlace(null); setQuery(''); setPhoto(null); setPhotoUrl(null); setBrandSlug(null);
    setRepeats(false); setDateTba(false); setError(null); setStep(p.termsAccepted ? 'what' : 'terms');
  }, [p.open, p.termsAccepted]);

  useEffect(() => { if (p.open) setStep(s => (s === 'terms' && p.termsAccepted ? 'what' : s)); }, [p.open, p.termsAccepted]);

  // A pin dropped on the map becomes the place.
  useEffect(() => {
    if (!p.droppedPin) return;
    const [lng, lat] = p.droppedPin;
    setPlace({ name: 'Dropped pin', address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, city: cityFor(lng, lat) });
    setError(cityFor(lng, lat) ? null : 'unsupported_city');
  }, [p.droppedPin]);

  // Debounced place search.
  useEffect(() => {
    if (step !== 'where' || query.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    const t = window.setTimeout(async () => {
      try { setResults(await searchPlaces(query, place?.city ?? p.defaultCity)); } catch { setResults([]); }
      setSearching(false);
    }, 280);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, step]);

  const start = useMemo(() => {
    const [y, mo, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    return y && mo && d ? new Date(y, mo - 1, d, hh || 0, mm || 0) : null;
  }, [date, time]);

  const draft: PostDraft = {
    title, category, description, dateTba, start, hours, repeatsWeekly: repeats, place, brandSlug, photo, photoPreview: photoUrl,
  };

  const preview: SocialEvent = {
    id: 'preview', city: place?.city ?? p.defaultCity, surface: 'social', category, brand: brandSlug,
    title: title.trim() || 'Your event', host_name: p.hostName, external_venue_name: place?.name ?? 'Your spot',
    address: place?.address ?? '', latitude: place?.lat ?? 0, longitude: place?.lng ?? 0,
    start_time: (start ?? new Date()).toISOString(), end_time: null, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    series_id: null, description, date_tba: dateTba, photo_url: photoUrl, verification: p.isAdmin ? 'verified' : 'community',
  };

  const stepValid: Record<Step, boolean> = {
    terms: true,
    what: title.trim().length >= 3,
    when: dateTba || !!start,
    where: !!place?.city,
    look: true,
  };

  const fail = (code: PostErrorCode) => { setError(code); hapticWarning(); };

  const next = async () => {
    setError(null);
    if (step === 'terms') {
      setBusy(true);
      const ok = await p.onAcceptTerms();
      setBusy(false);
      if (ok) { hapticSelection(); setStep('what'); } else fail('network');
      return;
    }
    // Check what this step owns before moving on.
    const code = checkDraft(draft, p.canHost);
    const owns: Record<Step, PostErrorCode[]> = {
      terms: [], what: ['objectionable_content', 'too_long'], when: ['in_past', 'date_tba_hosts_only'],
      where: ['unsupported_city'], look: ['partner_fields_hosts_only'],
    };
    if (code && (owns[step].includes(code) || step === 'look')) { fail(code); return; }
    if (step !== 'look') { hapticSelection(); setStep(STEPS[STEPS.indexOf(step) + 1]); return; }
    setBusy(true);
    const r = await p.onSubmit(draft);
    setBusy(false);
    if (!r.ok) {
      fail(r.code);
      // Send them to the step that can fix it.
      if (r.code === 'unsupported_city') setStep('where');
      if (r.code === 'objectionable_content' || r.code === 'too_long') setStep('what');
      if (r.code === 'in_past' || r.code === 'date_tba_hosts_only') setStep('when');
      if (r.code === 'terms_required') setStep('terms');
      return;
    }
    // Success: the page closes the sheet and celebrates; the form resets
    // the next time it opens (not while it's sliding away).
    resetOnOpen.current = true;
  };
  const back = () => { setError(null); hapticLight(); setStep(STEPS[Math.max(0, STEPS.indexOf(step) - 1)]); };

  const shown = p.open && !p.picking;
  const stepIndex = STEPS.indexOf(step);

  return (
    <>
      <div
        onClick={p.onClose}
        style={{ position: 'absolute', inset: 0, zIndex: 24, background: 'rgba(0,0,0,0.55)', opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none', transition: reduced ? 'none' : 'opacity 220ms ease-out' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Post an event"
        aria-hidden={!shown}
        style={{
          position: 'absolute', zIndex: 25, left: 0, right: 0, top: p.topInset + 8, bottom: 0,
          display: 'flex', flexDirection: 'column', background: 'var(--social-bg)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: '1px solid var(--social-hairline)',
          transform: shown ? 'translateY(0)' : 'translateY(105%)',
          transition: reduced ? 'none' : 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Header: back · progress · close */}
        <div style={{ flexShrink: 0, padding: '6px 6px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="social-press" aria-label="Back" onClick={back} disabled={stepIndex <= 0} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer', opacity: stepIndex <= 0 ? 0 : 1 }}>
            <ChevronLeft size={22} color="var(--text-secondary)" />
          </button>
          <div aria-label={step === 'terms' ? 'Posting rules' : `Step ${stepIndex + 1} of 4`} style={{ flex: 1, display: 'flex', gap: 6 }}>
            {STEPS.map((s, i) => (
              <span key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= stepIndex ? 'var(--text-primary)' : 'var(--social-surface-raised)', transition: 'background-color 250ms ease-out' }} />
            ))}
          </div>
          <button className="social-press" aria-label="Close" onClick={() => { hapticLight(); p.onClose(); }} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={20} color="var(--text-secondary)" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontFamily: FONT, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{STEP_TITLE[step]}</h2>

          {error && (
            <div role="alert" style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(229,72,77,0.12)', border: '1px solid rgba(229,72,77,0.5)', fontFamily: FONT, fontSize: TEXT, fontWeight: 600, lineHeight: 1.45, color: 'var(--text-primary)' }}>
              {POST_ERROR_COPY[error]}
            </div>
          )}

          {step === 'terms' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: FONT, fontSize: 15, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              <p style={{ margin: 0 }}>Your event goes live right away for everyone, labeled <b style={{ color: 'var(--text-primary)' }}>Community</b>. Venuu may verify it or remove it.</p>
              <p style={{ margin: 0 }}>No objectionable content: no hate, harassment, sexual content, violence, or anything illegal. There’s zero tolerance — posts are removed and posters are banned.</p>
              <p style={{ margin: 0 }}>Anyone can report an event. You can delete your own posts any time.</p>
            </div>
          )}

          {step === 'what' && (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={label}>Title</span>
                <input autoFocus value={title} maxLength={TITLE_MAX} onChange={e => setTitle(e.target.value)} placeholder="Sunday Book Swap" style={input} enterKeyHint="next" />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={label}>Kind of event</span>
                <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {CATEGORIES.map(({ value, label: l, Icon }) => {
                    const on = value === category;
                    return (
                      <button key={value} role="radio" aria-checked={on} className="social-press" onClick={() => { hapticSelection(); setCategory(value); }}
                        style={{ minHeight: 64, borderRadius: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: on ? 'var(--text-primary)' : 'var(--social-surface)', color: on ? '#0B0A09' : 'var(--text-primary)', border: `1px solid ${on ? 'var(--text-primary)' : 'var(--social-hairline)'}`, fontFamily: FONT, fontSize: 15, fontWeight: 800 }}>
                        <Icon size={20} strokeWidth={2} /> {l}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ ...label, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Description · optional</span>
                  <span className="social-num" style={{ color: description.length > DESCRIPTION_MAX ? '#E5484D' : 'var(--text-muted)' }}>{description.length}/{DESCRIPTION_MAX}</span>
                </span>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="One or two lines people should know"
                  style={{ ...input, minHeight: 96, padding: 14, fontSize: 15, fontWeight: 500, resize: 'none' }} />
              </label>
            </>
          )}

          {step === 'when' && (
            <>
              {!dateTba && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={label}>Date</span>
                    <input type="date" value={date} min={toDateInput(new Date())} onChange={e => setDate(e.target.value)} style={input} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={label}>Starts</span>
                    <input type="time" value={time} onChange={e => setTime(e.target.value)} style={input} />
                  </label>
                </div>
              )}
              {!dateTba && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={label}>How long</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {DURATIONS.map(h => (
                      <button key={h} className="social-press" aria-pressed={h === hours} onClick={() => { hapticSelection(); setHours(h); }}
                        style={{ flex: 1, minHeight: 48, borderRadius: 12, cursor: 'pointer', background: h === hours ? 'var(--text-primary)' : 'var(--social-surface)', color: h === hours ? '#0B0A09' : 'var(--text-primary)', border: '1px solid var(--social-hairline)', fontFamily: FONT, fontSize: 15, fontWeight: 800 }}>
                        {h}h
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {p.canHost && <Toggle on={dateTba} onChange={setDateTba} title="Date TBA" sub="Shows “Date TBA” until you set it (hosts)" />}
              {p.canHost && !dateTba && <Toggle on={repeats} onChange={setRepeats} title="Repeats weekly" sub="Posts the next 8 weeks (hosts)" />}
            </>
          )}

          {step === 'where' && (
            <>
              <div style={{ position: 'relative' }}>
                <Search size={18} color="var(--text-secondary)" style={{ position: 'absolute', left: 14, top: 17 }} />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a place or address" style={{ ...input, paddingLeft: 42 }} enterKeyHint="search" />
              </div>
              {searching && <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>Searching…</span>}
              {results && !searching && results.length === 0 && <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>No places found. Try another name, or drop a pin.</span>}
              {results && results.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 14, border: '1px solid var(--social-hairline)', overflow: 'hidden' }}>
                  {results.map(r => (
                    <button key={`${r.lng},${r.lat}`} className="social-press" onClick={() => { hapticSelection(); setPlace(r); setResults(null); setQuery(r.name); setError(r.city ? null : 'unsupported_city'); }}
                      style={{ minHeight: 56, padding: '8px 14px', textAlign: 'left', cursor: 'pointer', background: 'var(--social-surface)', border: 'none', borderBottom: '1px solid var(--social-hairline)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{r.name}</span>
                      <span style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-secondary)' }}>{r.city ? r.address : `${r.address} · outside Social cities`}</span>
                    </button>
                  ))}
                </div>
              )}
              <button className="social-press" onClick={() => { hapticLight(); p.onPickOnMap(); }}
                style={{ minHeight: 52, borderRadius: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'transparent', border: '1px dashed var(--social-hairline)', fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                <MapPin size={18} /> Drop a pin on the map instead
              </button>
              {place && (
                <div style={{ padding: 14, borderRadius: 14, background: 'var(--social-surface)', border: `1px solid ${place.city ? 'var(--text-primary)' : 'rgba(229,72,77,0.6)'}`, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ ...label, color: place.city ? 'var(--text-secondary)' : '#E5484D' }}>{place.city ? SOCIAL_CITY_LABEL[place.city] : 'Outside Social cities'}</span>
                  <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{place.name}</span>
                  <span style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-secondary)' }}>{place.address}</span>
                </div>
              )}
            </>
          )}

          {step === 'look' && (
            <>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="social-press" onClick={() => fileRef.current?.click()}
                  style={{ flex: 1, minHeight: 52, borderRadius: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--social-surface)', border: '1px solid var(--social-hairline)', fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                  <Camera size={18} /> {photo ? 'Change photo' : 'Add a photo · optional'}
                </button>
                {photo && (
                  <button className="social-press" onClick={() => { setPhoto(null); setPhotoUrl(null); }}
                    style={{ minHeight: 52, padding: '0 14px', borderRadius: 14, cursor: 'pointer', background: 'transparent', border: '1px solid var(--social-hairline)', fontFamily: FONT, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                    Remove
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic" hidden
                  onChange={e => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 5 * 1024 * 1024) { fail('unknown'); return; }
                    setPhoto(f);
                    setPhotoUrl(f ? URL.createObjectURL(f) : null);
                  }} />
              </div>
              {p.canHost && p.brands.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={label}>Partner · hosts</span>
                  <div className="social-carousel" style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
                    {[null, ...p.brands].map(b => {
                      const on = (b?.slug ?? null) === brandSlug;
                      return (
                        <button key={b?.slug ?? 'none'} className="social-press" aria-pressed={on} onClick={() => { hapticSelection(); setBrandSlug(b?.slug ?? null); }}
                          style={{ flexShrink: 0, minHeight: 44, padding: '0 14px', borderRadius: 22, cursor: 'pointer', background: on ? (b ? brandColor(b) : 'var(--text-primary)') : 'var(--social-surface)', color: on ? '#0B0A09' : 'var(--text-primary)', border: '1px solid var(--social-hairline)', fontFamily: FONT, fontSize: 13, fontWeight: 800 }}>
                          {b?.name ?? 'None'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <span style={label}>Preview</span>
              <div style={{ height: 460, flexShrink: 0, borderRadius: 18, overflow: 'hidden', border: '1px solid var(--social-hairline)', background: '#0B0A09' }}>
                <FeedCard
                  event={preview}
                  brand={brandSlug ? p.brands.find(b => b.slug === brandSlug) ?? null : null}
                  color={p.colorOf(preview)}
                  going={PREVIEW_GOING}
                  live={false}
                  fresh
                  eager
                  reduced={reduced}
                  onGoing={async () => true}
                  onOpen={() => {}}
                  preview
                />
              </div>
            </>
          )}
        </div>

        {/* Primary action, kept above the keyboard */}
        <div style={{ flexShrink: 0, padding: '12px 20px', paddingBottom: 12 + kb, borderTop: '1px solid var(--social-hairline)', background: 'var(--social-bg)' }}>
          <button
            className="social-press"
            disabled={!stepValid[step] || busy}
            onClick={() => void next()}
            style={{
              width: '100%', height: 52, borderRadius: 14, border: 'none', cursor: stepValid[step] && !busy ? 'pointer' : 'default',
              background: stepValid[step] ? 'var(--text-primary)' : 'var(--social-surface-raised)', color: stepValid[step] ? '#0B0A09' : 'var(--text-muted)',
              fontFamily: FONT, fontSize: 16, fontWeight: 800,
            }}
          >
            {busy ? (step === 'terms' ? 'Saving…' : 'Posting…') : step === 'terms' ? 'I agree' : step === 'look' ? 'Post event' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}
