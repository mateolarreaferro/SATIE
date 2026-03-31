/**
 * AI proxy endpoint — smart router with automatic fallback.
 *
 * POST /api/ai
 * Body: { provider?, systemPrompt, messages, maxTokens?, temperature? }
 *   provider is optional — if omitted or if it fails, tries the next available.
 *
 * GET /api/ai
 *   Returns which providers are configured on the server.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Server-side API keys
const KEYS: Record<string, string> = {
  anthropic: process.env.ANTHROPIC_API_KEY || '',
  openai: process.env.OPENAI_API_KEY || '',
  gemini: process.env.GEMINI_API_KEY || '',
};

// Which providers are actually configured
const AVAILABLE_PROVIDERS = Object.entries(KEYS)
  .filter(([, key]) => !!key)
  .map(([name]) => name);

// Pricing per million tokens (dollars)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514':  { input: 3.0,  output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0  },
  'gpt-4o':                    { input: 2.5,  output: 10.0 },
  'gpt-4o-mini':               { input: 0.15, output: 0.60 },
  'gemini-2.0-flash':          { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-lite':     { input: 0.0,  output: 0.0  },
};

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
};

function calculateCostCents(provider: string, model: string, data: any): number {
  const pricing = PRICING[model];
  if (!pricing) return 1;

  let inputTokens = 0, outputTokens = 0;
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

  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output;
  return Math.max(1, Math.ceil(cost * 100));
}

function extractText(provider: string, data: any): string {
  switch (provider) {
    case 'anthropic': return data.content?.[0]?.text ?? '';
    case 'openai': return data.choices?.[0]?.message?.content ?? '';
    case 'gemini': return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    default: return '';
  }
}

async function callProvider(provider: string, body: any): Promise<Response> {
  const key = KEYS[provider];
  const model = body.model || DEFAULT_MODELS[provider];

  switch (provider) {
    case 'anthropic':
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: Math.min(body.maxTokens || 2048, 4096),
          system: body.systemPrompt,
          messages: body.messages,
          ...(body.temperature != null ? { temperature: body.temperature } : {}),
        }),
      });

    case 'openai':
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: Math.min(body.maxTokens || 2048, 4096),
          temperature: body.temperature ?? 0.7,
          messages: [
            { role: 'system', content: body.systemPrompt },
            ...body.messages,
          ],
        }),
      });

    case 'gemini':
      return fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: body.systemPrompt }] },
            contents: body.messages.map((m: any) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              maxOutputTokens: Math.min(body.maxTokens || 2048, 4096),
              temperature: body.temperature ?? 0.7,
            },
          }),
        },
      );

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Auth + Credits ──

async function authenticateUser(req: VercelRequest): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await supabase.auth.getUser(auth.slice(7));
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
    return 'No credits remaining. Add credits in the dashboard to use AI features.';
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

// ── Handler ──

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: return available providers so the UI can show the selector
  if (req.method === 'GET') {
    return res.status(200).json({ providers: AVAILABLE_PROVIDERS });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = await authenticateUser(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to use AI features.' });
  }

  const creditError = await checkCredits(userId);
  if (creditError) {
    return res.status(402).json({ error: creditError });
  }

  const body = req.body;
  if (!body?.systemPrompt || !body?.messages) {
    return res.status(400).json({ error: 'Missing required fields: systemPrompt, messages' });
  }

  // Build provider order: preferred first, then fallbacks
  const preferred = body.provider;
  const order = preferred && AVAILABLE_PROVIDERS.includes(preferred)
    ? [preferred, ...AVAILABLE_PROVIDERS.filter(p => p !== preferred)]
    : [...AVAILABLE_PROVIDERS];

  if (order.length === 0) {
    return res.status(503).json({ error: 'No AI providers configured on the server.' });
  }

  // Try each provider in order
  const errors: string[] = [];
  for (const provider of order) {
    try {
      const apiResponse = await callProvider(provider, body);

      if (!apiResponse.ok) {
        const errText = await apiResponse.text().catch(() => '');
        const msg = `${provider} error ${apiResponse.status}: ${errText.slice(0, 100)}`;
        console.error(`[ai-proxy] ${msg}`);
        errors.push(msg);
        continue; // try next provider
      }

      const data = await apiResponse.json();
      const text = extractText(provider, data);

      if (!text) {
        errors.push(`${provider} returned empty response`);
        continue;
      }

      // Success — deduct actual cost
      const model = body.model || DEFAULT_MODELS[provider];
      const costCents = calculateCostCents(provider, model, data);
      await deductCredits(userId, costCents).catch(() => {});

      return res.status(200).json({
        text,
        provider,  // tell the client which provider actually served the request
        cost_cents: costCents,
        ...(errors.length > 0 ? { warnings: errors } : {}),
      });

    } catch (e: any) {
      const msg = `${provider} failed: ${e.message}`;
      console.error(`[ai-proxy] ${msg}`);
      errors.push(msg);
      continue;
    }
  }

  // All providers failed
  return res.status(502).json({
    error: 'All AI providers failed.',
    details: errors,
  });
}
