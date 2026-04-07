import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { timeAgo } from '../../lib/utils';
import { hapticMedium } from '../../lib/haptics';
import type { Venue, VenueEvent } from '../../lib/types';

const FONT = 'Satoshi, sans-serif';
const BLUE = '#00D4FF';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5b3V2aHRnendjYnFweWxjc3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzQ5NDYsImV4cCI6MjA4Njc1MDk0Nn0.kr1qQ1jyFBaNDP351aMihxNO3K4GFf_XJEfHRZ9MZ-E';
const PUSH_URL = 'https://tyouvhtgzwcbqpylcssk.supabase.co/functions/v1/push-event';

const EVENT_TYPES: { value: VenueEvent['event_type']; label: string }[] = [
  { value: 'party', label: 'Party' },
  { value: 'brand', label: 'Brand Activation' },
  { value: 'greek', label: 'Greek Life' },
  { value: 'launch', label: 'Launch' },
  { value: 'special', label: 'Special' },
];

/** Calculate 4:00 AM the morning after the given date string (YYYY-MM-DD). */
/** 4:00 AM the morning AFTER the event date, in local time.
 *  e.g. event on 2025-03-28 → expires 2025-03-29 04:00 local.
 *  Uses T12:00 to avoid UTC date-shift when parsing date-only strings. */
function calcExpiresAt(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  d.setHours(4, 0, 0, 0);
  return d.toISOString();
}

interface EventCreatorProps {
  venue: Venue;
}

