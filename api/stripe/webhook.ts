/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook: checkout.session.completed
 * Adds credits to user's balance after successful payment.
 *
 * Configure in Stripe Dashboard → Webhooks:
 *   URL: https://your-domain.vercel.app/api/stripe/webhook
 *   Events: checkout.session.completed
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2026-03-25.dahlia' });
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const config = { api: { bodyParser: false } };

async function buffer(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  if (!sig || !WEBHOOK_SECRET) return res.status(400).json({ error: 'Missing signature' });

  let event: Stripe.Event;
  try {
    const body = await buffer(req);
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch (e: any) {
    console.error('[stripe/webhook] Signature failed:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id || session.metadata?.supabase_user_id;
    const creditsCents = parseInt(session.metadata?.credits_cents || '0', 10);

    if (!userId || !creditsCents) {
      console.error('[stripe/webhook] Missing userId or credits in session metadata');
      return res.status(200).json({ received: true });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Add credits to user's balance
    const { data: existing } = await supabase
      .from('credits')
      .select('balance_cents')
      .eq('user_id', userId)
      .single();

    const currentBalance = existing?.balance_cents ?? 0;
    const newBalance = currentBalance + creditsCents;

    await supabase.from('credits').upsert({
      user_id: userId,
      balance_cents: newBalance,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    console.log(`[stripe/webhook] Added ${creditsCents} credits for user ${userId}. Balance: ${newBalance}`);
  }

  return res.status(200).json({ received: true });
}
