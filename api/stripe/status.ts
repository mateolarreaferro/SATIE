/**
 * GET /api/stripe/status
 * Returns credit balance for the authenticated user.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(200).json({ balance_cents: 0 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: userData, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !userData.user) {
    return res.status(200).json({ balance_cents: 0 });
  }

  const { data } = await supabase
    .from('credits')
    .select('balance_cents')
    .eq('user_id', userData.user.id)
    .single();

  return res.status(200).json({ balance_cents: data?.balance_cents ?? 0 });
}
