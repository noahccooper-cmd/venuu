import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SOCIAL_DEMO } from '../lib/socialMode';
import { HOST_DEMO_ENABLED } from '../lib/socialDemoStore';
import { demoTermsAccepted } from '../lib/socialPost';

export type SocialRole = 'user' | 'host' | 'admin';

export interface SocialProfile {
  role: SocialRole;
  banned: boolean;
  termsAccepted: boolean;
  name: string;
}

const SIGNED_OUT: SocialProfile = { role: 'user', banned: false, termsAccepted: false, name: 'You' };

/** The poster's Social flags (00077 columns) from their own profile row.
 *  Demo: a local host (override with localStorage social-demo-role). */
function demoProfile(): SocialProfile {
  let role: SocialRole = HOST_DEMO_ENABLED ? 'host' : 'user';
  try { const r = localStorage.getItem('social-demo-role'); if (r === 'user' || r === 'host' || r === 'admin') role = r; } catch { /* default */ }
  return { role, banned: false, termsAccepted: demoTermsAccepted(), name: 'You' };
}

export function useSocialProfile(profileId: string | null): SocialProfile & { reload: () => void } {
  const [p, setP] = useState<SocialProfile | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN(x => x + 1), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const demo = useMemo(() => (SOCIAL_DEMO ? demoProfile() : null), [n]);
  useEffect(() => {
    if (SOCIAL_DEMO || !profileId || !supabase) return;
    let live = true;
    (async () => {
      const { data } = await supabase.from('profiles')
        .select('role, posting_banned, accepted_posting_terms_at, display_name, username')
        .eq('id', profileId).maybeSingle();
      const row = data as { role?: SocialRole; posting_banned?: boolean; accepted_posting_terms_at?: string | null; display_name?: string | null; username?: string | null } | null;
      if (live && row) {
        setP({
          role: row.role ?? 'user', banned: !!row.posting_banned, termsAccepted: !!row.accepted_posting_terms_at,
          name: row.display_name || row.username || 'You',
        });
      }
    })();
    return () => { live = false; };
  }, [profileId, n]);
  return { ...(demo ?? (profileId ? p ?? SIGNED_OUT : SIGNED_OUT)), reload };
}
