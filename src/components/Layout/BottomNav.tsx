import { MapPin, Radio, User } from 'lucide-react';

export type Tab = 'tonight' | 'portal' | 'you';

interface BottomNavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const tabs: { key: Tab; label: string; icon: typeof MapPin }[] = [
  { key: 'tonight', label: 'Tonight', icon: MapPin },
  { key: 'portal',  label: 'Portal',  icon: Radio },
  { key: 'you',     label: 'You',     icon: User },
];

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
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="flex-1 flex flex-col items-center gap-1 py-2"
          >
            <Icon
              size={28}
              strokeWidth={1.5}
              color={isActive ? '#FF8200' : 'rgba(255, 255, 255, 0.4)'}
            />
            <span
              style={{
                fontFamily: 'Satoshi, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                color: isActive ? '#FF8200' : 'rgba(255, 255, 255, 0.4)',
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
