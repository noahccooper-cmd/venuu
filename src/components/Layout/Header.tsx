import { getInitials } from '../../lib/utils';
import type { CityKey } from '../../lib/constants';
import { CityToggle } from './CityToggle';

interface HeaderProps {
  city: CityKey;
  onCityChange: (city: CityKey) => void;
  totalCount: number;
  username: string;
  onAvatarPress?: () => void;
}

export function Header({ city, onCityChange, totalCount, username, onAvatarPress }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 bg-[#050507]"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        zIndex: 1000,
      }}>
      <div className="px-4 pt-2 pb-2 flex items-center justify-between">
        <div>
          <h1
            style={{
              fontFamily: 'Satoshi, sans-serif',
              color: '#FF8200',
              fontSize: '28px',
              fontWeight: 800,
              letterSpacing: '-0.5px',
              lineHeight: 1,
            }}
          >
            venuu
          </h1>
          <p
            style={{
              fontFamily: 'Satoshi, sans-serif',
              fontSize: '15px',
              marginTop: '4px',
              lineHeight: 1,
            }}
          >
            {totalCount > 0 ? (
              <>
                {'\uD83D\uDD25'}{' '}
                <span style={{ color: '#fff', fontWeight: 700 }}>
                  {totalCount}
                </span>{' '}
                <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                  people out right now
                </span>
              </>
            ) : (
              <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                No one out yet tonight
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CityToggle city={city} onChange={onCityChange} />
          <button
            type="button"
            onClick={onAvatarPress}
            className="w-9 h-9 rounded-full bg-[#111114] border border-[#2A2A30] flex items-center justify-center text-xs font-bold active:scale-95 transition-transform"
            style={{
              fontFamily: 'Satoshi, sans-serif',
              color: '#FF8200',
              cursor: 'pointer',
              padding: 0,
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
              position: 'relative',
              zIndex: 10,
            }}
          >
            {getInitials(username)}
          </button>
        </div>
      </div>
    </header>
  );
}
