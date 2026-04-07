/**
 * ElevenLabs audio generation proxy — generates sound effects
 * using server-side API key. Authenticates users via Supabase JWT.
 *
 * POST /api/generate-audio
 * Body: { prompt, duration?, influence? }
 * Headers: Authorization: Bearer <supabase-jwt>
 * Returns: audio/mpeg binary
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || '';

// ElevenLabs sound generation pricing (Creator plan):
// $22/mo for 289,205 credits. Sound gen uses ~100 credits per call.
// Real cost: ~$0.008 per generation. We charge a flat 1 cent to cover
// infrastructure + small margin, regardless of duration.
const ELEVENLABS_COST_PER_GENERATION_CENTS = 1; // 1 cent flat

function calculateAudioCostCents(_durationSeconds: number): number {
  return ELEVENLABS_COST_PER_GENERATION_CENTS;
}

async function authenticateUser(req: VercelRequest): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

async function checkCredits(userId: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data } = await supabase
    .from('credits')
    .select('balance_cents')
    .eq('user_id', userId)
    .single();

  if ((data?.balance_cents ?? 0) <= 0) {
    return 'No credits remaining. Add credits in the dashboard to generate audio.';
  }
  return null;
}

async function deductCredits(userId: string, costCents: number): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data } = await supabase
    .from('credits')
    .select('balance_cents')
    .eq('user_id', userId)
    .single();

  const current = data?.balance_cents ?? 0;
  await supabase.from('credits').upsert({
    user_id: userId,
    balance_cents: Math.max(0, current - costCents),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!ELEVENLABS_KEY) {
    return res.status(503).json({ error: 'Audio generation not configured on server' });
  }

  const userId = await authenticateUser(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required. Sign in to generate audio.' });
  }

  const creditError = await checkCredits(userId);
  if (creditError) {
    return res.status(402).json({ error: creditError });
  }

  const { prompt, duration, influence, outputFormat } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: 'Missing required field: prompt' });
  }

  try {
    const format = outputFormat || 'mp3_44100_192';
    const apiRes = await fetch(
      `https://api.elevenlabs.io/v1/sound-generation?output_format=${format}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_KEY,
        },
        body: JSON.stringify({
          text: prompt,
          duration_seconds: Math.min(duration || 5, 22),
          prompt_influence: influence ?? 0.3,
        }),
      },
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '');
      console.error(`[audio-proxy] ElevenLabs ${apiRes.status}: ${errText.slice(0, 200)}`);
      return res.status(502).json({ error: `Audio generation failed (${apiRes.status})` });
    }

    // Deduct actual cost based on requested duration
    const actualDuration = Math.min(duration || 5, 22);
    const costCents = calculateAudioCostCents(actualDuration);
    await deductCredits(userId, costCents).catch(() => {});

    const buffer = await apiRes.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.byteLength.toString());
    return res.status(200).send(Buffer.from(buffer));
  } catch (e: any) {
    console.error('[audio-proxy] Error:', e.message);
    return res.status(500).json({ error: 'Internal proxy error' });
  }
}
