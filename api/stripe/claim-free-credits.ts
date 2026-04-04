/**
 * POST /api/stripe/claim-free-credits
 * Grants $1.00 (100 cents) of free credits to new users on first sign-in.
 * Idempotent — calling multiple times has no effect after the first claim.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const FREE_CREDITS_CENTS = 100; // $1.00

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: userData, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !userData.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const userId = userData.user.id;

  // Check if user already has a credits row
  const { data: existing } = await supabase
    .from('credits')
    .select('balance_cents, free_credits_claimed')
    .eq('user_id', userId)
    .single();

  // Already claimed
  if (existing?.free_credits_claimed) {
    return res.status(200).json({ claimed: false, balance_cents: existing.balance_cents });
  }

  // Grant free credits (upsert: create row if none, or update if exists but unclaimed)
  const currentBalance = existing?.balance_cents ?? 0;
  const newBalance = currentBalance + FREE_CREDITS_CENTS;

  await supabase.from('credits').upsert({
    user_id: userId,
    balance_cents: newBalance,
    free_credits_claimed: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  console.log(`[claim-free-credits] Granted ${FREE_CREDITS_CENTS} free credits to user ${userId}. Balance: ${newBalance}`);
  return res.status(200).json({ claimed: true, balance_cents: newBalance });
}
