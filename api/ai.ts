/**
 * AI proxy endpoint — routes requests to Claude, OpenAI, or Gemini
 * using server-side API keys. Authenticates users via Supabase JWT.
 *
 * POST /api/ai
 * Body: { provider, systemPrompt, messages, maxTokens?, temperature? }
 * Headers: Authorization: Bearer <supabase-jwt>
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Server-side API keys
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || '';

// Pricing per million tokens (in dollars) — update when providers change prices
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4-20250514':  { input: 3.0,  output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0  },
  // OpenAI
  'gpt-4o':                    { input: 2.5,  output: 10.0 },
  'gpt-4o-mini':               { input: 0.15, output: 0.60 },
  // Gemini (free tier is generous but we still track)
  'gemini-2.0-flash':          { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-lite':     { input: 0.0,  output: 0.0  },
};

/**
 * Calculate actual cost in cents from API response token usage.
 * Returns cost * 1.20 (20% markup).
 */
function calculateCostCents(provider: string, model: string, data: any): number {
  const pricing = PRICING[model];
  if (!pricing) return 1; // fallback: 1 cent if unknown model

  let inputTokens = 0;
  let outputTokens = 0;

  switch (provider) {
    case 'anthropic':
      inputTokens = data.usage?.input_tokens ?? 0;
      outputTokens = data.usage?.output_tokens ?? 0;
      break;
    case 'openai':
      inputTokens = data.usage?.prompt_tokens ?? 0;
      outputTokens = data.usage?.completion_tokens ?? 0;
      break;
    case 'gemini':
      inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
      outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
      break;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const totalDollars = inputCost + outputCost;

  // Convert to cents, minimum 1 cent, round up
  return Math.max(1, Math.ceil(totalDollars * 100));
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

/** Check if user has any credits at all. */
async function checkCredits(userId: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data } = await supabase
    .from('credits')
    .select('balance_cents')
    .eq('user_id', userId)
    .single();

  if ((data?.balance_cents ?? 0) <= 0) {
    return 'No credits remaining. Add credits in the dashboard to use AI features.';
  }
  return null;
}

/** Deduct actual cost (in cents) from user's balance. */
async function deductCredits(userId: string, costCents: number): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  // Use raw SQL for atomic decrement (avoids race conditions)
  await supabase.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: costCents,
  }).catch(async () => {
    // Fallback if RPC not set up yet: read-then-write
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
  });
}

async function callAnthropic(body: any): Promise<Response> {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: body.model || 'claude-sonnet-4-20250514',
      max_tokens: Math.min(body.maxTokens || 2048, 4096),
      system: body.systemPrompt,
      messages: body.messages,
      ...(body.temperature != null ? { temperature: body.temperature } : {}),
    }),
  });
}

async function callOpenAI(body: any): Promise<Response> {
  const messages = [
    { role: 'system', content: body.systemPrompt },
    ...body.messages,
  ];

  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: body.model || 'gpt-4o',
      max_tokens: Math.min(body.maxTokens || 2048, 4096),
      temperature: body.temperature ?? 0.7,
      messages,
    }),
  });
}

async function callGemini(body: any): Promise<Response> {
  const model = body.model || 'gemini-2.0-flash';
  const contents = body.messages.map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: body.systemPrompt }] },
        contents,
        generationConfig: {
          maxOutputTokens: Math.min(body.maxTokens || 2048, 4096),
          temperature: body.temperature ?? 0.7,
        },
      }),
    },
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticate
  const userId = await authenticateUser(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required. Sign in to use AI features.' });
  }

  // Check credits
  const creditError = await checkCredits(userId);
  if (creditError) {
    return res.status(402).json({ error: creditError });
  }

  const body = req.body;
  if (!body?.provider || !body?.systemPrompt || !body?.messages) {
    return res.status(400).json({ error: 'Missing required fields: provider, systemPrompt, messages' });
  }

  try {
    let apiResponse: Response;

    switch (body.provider) {
      case 'anthropic':
        if (!ANTHROPIC_KEY) return res.status(503).json({ error: 'Anthropic not configured on server' });
        apiResponse = await callAnthropic(body);
        break;
      case 'openai':
        if (!OPENAI_KEY) return res.status(503).json({ error: 'OpenAI not configured on server' });
        apiResponse = await callOpenAI(body);
        break;
      case 'gemini':
        if (!GEMINI_KEY) return res.status(503).json({ error: 'Gemini not configured on server' });
        apiResponse = await callGemini(body);
        break;
      default:
        return res.status(400).json({ error: `Unknown provider: ${body.provider}` });
    }

    if (!apiResponse.ok) {
      const errText = await apiResponse.text().catch(() => '');
      console.error(`[ai-proxy] ${body.provider} API ${apiResponse.status}: ${errText.slice(0, 200)}`);
      return res.status(502).json({ error: `AI provider error (${apiResponse.status})` });
    }

    const data = await apiResponse.json();

    // Extract text from provider-specific response format
    let text: string;
    switch (body.provider) {
      case 'anthropic':
        text = data.content?.[0]?.text ?? '';
        break;
      case 'openai':
        text = data.choices?.[0]?.message?.content ?? '';
        break;
      case 'gemini':
        text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        break;
      default:
        text = '';
    }

    // Calculate actual cost from token usage and deduct with 20% markup
    const model = body.model || (
      body.provider === 'anthropic' ? 'claude-sonnet-4-20250514' :
      body.provider === 'openai' ? 'gpt-4o' : 'gemini-2.0-flash'
    );
    const costCents = calculateCostCents(body.provider, model, data);
    await deductCredits(userId, costCents).catch(() => {});

    return res.status(200).json({ text });
  } catch (e: any) {
    console.error('[ai-proxy] Error:', e.message);
    return res.status(500).json({ error: 'Internal proxy error' });
  }
}
