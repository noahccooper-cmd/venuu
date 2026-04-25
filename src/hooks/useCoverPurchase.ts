import { useState, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { supabase, envReady } from '../lib/supabase';
import { getTonightDate } from '../lib/utils';
import { hapticSuccess } from '../lib/haptics';
import type { CoverPurchase } from '../lib/types';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripe() {
  if (!stripePromise) stripePromise = loadStripe(STRIPE_PK);
  return stripePromise;
}

export interface PurchaseResult {
  success: boolean;
  error?: string;
  qrCode?: string;
  pricePaid?: number;
  venueName?: string;
}

export function useCoverPurchase(userId: string | null) {
  const [purchasing, setPurchasing] = useState(false);
  const [myPurchases, setMyPurchases] = useState<Map<string, CoverPurchase>>(new Map());

  // Fetch user's purchases for tonight
  const fetchMyPurchases = useCallback(async () => {
    if (!userId || !envReady) return;
    const nightOf = getTonightDate();
    const { data } = await supabase
      .from('cover_purchases')
      .select('*, cover_configs!inner(night_of)')
      .eq('user_id', userId)
      .eq('cover_configs.night_of', nightOf)
      .in('status', ['completed', 'used']);

    if (data) {
      const map = new Map<string, CoverPurchase>();
      for (const p of data as CoverPurchase[]) {
        map.set(p.venue_id, p);
      }
      setMyPurchases(map);
    }
  }, [userId]);

  // Buy a cover
  const purchaseCover = useCallback(async (
    coverConfigId: string,
    venueId: string,
  ): Promise<PurchaseResult> => {
    if (!userId) return { success: false, error: 'Sign in to buy covers' };
    setPurchasing(true);

    try {
      // Step 1: Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setPurchasing(false);
        return { success: false, error: 'Sign in to buy covers' };
      }

      // Step 2: Create PaymentIntent via Edge Function
      const createRes = await fetch(`${SUPABASE_URL}/functions/v1/create-cover-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ cover_config_id: coverConfigId, venue_id: venueId }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        setPurchasing(false);
        return { success: false, error: createData.message ?? createData.error ?? 'Purchase failed' };
      }

      const { client_secret, payment_intent_id } = createData;

      // Step 3: Confirm payment with Stripe
      const stripe = await getStripe();
      if (!stripe) {
        setPurchasing(false);
        return { success: false, error: 'Payment system unavailable' };
      }

      const { error: stripeError } = await stripe.confirmCardPayment(client_secret, {
        payment_method: {
          card: { token: 'tok_visa' }, // In production, use Stripe Elements or Apple Pay
        } as never, // Type assertion for test token
      });

      if (stripeError) {
        setPurchasing(false);
        return { success: false, error: stripeError.message ?? 'Payment failed' };
      }

      // Step 4: Finalize purchase via Edge Function (retry up to 3x — payment already went through)
      let finalizeData: Record<string, unknown> = {};
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const finalizeRes = await fetch(`${SUPABASE_URL}/functions/v1/finalize-cover-purchase`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': ANON_KEY,
              'Authorization': `Bearer ${ANON_KEY}`,
            },
            body: JSON.stringify({ payment_intent_id, cover_config_id: coverConfigId }),
          });
          finalizeData = await finalizeRes.json();
          if (finalizeRes.ok && finalizeData.success) break;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
        } catch {
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
        }
      }
      setPurchasing(false);

      if (!finalizeData.success) {
        return { success: false, error: (finalizeData.message as string) ?? 'Payment received! Contact support for your pass.' };
      }

      // Refresh purchases + haptic
      hapticSuccess();
      fetchMyPurchases();

      return {
        success: true,
        qrCode: finalizeData.qr_code as string,
        pricePaid: finalizeData.price_paid as number,
        venueName: finalizeData.venue_name as string,
      };
    } catch (err) {
      setPurchasing(false);
      return { success: false, error: (err as Error).message };
    }
  }, [userId, fetchMyPurchases]);

  return { purchasing, myPurchases, purchaseCover, fetchMyPurchases };
}
