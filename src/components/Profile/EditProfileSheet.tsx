import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { hapticLight, hapticMedium, hapticSuccess } from '../../lib/haptics';
import type { Profile, AvatarColor } from '../../lib/types';

/**
 * EditProfileSheet — bottom sheet for editing display_name, bio,
 * tagline, and avatar_color. Same drag-to-dismiss pattern as
 * VennySheet so the gesture vocabulary is unified.
 */

const FONT = 'Satoshi, sans-serif';

const AVATAR_COLORS: { key: AvatarColor; label: string; hex: string }[] = [
  { key: 'orange', label: 'Orange',  hex: '#FF8200' },
  { key: 'cyan',   label: 'Cyan',    hex: '#00D4FF' },
  { key: 'purple', label: 'Purple',  hex: '#9B5EFF' },
  { key: 'green',  label: 'Green',   hex: '#00CC66' },
  { key: 'pink',   label: 'Pink',    hex: '#FF5E9C' },
  { key: 'gold',   label: 'Gold',    hex: '#FFD700' },
  { key: 'sienna', label: 'Sienna',  hex: '#B8623A' },
  { key: 'wine',   label: 'Wine',    hex: '#8B2543' },
];

const DISPLAY_MAX = 30;
const BIO_MAX     = 160;
const TAGLINE_MAX = 50;

interface EditProfileSheetProps {
  open: boolean;
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
}

