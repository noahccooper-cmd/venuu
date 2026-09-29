import { useState } from 'react';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import type { CityKey } from '../../lib/constants';
import type { SocialTheme } from '../../lib/socialTheme';
import type { SocialCategory, SocialEvent } from '../../lib/socialTypes';
import { addDemoEvents, resetDemoEvents } from '../../lib/socialDemoStore';
import { prefersReducedMotion } from '../../lib/socialGeo';

const FONT = 'Satoshi, sans-serif';
const TEXT = 13;
const WEEKLY_OCCURRENCES = 8;
const DEFAULT_HOURS = 2;

const CATEGORIES: { value: SocialCategory; label: string }[] = [
  { value: 'run_club', label: 'Run Club' },
  { value: 'pop_up', label: 'Pop-Up' },
  { value: 'nightlife', label: 'Nightlife' },
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface HostSheetProps {
  theme: SocialTheme;
  city: CityKey;
  open: boolean;
  /** Sheet steps aside while the host taps the map. */
  picking: boolean;
  draftPin: [number, number] | null;
  onPickLocation: () => void;
  onClose: () => void;
  /** First created event id — the city screen glows it once it appears. */
  onPosted: (firstId: string) => void;
}

/** Host mode · demo — a local-only event composer. Posts go to
 *  localStorage (see socialDemoStore); nothing touches Supabase. */
export function HostSheet({ theme, city, open, picking, draftPin, onPickLocation, onClose, onPosted }: HostSheetProps) {
  const reduced = prefersReducedMotion();
  const brandOptions = [
    { value: null as string | null, label: 'None' },
    ...theme.partners.filter(p => p.match.brand).map(p => ({ value: p.match.brand as string | null, label: p.label })),
  ];

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<SocialCategory>('pop_up');
  const [brand, setBrand] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO);
  const [time, setTime] = useState('19:00');
  const [repeats, setRepeats] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canPost = title.trim().length > 0 && !!date && !!time && !!draftPin;

  const post = () => {
    if (!canPost || !draftPin) return;
    const [y, mo, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    // Calendar-day arithmetic (not +7×24h) keeps the time right across DST.
    const firstStart = new Date(y, mo - 1, d, hh, mm);
    if (firstStart.getTime() + DEFAULT_HOURS * 3_600_000 <= Date.now()) {
      setError('Pick a time later than now.');
      return;
    }
    const stamp = Date.now();
    const seriesId = repeats ? `demo-host-series-${stamp}` : null;
    const [lng, lat] = draftPin;
    const events: SocialEvent[] = Array.from({ length: repeats ? WEEKLY_OCCURRENCES : 1 }, (_, i) => {
      const start = new Date(y, mo - 1, d + i * 7, hh, mm);
      const end = new Date(start.getTime() + DEFAULT_HOURS * 3_600_000);
      return {
        id: `demo-host-${stamp}-${i}`,
        city,
        surface: 'social',
        category,
        brand,
        title: title.trim(),
        host_name: 'Venuu (demo host)',
        external_venue_name: 'Pinned location',
        description: description.trim() || null,
        address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        latitude: lat,
        longitude: lng,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        expires_at: end.toISOString(),
        series_id: seriesId,
      };
    });
    addDemoEvents(events);
    hapticSuccess();
    setTitle('');
    setDescription('');
    setRepeats(false);
    setError(null);
    onPosted(events[0].id);
  };

  const shown = open && !picking;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
          opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none',
          transition: reduced ? 'none' : 'opacity 250ms ease-out', zIndex: 5,
        }}
      />
      <div
        role="dialog"
        aria-label="Host mode demo"
        aria-hidden={!shown}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', overflowY: 'auto',
          background: 'var(--social-bg)', borderTop: '1px solid var(--social-hairline)', borderRadius: '16px 16px 0 0',
          padding: '16px 16px 24px', zIndex: 6,
          transform: shown ? 'translateY(0)' : 'translateY(105%)',
          transition: reduced ? 'none' : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="social-label" style={{ fontFamily: FONT, color: 'var(--text-secondary)' }}>Host mode · demo</span>
          <button className="social-press" onClick={() => { hapticLight(); onClose(); }} style={linkStyle}>Close</button>
        </div>

        <Field label="Title">
          <input value={title} onChange={e => setTitle(e.target.value.slice(0, 80))} placeholder="Event title" style={inputStyle} />
        </Field>

        <Field label="Category">
          <Segmented options={CATEGORIES} value={category} onChange={setCategory} />
        </Field>

        {brandOptions.length > 1 && (
          <Field label="Brand">
            <Segmented options={brandOptions} value={brand} onChange={setBrand} />
          </Field>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Field label="Date" grow>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Time" grow>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputStyle} />
          </Field>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT, fontSize: TEXT, color: 'var(--text-primary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={repeats} onChange={e => setRepeats(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#FFFFFF' }} />
          Repeats weekly <span style={{ color: 'var(--text-secondary)' }}>· next {WEEKLY_OCCURRENCES}</span>
        </label>

        <Field label="Location">
          <button
            className="social-press"
            onClick={() => { hapticLight(); onPickLocation(); }}
            style={{ ...inputStyle, textAlign: 'left', cursor: 'pointer', color: draftPin ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            {draftPin
              ? <span className="social-num">Pin dropped · {draftPin[1].toFixed(4)}, {draftPin[0].toFixed(4)} — tap to move</span>
              : 'Tap the map to drop a pin'}
          </button>
        </Field>

        <Field label="Description (optional)">
          <input value={description} onChange={e => setDescription(e.target.value.slice(0, 80))} placeholder="One line" style={inputStyle} />
        </Field>

        {error && <span style={{ fontFamily: FONT, fontSize: TEXT, color: '#E5484D' }}>{error}</span>}

        <button
          className="social-press"
          disabled={!canPost}
          onClick={post}
          style={{
            height: 48, borderRadius: 12, cursor: canPost ? 'pointer' : 'default',
            background: canPost ? 'var(--text-primary)' : 'transparent',
            color: canPost ? '#0B0A09' : 'var(--text-muted)',
            border: `1px solid ${canPost ? 'var(--text-primary)' : 'var(--social-hairline)'}`,
            fontFamily: FONT, fontSize: 15, fontWeight: 800,
          }}
        >
          Post
        </button>

        <button className="social-press" onClick={() => { hapticLight(); resetDemoEvents(); }} style={{ ...linkStyle, alignSelf: 'center' }}>
          Reset demo
        </button>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 44, boxSizing: 'border-box', padding: '0 12px',
  borderRadius: 10, border: '1px solid var(--social-hairline)', background: 'var(--social-surface)',
  color: 'var(--text-primary)', fontFamily: FONT, fontSize: TEXT, outline: 'none', colorScheme: 'dark',
};

const linkStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer',
  fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-secondary)',
};

function Field({ label, grow = false, children }: { label: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: grow ? 1 : undefined, minWidth: 0 }}>
      <span className="social-label" style={{ fontFamily: FONT, color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string | null>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            className="social-press"
            onClick={() => { hapticLight(); onChange(o.value); }}
            style={{
              height: 36, padding: '0 14px', borderRadius: 18, cursor: 'pointer',
              background: 'transparent',
              border: `1px solid ${on ? 'var(--text-primary)' : 'var(--social-hairline)'}`,
              color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontFamily: FONT, fontSize: TEXT, fontWeight: 700,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
