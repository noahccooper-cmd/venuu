import { useState, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '../lib/supabase';
import { hapticSuccess } from '../lib/haptics';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripe() {
  if (!stripePromise) stripePromise = loadStripe(STRIPE_PK);
  return stripePromise;
}

export interface TicketPurchaseResult {
  success: boolean;
  error?: string;
  qrCode?: string;
  pricePaid?: number;
  eventName?: string;
}

export function useTicketPurchase(userId: string | null) {
  const [purchasing, setPurchasing] = useState(false);

  const purchaseTicket = useCallback(async (
    eventId: string,
  ): Promise<TicketPurchaseResult> => {
    if (!userId) return { success: false, error: 'Sign in to buy tickets' };
    setPurchasing(true);

    try {
      // Step 1: Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setPurchasing(false);
        return { success: false, error: 'Sign in to buy tickets' };
      }

      // Step 2: Create PaymentIntent via Edge Function
      const createRes = await fetch(`${SUPABASE_URL}/functions/v1/create-event-ticket-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ event_id: eventId }),
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
          card: { token: 'tok_visa' }, // In production: Stripe Elements or Apple Pay
        } as never,
      });

      if (stripeError) {
        setPurchasing(false);
        return { success: false, error: stripeError.message ?? 'Payment failed' };
      }

      // Step 4: Finalize ticket via Edge Function (retry up to 3x)
      let finalizeData: Record<string, unknown> = {};
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const finalizeRes = await fetch(`${SUPABASE_URL}/functions/v1/finalize-event-ticket`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': ANON_KEY,
              'Authorization': `Bearer ${ANON_KEY}`,
            },
            body: JSON.stringify({ payment_intent_id, event_id: eventId }),
          });
          finalizeData = await finalizeRes.json();
          if (finalizeRes.ok && finalizeData.success) break;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
        } catch {
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
        }
      }

      setPurchasing(false);

      if (!finalizeData.success) {
        return {
          success: false,
          error: (finalizeData.message as string) ?? 'Payment received! Contact support for your ticket.',
        };
      }

      hapticSuccess();

      return {
        success: true,
        qrCode: finalizeData.qr_code as string,
        pricePaid: finalizeData.price_paid as number,
        eventName: finalizeData.event_name as string,
      };
    } catch (err) {
      setPurchasing(false);
      return { success: false, error: (err as Error).message };
    }
  }, [userId]);

  return { purchasing, purchaseTicket };
}
