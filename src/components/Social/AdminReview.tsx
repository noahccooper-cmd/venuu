import { useContext, useEffect, useState } from 'react';
import { BadgeCheck, Ban, ShieldX, X } from 'lucide-react';
import { hapticLight, hapticSelection } from '../../lib/haptics';
import type { SocialEvent } from '../../lib/socialTypes';
import { SOCIAL_CITY_LABEL } from '../../lib/socialTheme';
import {
  SocialActionsContext, banPoster, dismissReport, loadReports, setVerification, type ReportRow,
} from '../../lib/socialModeration';
import { REPORT_REASONS } from '../../lib/socialModeration';

const FONT = 'Satoshi, sans-serif';
const TEXT = 13;
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 12px', borderRadius: 12, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--social-hairline)', fontFamily: FONT, fontSize: TEXT, fontWeight: 800, color: 'var(--text-primary)',
};

function when(ev: SocialEvent) {
  if (ev.date_tba) return 'Date TBA';
  return new Date(ev.start_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Admins only: Community events newest first, the reports queue,
 *  Verify / Deny / Ban poster (docs/social-tab-spec.md §7). */
export function AdminReview({ community, topInset, onClose, onChanged }: {
  community: SocialEvent[]; topInset: number; onClose: () => void; onChanged: () => void;
}) {
  const ctx = useContext(SocialActionsContext);
  const [tab, setTab] = useState<'community' | 'reports'>('community');
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { let live = true; void loadReports().then(r => { if (live) setReports(r); }); return () => { live = false; }; }, [n]);
  if (!ctx) return null;
  const act = async (label: string, fn: () => Promise<{ ok: boolean }>) => {
    if (await ctx.run(label, fn as never)) { onChanged(); setN(x => x + 1); }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 22 }}>
      <div className="social-fade-in" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
      <div role="dialog" aria-modal="true" aria-label="Review" className="social-sheet-in"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: topInset + 8, display: 'flex', flexDirection: 'column', background: 'var(--social-bg)', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: '1px solid var(--social-hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px 8px 20px', flexShrink: 0 }}>
          <span style={{ flex: 1, fontFamily: FONT, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Review</span>
          <button className="social-press" aria-label="Close" onClick={() => { hapticLight(); onClose(); }} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={20} color="var(--text-secondary)" />
          </button>
        </div>
        <div role="tablist" style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexShrink: 0 }}>
          {(['community', 'reports'] as const).map(t => (
            <button key={t} role="tab" aria-selected={tab === t} className="social-press" onClick={() => { hapticSelection(); setTab(t); }}
              style={{ ...btn, background: tab === t ? 'var(--text-primary)' : 'transparent', color: tab === t ? '#0B0A09' : 'var(--text-primary)' }}>
              {t === 'community' ? `Community · ${community.length}` : `Reports · ${reports?.length ?? '…'}`}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tab === 'community' && community.length === 0 && <p style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>Nothing waiting. Every Community event has been reviewed.</p>}
          {tab === 'community' && community.map(ev => (
            <div key={ev.id} style={{ padding: 14, borderRadius: 14, background: 'var(--social-surface)', border: '1px solid var(--social-hairline)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                {SOCIAL_CITY_LABEL[ev.city]} · {ev.host_name}{ev.created_at ? ` · posted ${new Date(ev.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>{ev.title}</span>
              <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>{when(ev)} · {ev.external_venue_name ?? ev.address}</span>
              {ev.description && <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>{ev.description}</span>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <button className="social-press" style={btn} onClick={() => void act('Verified', () => setVerification(ev, 'verified'))}><BadgeCheck size={15} /> Verify</button>
                <button className="social-press" style={btn} onClick={() => void act('Denied — the poster is notified', () => setVerification(ev, 'denied'))}><ShieldX size={15} /> Deny</button>
                {ev.host_profile_id && ev.host_profile_id !== ctx.meId && (
                  <button className="social-press" style={btn} onClick={() => void act('Poster banned from posting', () => banPoster(ev.host_profile_id!))}><Ban size={15} /> Ban poster</button>
                )}
              </div>
            </div>
          ))}
          {tab === 'reports' && reports?.length === 0 && <p style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>No open reports.</p>}
          {tab === 'reports' && reports?.map(r => (
            <div key={r.id} style={{ padding: 14, borderRadius: 14, background: 'var(--social-surface)', border: '1px solid var(--social-hairline)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#E5484D' }}>
                {REPORT_REASONS.find(x => x.value === r.reason)?.label ?? r.reason} · {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>{r.title}</span>
              {r.details && <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>“{r.details}”</span>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <button className="social-press" style={btn}
                  onClick={() => void act('Denied — the poster is notified', () => setVerification({ id: r.event_id } as SocialEvent, 'denied'))}>
                  <ShieldX size={15} /> Deny event
                </button>
                <button className="social-press" style={btn} onClick={() => void act('Report dismissed', () => dismissReport(r))}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A poster's own denied events, shown once, then marked seen. */
export function DeniedNotice({ events, onOk }: { events: SocialEvent[]; onOk: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 32, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="social-fade-in" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />
      <div role="alertdialog" aria-modal="true" aria-label="Event removed" className="social-fade-in"
        style={{ position: 'relative', width: '100%', maxWidth: 360, boxSizing: 'border-box', padding: 24, borderRadius: 20, background: 'var(--social-bg)', border: '1px solid var(--social-hairline)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontFamily: FONT, fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
          {events.length === 1 ? 'Your event was removed' : `${events.length} of your events were removed`}
        </span>
        <span style={{ fontFamily: FONT, fontSize: TEXT, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          Venuu reviewed {events.length === 1 ? <b style={{ color: 'var(--text-primary)' }}>“{events[0].title}”</b> : 'them'} and took {events.length === 1 ? 'it' : 'them'} down because {events.length === 1 ? 'it doesn’t' : 'they don’t'} follow the posting rules.
        </span>
        <button className="social-press" onClick={() => { hapticLight(); onOk(); }}
          style={{ height: 48, borderRadius: 12, border: 'none', cursor: 'pointer', background: 'var(--text-primary)', color: '#0B0A09', fontFamily: FONT, fontSize: 15, fontWeight: 800 }}>
          OK
        </button>
      </div>
    </div>
  );
}
