import { MapPin, Trophy, User } from 'lucide-react';

/** Consumer-facing primary destinations. 'portal' (venue-staff tools)
 *  deliberately lives outside this nav — see ProfileScreen's
 *  "Venue / Partner Login" entry point instead. A 4th tab (events)
 *  slots in here later; the flex-1/justify-around layout below
 *  doesn't need any rework to accommodate it. */
export type Tab = 'tonight' | 'community' | 'you';

interface BottomNavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const tabs: { key: Tab; label: string; icon: typeof MapPin }[] = [
  { key: 'tonight',   label: 'Tonight',   icon: MapPin },
  { key: 'community', label: 'Community', icon: Trophy },
  { key: 'you',       label: 'You',       icon: User },
];

/** Active color per tab. Community uses the gold ownership/leadership
 *  accent (#FFD24A — same as LeaderboardOverlay's crown/rank-1 color)
 *  instead of brand orange, since it's the leaderboard/ownership
 *  surface. Everything else stays on brand orange. */
const ACTIVE_COLOR: Record<Tab, string> = {
  tonight: '#FF8200',
  community: '#FFD24A',
  you: '#FF8200',
};

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav data-nav="bottom" className="fixed bottom-0 left-0 right-0 z-50 bg-[#0A0A0F] flex items-center justify-around"
      style={{
        height: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = key === active;
        const color = isActive ? ACTIVE_COLOR[key] : 'rgba(255, 255, 255, 0.4)';
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="flex-1 flex flex-col items-center gap-1 py-2"
          >
            <Icon size={28} strokeWidth={1.5} color={color} />
            <span
              style={{
                fontFamily: 'Satoshi, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                color,
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
