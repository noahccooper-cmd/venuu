import { useContext, useState } from 'react';
import { BadgeCheck, Ban, Flag, Pencil, ShieldX, Trash2, UserX } from 'lucide-react';
import { hapticLight, hapticSelection } from '../../lib/haptics';
import type { SocialEvent } from '../../lib/socialTypes';
import {
  REPORT_REASONS, SocialActionsContext, banPoster, blockPoster, deleteEvent, editEvent, reportEvent, setVerification,
  type ReportReason,
} from '../../lib/socialModeration';
import { DESCRIPTION_MAX, TITLE_MAX } from '../../lib/socialPost';

const FONT = 'Satoshi, sans-serif';
const TEXT = 13;

const row: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px', borderRadius: 12, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--social-hairline)', fontFamily: FONT, fontSize: TEXT, fontWeight: 800, color: 'var(--text-primary)',
};
const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 48, padding: '0 14px', borderRadius: 12, outline: 'none',
  background: 'var(--social-surface)', border: '1px solid var(--social-hairline)', color: 'var(--text-primary)', fontFamily: FONT, fontSize: 15, fontWeight: 600,
};

type Mode = 'idle' | 'report' | 'edit' | 'confirm-delete';

/** Owner / admin / report actions at the bottom of the detail sheet. */
export function EventActions({ event, onDone }: { event: SocialEvent; onDone: () => void }) {
  const ctx = useContext(SocialActionsContext);
  const [mode, setMode] = useState<Mode>('idle');
  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? '');
  if (!ctx) return null;
  const isOwner = !!ctx.meId && event.host_profile_id === ctx.meId;
  const canManage = isOwner || ctx.isAdmin;
  const poster = event.host_profile_id;

  if (mode === 'report') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>What’s wrong with this event?</span>
        <div role="radiogroup" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {REPORT_REASONS.map(r => (
            <button key={r.value} role="radio" aria-checked={reason === r.value} className="social-press" onClick={() => { hapticSelection(); setReason(r.value); }}
              style={{ ...row, background: reason === r.value ? 'var(--text-primary)' : 'transparent', color: reason === r.value ? '#0B0A09' : 'var(--text-primary)' }}>
              {r.label}
            </button>
          ))}
        </div>
        <textarea value={details} maxLength={280} onChange={e => setDetails(e.target.value)} rows={2} placeholder="Anything we should know? (optional)" style={{ ...field, padding: 12, resize: 'none' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="social-press" style={{ ...row, flex: 1, justifyContent: 'center', background: 'var(--text-primary)', color: '#0B0A09', border: 'none' }}
            onClick={async () => { if (await ctx.run('Thanks — we’ll take a look', () => reportEvent(event, ctx.meId, reason, details))) setMode('idle'); }}>
            Send report
          </button>
          <button className="social-press" style={{ ...row, justifyContent: 'center' }} onClick={() => { hapticLight(); setMode('idle'); }}>Cancel</button>
        </div>
        {poster && !isOwner && (
          <button className="social-press" style={{ ...row, justifyContent: 'center' }}
            onClick={() => void ctx.run('Blocked — you won’t see their events', () => blockPoster(ctx.meId, poster), onDone)}>
            <UserX size={15} /> Block this poster
          </button>
        )}
      </div>
    );
  }

  if (mode === 'edit') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input value={title} maxLength={TITLE_MAX} onChange={e => setTitle(e.target.value)} style={field} aria-label="Title" />
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} aria-label="Description" style={{ ...field, padding: 12, resize: 'none' }} />
        <span className="social-num" style={{ fontFamily: FONT, fontSize: 11, color: description.length > DESCRIPTION_MAX ? '#E5484D' : 'var(--text-muted)' }}>{description.length}/{DESCRIPTION_MAX}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="social-press" disabled={title.trim().length < 3} style={{ ...row, flex: 1, justifyContent: 'center', background: 'var(--text-primary)', color: '#0B0A09', border: 'none' }}
            onClick={async () => { if (await ctx.run('Saved', () => editEvent(event, { title: title.trim(), description: description.trim() || null }), onDone)) setMode('idle'); }}>
            Save
          </button>
          <button className="social-press" style={{ ...row, justifyContent: 'center' }} onClick={() => { hapticLight(); setMode('idle'); }}>Cancel</button>
        </div>
      </div>
    );
  }

  if (mode === 'confirm-delete') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Delete this event for everyone?</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="social-press" style={{ ...row, flex: 1, justifyContent: 'center', background: '#E5484D', color: '#0B0A09', border: 'none' }}
            onClick={() => void ctx.run('Event deleted', () => deleteEvent(event), onDone)}>
            Delete
          </button>
          <button className="social-press" style={{ ...row, justifyContent: 'center' }} onClick={() => { hapticLight(); setMode('idle'); }}>Keep it</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {ctx.isAdmin && event.verification === 'community' && (
        <>
          <button className="social-press" style={row} onClick={() => void ctx.run('Verified', () => setVerification(event, 'verified'), onDone)}><BadgeCheck size={15} /> Verify</button>
          <button className="social-press" style={row} onClick={() => void ctx.run('Denied — removed and the poster is notified', () => setVerification(event, 'denied'), onDone)}><ShieldX size={15} /> Deny</button>
        </>
      )}
      {ctx.isAdmin && poster && !isOwner && (
        <button className="social-press" style={row} onClick={() => void ctx.run('Poster banned from posting', () => banPoster(poster))}><Ban size={15} /> Ban poster</button>
      )}
      {canManage && (
        <>
          <button className="social-press" style={row} onClick={() => { hapticLight(); setMode('edit'); }}><Pencil size={15} /> Edit</button>
          <button className="social-press" style={row} onClick={() => { hapticLight(); setMode('confirm-delete'); }}><Trash2 size={15} /> Delete</button>
        </>
      )}
      {!isOwner && (
        <button className="social-press" style={row} onClick={() => { hapticLight(); if (!ctx.signedIn) { ctx.requireSignIn(); return; } setMode('report'); }}><Flag size={15} /> Report</button>
      )}
    </div>
  );
}