function EditProfileSheetInner({ open, profile, onClose, onSaved }: EditProfileSheetProps) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? profile.username);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [tagline, setTagline] = useState(profile.tagline ?? '');
  const [avatarColor, setAvatarColor] = useState<AvatarColor>(profile.avatar_color ?? 'orange');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drag-to-dismiss
  const dragStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  // Sync local state when a different profile flows in (rare — e.g.
  // re-open after refreshProfile updates the parent).
  useEffect(() => {
    if (!open) return;
    setDisplayName(profile.display_name ?? profile.username);
    setBio(profile.bio ?? '');
    setTagline(profile.tagline ?? '');
    setAvatarColor(profile.avatar_color ?? 'orange');
    setError(null);
    setDragOffset(0);
  }, [open, profile]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const trimmedName = displayName.trim();
    if (trimmedName.length < 1) {
      setError('Display name can’t be empty.');
      return;
    }
    setSaving(true);
    setError(null);

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        display_name: trimmedName.slice(0, DISPLAY_MAX),
        bio: bio.trim() ? bio.trim().slice(0, BIO_MAX) : null,
        tagline: tagline.trim() ? tagline.trim().slice(0, TAGLINE_MAX) : null,
        avatar_color: avatarColor,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

    setSaving(false);

    if (updateErr) {
      console.warn('[edit_profile] update failed:', updateErr.message);
      setError(updateErr.message ?? 'Could not save changes.');
      return;
    }

    hapticSuccess();
    onSaved();
  }, [saving, displayName, bio, tagline, avatarColor, profile.id, onSaved]);

  // Drag handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current == null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    if (dy > 0) setDragOffset(dy);
  }, []);
  const handleTouchEnd = useCallback(() => {
    if (dragStartY.current == null) return;
    if (dragOffset > 120) {
      hapticMedium();
      onClose();
    }
    dragStartY.current = null;
    setDragOffset(0);
  }, [dragOffset, onClose]);

  const handleColorTap = (key: AvatarColor) => {
    hapticLight();
    setAvatarColor(key);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => { if (!saving) onClose(); }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
              zIndex: 2100,
            }}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: dragOffset }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            style={{
              position: 'fixed',
              left: 0, right: 0, bottom: 0,
              height: '70vh',
              background: 'linear-gradient(180deg, #0E0E14 0%, #0A0A10 100%)',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTop: '1px solid var(--border-subtle)',
              boxShadow: '0 -16px 48px rgba(0, 0, 0, 0.6)',
              zIndex: 2101,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Drag handle */}
            <div
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{ padding: '10px 0 4px', cursor: 'grab', flexShrink: 0 }}
            >
              <div style={{
                width: 40, height: 4, borderRadius: 2,
                background: 'rgba(255, 255, 255, 0.18)',
                margin: '0 auto',
              }} />
            </div>

            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 20px 12px', flexShrink: 0,
            }}>
              <button
                type="button"
                onClick={() => { if (!saving) { hapticLight(); onClose(); } }}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-secondary)',
                  fontFamily: FONT, fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                  padding: '4px 0',
                }}
              >
                Cancel
              </button>
              <span style={{
                fontFamily: FONT, fontSize: 15, fontWeight: 700,
                color: 'var(--text-primary)', letterSpacing: '-0.01em',
              }}>
                Edit profile
              </span>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  background: 'transparent', border: 'none',
                  color: saving ? 'rgba(255,130,0,0.45)' : 'var(--brand-orange)',
                  fontFamily: FONT, fontSize: 14, fontWeight: 700,
                  cursor: saving ? 'default' : 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  padding: '4px 0',
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Scrollable form */}
            <div style={{
              flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              padding: '4px 20px 20px',
              display: 'flex', flexDirection: 'column', gap: 18,
            }}>
              {/* Display name */}
              <Field label="Display name" hint={`${displayName.length}/${DISPLAY_MAX}`}>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value.slice(0, DISPLAY_MAX))}
                  maxLength={DISPLAY_MAX}
                  placeholder={profile.username}
                  style={inputStyle}
                />
              </Field>

              {/* Tagline */}
              <Field label="Tagline" hint={`${tagline.length}/${TAGLINE_MAX}`}>
                <input
                  type="text"
                  value={tagline}
                  onChange={e => setTagline(e.target.value.slice(0, TAGLINE_MAX))}
                  maxLength={TAGLINE_MAX}
                  placeholder="looking for cocktails"
                  style={inputStyle}
                />
              </Field>

              {/* Bio */}
              <Field label="Bio" hint={`${bio.length}/${BIO_MAX}`}>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value.slice(0, BIO_MAX))}
                  maxLength={BIO_MAX}
                  rows={4}
                  placeholder="tell people what you're about"
                  style={{
                    ...inputStyle,
                    minHeight: 96,
                    resize: 'none',
                    paddingTop: 12,
                    paddingBottom: 12,
                  }}
                />
              </Field>

              {/* Avatar color */}
              <div>
                <div style={{
                  fontFamily: FONT, fontSize: 12, fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 10, letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                }}>
                  Avatar color
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {AVATAR_COLORS.map(c => {
                    const selected = avatarColor === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => handleColorTap(c.key)}
                        aria-label={`Avatar color ${c.label}`}
                        style={{
                          width: 42, height: 42, borderRadius: 21,
                          background: c.hex,
                          border: selected
                            ? '2px solid var(--brand-orange)'
                            : '2px solid transparent',
                          boxShadow: selected
                            ? '0 0 14px rgba(255, 130, 0, 0.55)'
                            : '0 2px 8px rgba(0,0,0,0.4)',
                          cursor: 'pointer',
                          WebkitTapHighlightColor: 'transparent',
                          padding: 0,
                          transition: 'transform 180ms var(--ease-out), box-shadow 180ms var(--ease-out)',
                          transform: selected ? 'scale(1.06)' : 'scale(1)',
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {error && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(255, 80, 60, 0.08)',
                  border: '1px solid rgba(255, 80, 60, 0.3)',
                  color: '#FFB8AC',
                  fontFamily: FONT, fontSize: 13,
                }}>
                  {error}
                </div>
              )}

              {/* Save (also reachable in the header — duplicated here so
                  a one-handed user doesn't have to reach up) */}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  marginTop: 4,
                  height: 48,
                  borderRadius: 14,
                  background: saving ? 'rgba(255, 130, 0, 0.4)' : 'var(--brand-orange)',
                  border: 'none',
                  color: 'white',
                  fontFamily: FONT, fontSize: 15, fontWeight: 700,
                  cursor: saving ? 'default' : 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'background 180ms var(--ease-out)',
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '10px 14px',
  borderRadius: 12,
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontFamily: FONT,
  fontSize: 14,
  fontWeight: 500,
  outline: 'none',
  resize: 'none',
  WebkitAppearance: 'none',
  letterSpacing: '-0.01em',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{
          fontFamily: FONT, fontSize: 12, fontWeight: 600,
          color: 'var(--text-secondary)',
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}>{label}</span>
        {hint && (
          <span style={{
            fontFamily: FONT, fontSize: 11, fontWeight: 500,
            color: 'var(--text-muted)',
          }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export const EditProfileSheet = memo(EditProfileSheetInner);
