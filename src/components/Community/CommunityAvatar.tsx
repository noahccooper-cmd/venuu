const FONT = 'Satoshi, sans-serif';

export function initialsOf(name: string): string {
  return (name || '?').slice(0, 2).toUpperCase();
}

/** Enum -> brand hex. Matches ProfileScreen.tsx's avatarHex() mapping
 *  exactly (duplicated locally per this codebase's existing convention
 *  — the same function already exists standalone in ProfileScreen.tsx
 *  and PublicProfilePage.tsx). Deliberately NOT LeaderboardOverlay's
 *  pass-the-enum-straight-through approach, which only coincidentally
 *  renders correctly for the couple of colors that also happen to be
 *  valid CSS keywords. */
export function avatarHex(color: string | null | undefined): string {
  switch (color) {
    case 'orange': return '#FF8200';
    case 'cyan':   return '#00D4FF';
    case 'purple': return '#9B5EFF';
    case 'green':  return '#00CC66';
    case 'pink':   return '#FF5E9C';
    case 'gold':   return '#FFD700';
    case 'sienna': return '#B8623A';
    case 'wine':   return '#8B2543';
    default:       return '#FF8200';
  }
}

interface CommunityAvatarProps {
  name: string;
  color: string | null | undefined;
  size?: number;
  /** Glow ring color — used for top-3 / owner emphasis, matching
   *  LeaderboardOverlay's Avatar ring treatment. */
  ring?: string;
}

/** Initials-circle avatar, colored by avatar_color. Same shape as
 *  LeaderboardOverlay's local Avatar component, reused across the
 *  Community tab's bar wall and venue drill-down. */
export function CommunityAvatar({ name, color, size = 34, ring }: CommunityAvatarProps) {
  const bg = avatarHex(color);
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: FONT, fontWeight: 800, fontSize: size * 0.38, color: 'white',
        boxShadow: ring ? `0 0 0 2px ${ring}, 0 0 12px ${ring}66` : undefined,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}