export function EventCreator({ venue }: EventCreatorProps) {
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventType, setEventType] = useState<VenueEvent['event_type']>('party');
  const [hostName, setHostName] = useState(venue.name);
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('22:00');
  const [endTime, setEndTime] = useState('02:00');
  // Ticket state
  const [hasTickets, setHasTickets] = useState(false);
  const [ticketPrice, setTicketPrice] = useState('');
  const [totalTickets, setTotalTickets] = useState('');
  const [saleStartOption, setSaleStartOption] = useState<'now' | 'custom'>('now');
  const [saleStartTime, setSaleStartTime] = useState('');
  const [saleEndOption, setSaleEndOption] = useState<'event_start' | 'event_end' | 'custom'>('event_start');
  const [saleEndTime, setSaleEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState('');

  // Venue events list
  const [venueEvents, setVenueEvents] = useState<VenueEvent[]>([]);

  // Sync host name when venue changes
  useEffect(() => { setHostName(venue.name); }, [venue.name]);

  // Fetch events for this venue
  const fetchVenueEvents = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('venue_id', venue.id)
      .order('start_time', { ascending: false })
      .limit(10);
    if (data) setVenueEvents(data as VenueEvent[]);
  }, [venue.id]);

  useEffect(() => { fetchVenueEvents(); }, [fetchVenueEvents]);

  const canSubmit = title.trim() && hostName.trim() && eventDate && eventTime && !submitting &&
    (!hasTickets || (ticketPrice && totalTickets));

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setConfirm('');

    const startTime = new Date(`${eventDate}T${eventTime}:00`).toISOString();
    const endTimeISO = (() => {
      const [eh, em] = endTime.split(':').map(Number);
      const d = new Date(`${eventDate}T${eventTime}:00`);
      d.setHours(eh, em, 0, 0);
      // If end time is before start time, it's the next day
      if (d <= new Date(startTime)) d.setDate(d.getDate() + 1);
      return d.toISOString();
    })();
    const expiresAt = calcExpiresAt(eventDate);

    // Compute ticket sale times
    let saleStartsAt: string | null = null;
    let saleEndsAt: string | null = null;
    if (hasTickets) {
      saleStartsAt = saleStartOption === 'custom' && saleStartTime
        ? new Date(`${eventDate}T${saleStartTime}:00`).toISOString()
        : new Date().toISOString();
      if (saleEndOption === 'event_start') saleEndsAt = startTime;
      else if (saleEndOption === 'event_end') saleEndsAt = endTimeISO;
      else if (saleEndTime) saleEndsAt = new Date(`${eventDate}T${saleEndTime}:00`).toISOString();
    }

    const { error } = await supabase.from('events').insert({
      venue_id: venue.id,
      city: venue.city,
      title: title.trim(),
      description: description.trim() || null,
      event_type: eventType,
      host_name: hostName.trim(),
      start_time: startTime,
      end_time: endTimeISO,
      latitude: venue.lat,
      longitude: venue.lng,
      created_by: `portal:${venue.id}`,
      expires_at: expiresAt,
      is_active: true,
      has_tickets: hasTickets,
      ticket_price: hasTickets ? Math.round(parseFloat(ticketPrice) * 100) : null,
      total_tickets: hasTickets ? parseInt(totalTickets, 10) : null,
      tickets_sold: 0,
      sale_starts_at: saleStartsAt,
      sale_ends_at: saleEndsAt,
    });

    if (error) {
      console.error('[event] Insert error:', error.message);
      setConfirm('Failed to create event');
      setSubmitting(false);
      setTimeout(() => setConfirm(''), 3000);
      return;
    }

    // Fire push notification (non-blocking, same pattern as Drop)
    try {
      console.debug('[event] Firing push-event for', title.trim(), 'in', venue.city);
      fetch(PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          venue_name: venue.name,
          host_name: hostName.trim(),
          city: venue.city,
          start_time: startTime,
        }),
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) console.warn('[event] push-event error:', res.status, data);
        else console.debug('[event] push-event sent:', data);
      }).catch((err: Error) => {
        console.warn('[event] push-event failed:', err.message);
      });
    } catch (err) {
      console.warn('[event] push-event invoke error:', (err as Error).message);
    }

    // Reset form
    setTitle('');
    setDescription('');
    setEventType('party');
    setHostName(venue.name);
    setEventDate('');
    setEventTime('22:00');
    setEndTime('02:00');
    setHasTickets(false);
    setTicketPrice('');
    setTotalTickets('');
    setSaleStartOption('now');
    setSaleStartTime('');
    setSaleEndOption('event_start');
    setSaleEndTime('');
    setSubmitting(false);
    hapticMedium();
    setConfirm('Event created \u2713');
    setTimeout(() => setConfirm(''), 3000);

    // Refresh list
    fetchVenueEvents();
  }, [canSubmit, title, description, eventType, hostName, eventDate, eventTime, venue, fetchVenueEvents]);

  // Confirmation state: { eventId, action } or null
  const [confirmAction, setConfirmAction] = useState<{ eventId: string; action: 'deactivate' | 'delete' } | null>(null);

  const handleDeactivate = useCallback(async (eventId: string) => {
    const { error } = await supabase
      .from('events')
      .update({ is_active: false })
      .eq('id', eventId);
    if (error) {
      console.error('[event] Deactivate error:', error.message);
      return;
    }
    setVenueEvents(prev => prev.map(e => e.id === eventId ? { ...e, is_active: false } : e));
    setConfirmAction(null);
  }, []);

  const handleReactivate = useCallback(async (eventId: string) => {
    const { error } = await supabase
      .from('events')
      .update({ is_active: true })
      .eq('id', eventId);
    if (error) {
      console.error('[event] Reactivate error:', error.message);
      return;
    }
    setVenueEvents(prev => prev.map(e => e.id === eventId ? { ...e, is_active: true } : e));
  }, []);

  const handleDelete = useCallback(async (eventId: string) => {
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId);
    if (error) {
      console.error('[event] Delete error:', error.message);
      return;
    }
    setVenueEvents(prev => prev.filter(e => e.id !== eventId));
    setConfirmAction(null);
  }, []);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: '44px',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(0, 212, 255, 0.2)',
    padding: '0 16px',
    fontSize: '15px',
    color: 'white',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: FONT,
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: '11px',
    fontWeight: 600,
    color: BLUE,
    letterSpacing: '0.5px',
    marginBottom: '4px',
    display: 'block',
  };

  return (
    <div style={{ marginTop: '14px', padding: '0 0 24px' }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 600,
        color: BLUE,
        letterSpacing: '1px',
        textTransform: 'uppercase',
        marginBottom: '12px',
        fontFamily: FONT,
      }}>
        {'\u26A1'} CREATE EVENT
      </div>

      {/* Title */}
      <label style={labelStyle}>Event Title *</label>
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value.slice(0, 80))}
        placeholder="e.g. venuu Launch Party at Sunspot"
        maxLength={80}
        style={{ ...inputStyle, marginBottom: '10px' }}
      />

      {/* Event Type */}
      <label style={labelStyle}>Event Type *</label>
      <select
        value={eventType}
        onChange={e => setEventType(e.target.value as VenueEvent['event_type'])}
        style={{
          ...inputStyle,
          marginBottom: '10px',
          appearance: 'none',
          WebkitAppearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2300D4FF' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 14px center',
          paddingRight: '40px',
        }}
      >
        {EVENT_TYPES.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {/* Host Name */}
      <label style={labelStyle}>Host Name *</label>
      <input
        type="text"
        value={hostName}
        onChange={e => setHostName(e.target.value.slice(0, 60))}
        placeholder="e.g. Happy Dad, Sigma Chi"
        maxLength={60}
        style={{ ...inputStyle, marginBottom: '10px' }}
      />

      {/* Date + Start Time */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Date *</label>
          <input
            type="date"
            value={eventDate}
            onChange={e => setEventDate(e.target.value)}
            style={{ ...inputStyle, colorScheme: 'dark' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Start Time *</label>
          <input
            type="time"
            value={eventTime}
            onChange={e => setEventTime(e.target.value)}
            style={{ ...inputStyle, colorScheme: 'dark' }}
          />
        </div>
      </div>
      {/* End Time */}
      <div style={{ marginBottom: '10px' }}>
        <label style={labelStyle}>End Time</label>
        <input
          type="time"
          value={endTime}
          onChange={e => setEndTime(e.target.value)}
          style={{ ...inputStyle, colorScheme: 'dark' }}
        />
      </div>

      {/* Description */}
      <label style={labelStyle}>Description (optional)</label>
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value.slice(0, 280))}
        placeholder="Tell people what to expect..."
        maxLength={280}
        rows={3}
        style={{
          ...inputStyle,
          height: 'auto',
          padding: '12px 16px',
          resize: 'none',
          lineHeight: '1.4',
          marginBottom: '10px',
        }}
      />

      {/* Sell Tickets Toggle */}
      <div style={{
        background: hasTickets ? 'rgba(0, 212, 255, 0.04)' : 'rgba(255,255,255,0.03)',
        border: hasTickets ? '1px solid rgba(0, 212, 255, 0.2)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: '10px',
        transition: 'all 0.2s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: hasTickets ? BLUE : 'white', margin: 0 }}>
              {'\uD83C\uDFAB'} Sell tickets for this event?
            </p>
          </div>
          <button
            onClick={() => setHasTickets(v => !v)}
            style={{
              width: 44, height: 26, borderRadius: 13,
              background: hasTickets ? BLUE : '#2A2A30',
              border: 'none', cursor: 'pointer', position: 'relative',
              transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <div style={{
              width: 22, height: 22, borderRadius: 11, background: 'white',
              position: 'absolute', top: 2,
              left: hasTickets ? 20 : 2,
              transition: 'left 0.2s',
            }} />
          </button>
        </div>

        {hasTickets && (
          <div style={{ marginTop: 12 }}>
            {/* Price + Total */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Ticket Price *</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#8A8A95', fontSize: 14 }}>$</span>
                  <input
                    type="number" value={ticketPrice} onChange={e => setTicketPrice(e.target.value)}
                    placeholder="15" min="1" step="1"
                    style={{ ...inputStyle, paddingLeft: 22 }}
                  />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Total Available *</label>
                <input
                  type="number" value={totalTickets} onChange={e => setTotalTickets(e.target.value)}
                  placeholder="300" min="1"
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Sale Start */}
            <label style={labelStyle}>Tickets go on sale</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['now', 'custom'] as const).map(opt => (
                <button key={opt} onClick={() => setSaleStartOption(opt)} style={{
                  flex: 1, height: 32, borderRadius: 8, fontFamily: FONT, fontSize: 12, fontWeight: 600,
                  background: saleStartOption === opt ? 'rgba(0, 212, 255, 0.15)' : 'rgba(255,255,255,0.04)',
                  border: saleStartOption === opt ? `1px solid ${BLUE}` : '1px solid rgba(255,255,255,0.1)',
                  color: saleStartOption === opt ? BLUE : '#8A8A95', cursor: 'pointer',
                }}>
                  {opt === 'now' ? 'Now' : 'At a specific time'}
                </button>
              ))}
            </div>
            {saleStartOption === 'custom' && (
              <input type="time" value={saleStartTime} onChange={e => setSaleStartTime(e.target.value)}
                style={{ ...inputStyle, marginBottom: 8, colorScheme: 'dark' }} />
            )}

            {/* Sale End */}
            <label style={labelStyle}>Tickets stop selling</label>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {([
                ['event_start', 'At event start'],
                ['event_end', 'At event end'],
                ['custom', 'Custom time'],
              ] as const).map(([opt, label]) => (
                <button key={opt} onClick={() => setSaleEndOption(opt)} style={{
                  flex: 1, minWidth: 70, height: 32, borderRadius: 8, fontFamily: FONT, fontSize: 11, fontWeight: 600,
                  background: saleEndOption === opt ? 'rgba(0, 212, 255, 0.15)' : 'rgba(255,255,255,0.04)',
                  border: saleEndOption === opt ? `1px solid ${BLUE}` : '1px solid rgba(255,255,255,0.1)',
                  color: saleEndOption === opt ? BLUE : '#8A8A95', cursor: 'pointer',
                }}>
                  {label}
                </button>
              ))}
            </div>
            {saleEndOption === 'custom' && (
              <input type="time" value={saleEndTime} onChange={e => setSaleEndTime(e.target.value)}
                style={{ ...inputStyle, marginTop: 8, colorScheme: 'dark' }} />
            )}
          </div>
        )}
      </div>

      {/* Auto-filled info */}
      <div style={{
        fontFamily: FONT,
        fontSize: '11px',
        color: 'rgba(255,255,255,0.3)',
        marginBottom: '12px',
        padding: '0 2px',
      }}>
        Venue: {venue.name} &middot; City: {venue.city} &middot; Expires 4:00 AM next day
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          width: '100%',
          height: '44px',
          borderRadius: '12px',
          background: canSubmit ? BLUE : 'rgba(0, 212, 255, 0.2)',
          color: 'white',
          fontWeight: 700,
          fontSize: '14px',
          border: 'none',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          fontFamily: FONT,
          transition: 'background 0.2s',
          opacity: canSubmit ? 1 : 0.5,
        }}
      >
        {submitting ? 'Creating...' : 'CREATE EVENT'}
      </button>

      {confirm && (
        <div style={{
          color: confirm.includes('Failed') ? '#FF2D05' : '#22C55E',
          fontSize: '13px',
          fontWeight: 600,
          textAlign: 'center',
          marginTop: '6px',
          fontFamily: FONT,
        }}>
          {confirm}
        </div>
      )}

      {/* ── Your Events ── */}
      {venueEvents.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            marginBottom: '8px',
            fontFamily: FONT,
          }}>
            YOUR EVENTS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {venueEvents.map(evt => {
              const isConfirming = confirmAction?.eventId === evt.id;
              return (
                <div
                  key={evt.id}
                  style={{
                    background: evt.is_active ? 'rgba(0, 212, 255, 0.04)' : 'rgba(255,255,255,0.02)',
                    border: evt.is_active ? '1px solid rgba(0, 212, 255, 0.15)' : '1px solid rgba(255,255,255,0.06)',
                    borderLeftWidth: '3px',
                    borderLeftColor: evt.is_active ? BLUE : '#55555F',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    opacity: evt.is_active ? 1 : 0.5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '13px', fontWeight: 700, color: 'white', margin: '0 0 2px', fontFamily: FONT }}>
                        {evt.title}
                      </p>
                      <p style={{ fontSize: '11px', color: BLUE, margin: '0 0 2px', fontFamily: FONT }}>
                        {evt.host_name}
                      </p>
                      <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', margin: 0, fontFamily: FONT }}>
                        {timeAgo(evt.created_at)} &middot; {evt.is_active ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                    {/* Action buttons */}
                    {!isConfirming && (
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: '8px' }}>
                        {evt.is_active ? (
                          <button
                            onClick={() => setConfirmAction({ eventId: evt.id, action: 'deactivate' })}
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '8px',
                              padding: '4px 10px',
                              fontSize: '10px',
                              fontWeight: 600,
                              color: '#FF2D05',
                              cursor: 'pointer',
                              fontFamily: FONT,
                            }}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(evt.id)}
                            style={{
                              background: 'rgba(0, 212, 255, 0.08)',
                              border: '1px solid rgba(0, 212, 255, 0.2)',
                              borderRadius: '8px',
                              padding: '4px 10px',
                              fontSize: '10px',
                              fontWeight: 600,
                              color: BLUE,
                              cursor: 'pointer',
                              fontFamily: FONT,
                            }}
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmAction({ eventId: evt.id, action: 'delete' })}
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            padding: '4px 10px',
                            fontSize: '10px',
                            fontWeight: 600,
                            color: '#55555F',
                            cursor: 'pointer',
                            fontFamily: FONT,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Confirmation prompt */}
                  {isConfirming && (
                    <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                      <p style={{ fontSize: '12px', color: '#8A8A95', margin: '0 0 8px', fontFamily: FONT }}>
                        {confirmAction.action === 'deactivate'
                          ? 'Remove this event from the map?'
                          : 'Permanently delete this event?'}
                      </p>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setConfirmAction(null)}
                          style={{
                            flex: 1,
                            height: '32px',
                            borderRadius: '8px',
                            background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: 'rgba(255,255,255,0.5)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: FONT,
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (confirmAction.action === 'deactivate') handleDeactivate(evt.id);
                            else handleDelete(evt.id);
                          }}
                          style={{
                            flex: 1,
                            height: '32px',
                            borderRadius: '8px',
                            background: confirmAction.action === 'delete' ? '#FF2D05' : 'rgba(255, 45, 5, 0.15)',
                            border: confirmAction.action === 'delete' ? 'none' : '1px solid rgba(255, 45, 5, 0.3)',
                            color: 'white',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: FONT,
                          }}
                        >
                          {confirmAction.action === 'deactivate' ? 'Deactivate' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
