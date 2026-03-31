/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout session for adding credits.
 * Body: { amount: number } — dollar amount to add (5, 10, 20, 50)
 * User pays amount + 10% service fee. Credits = amount in cents.
 *
 * Example: user adds $20 → pays $22 → gets 2000 credits (= $20 API budget)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' });
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const SATIE_CUT = 0.10; // 10% goes to Satie, 90% becomes API credits
const VALID_AMOUNTS = [5, 10, 20, 50]; // allowed dollar amounts

async function getUser(req: VercelRequest): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email || '' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });

  const amount = Number(req.body?.amount);
  if (!VALID_AMOUNTS.includes(amount)) {
    return res.status(400).json({ error: `Amount must be one of: $${VALID_AMOUNTS.join(', $')}` });
  }

  const chargeCents = amount * 100; // user pays exactly what they chose
  const creditsCents = Math.round(chargeCents * (1 - SATIE_CUT)); // 90% becomes API credits

  try {
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Satie Credits`,
            description: `$${(creditsCents / 100).toFixed(2)} in AI & audio generation credits`,
          },
          unit_amount: chargeCents,
        },
        quantity: 1,
      }],
      success_url: `${origin}/?credits_added=${amount}`,
      cancel_url: `${origin}/`,
      client_reference_id: user.id,
      customer_email: user.email,
      metadata: {
        supabase_user_id: user.id,
        credits_cents: String(creditsCents),
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('[stripe/checkout]', e.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
