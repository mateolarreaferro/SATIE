/**
 * Unified AI provider abstraction for Satie.
 * Supports Anthropic (Claude), OpenAI, and Google Gemini.
 *
 * When the user has their own API key → direct calls (no proxy).
 * When they don't → routes through /api/ai proxy (server-side keys).
 */

import { supabase } from './supabase';

export type AIProviderType = 'anthropic' | 'openai' | 'gemini';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AICallOptions {
  systemPrompt: string;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface AICallCost {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costCents: number;
  model: string;
  provider: AIProviderType;
}

export interface AIProvider {
  readonly name: string;
  readonly type: AIProviderType;
  call(options: AICallOptions): Promise<string>;
}

// ── Cost tracking ────────────────────────────────────────────

// Pricing per million tokens (dollars)
const PRICING: Record<string, { input: number; output: number; cachedInput: number }> = {
  'claude-sonnet-4-20250514':  { input: 3.0,  output: 15.0, cachedInput: 0.30 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0,  cachedInput: 0.08 },
  'gpt-4o':                    { input: 2.5,  output: 10.0, cachedInput: 1.25 },
  'gpt-4o-mini':               { input: 0.15, output: 0.60, cachedInput: 0.075 },
  'gemini-2.0-flash':          { input: 0.10, output: 0.40, cachedInput: 0.025 },
  'gemini-2.0-flash-lite':     { input: 0.0,  output: 0.0,  cachedInput: 0.0 },
};

function calculateCost(model: string, provider: AIProviderType, inputTokens: number, outputTokens: number, cachedTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  const uncachedInput = inputTokens - cachedTokens;
  return (uncachedInput / 1e6) * p.input + (cachedTokens / 1e6) * p.cachedInput + (outputTokens / 1e6) * p.output;
}

// Session cost accumulator
let _sessionCosts: AICallCost[] = [];

export function trackCost(cost: AICallCost): void {
  _sessionCosts.push(cost);
  const total = getSessionCostCents();
  console.log(
    `[Satie Cost] ${cost.provider}/${cost.model} — $${(cost.costCents / 100).toFixed(4)} | input=${cost.inputTokens} (cached=${cost.cachedTokens}) output=${cost.outputTokens} | session total: $${(total / 100).toFixed(4)}`,
  );
}

export function getSessionCosts(): AICallCost[] {
  return _sessionCosts;
}

export function getSessionCostCents(): number {
  return _sessionCosts.reduce((sum, c) => sum + c.costCents, 0);
}

export function resetSessionCosts(): void {
  _sessionCosts = [];
}

// ── Session budget / cost guard ──────────────────────────────

const DEFAULT_BUDGET_CENTS = 50; // $0.50 default session budget
const LS_BUDGET = 'satie-session-budget-cents';

export function getSessionBudgetCents(): number {
  const stored = localStorage.getItem(LS_BUDGET);
  return stored ? Number(stored) : DEFAULT_BUDGET_CENTS;
}

export function setSessionBudgetCents(cents: number): void {
  localStorage.setItem(LS_BUDGET, String(Math.max(0, cents)));
}

/**
 * Check if the session cost has exceeded the budget.
 * Returns { over, current, budget } — caller decides how to handle.
 */
export function checkBudget(): { over: boolean; currentCents: number; budgetCents: number } {
  const currentCents = getSessionCostCents();
  const budgetCents = getSessionBudgetCents();
  return { over: currentCents >= budgetCents, currentCents, budgetCents };
}

// ── Proxied provider (uses /api/ai with Supabase JWT) ──────

export class ProxiedProvider implements AIProvider {
  readonly name: string;
  readonly type: AIProviderType;
  private model: string;

  constructor(type: AIProviderType, model?: string) {
    this.type = type;
    this.name = type === 'anthropic' ? 'Claude' : type === 'openai' ? 'OpenAI' : 'Gemini';
    this.model = model || this.defaultModel();
  }

  private defaultModel(): string {
    switch (this.type) {
      case 'anthropic': return 'claude-haiku-4-5-20251001';
      case 'openai': return 'gpt-4o-mini';
      case 'gemini': return 'gemini-2.0-flash';
    }
  }

  private fastModel(): string {
    switch (this.type) {
      case 'anthropic': return 'claude-haiku-4-5-20251001';
      case 'openai': return 'gpt-4o-mini';
      case 'gemini': return 'gemini-2.0-flash-lite';
    }
  }

  async call(options: AICallOptions): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      throw new Error('Sign in to use AI features.');
    }

    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        provider: this.type,
        model: this.model,
        systemPrompt: options.systemPrompt,
        messages: options.messages,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: `Proxy error ${response.status}` }));
      throw new Error(err.error || `AI proxy error (${response.status})`);
    }

    const data = await response.json();
    // Log which provider actually served the request + any fallback warnings
    if (data.provider && data.provider !== this.type) {
      console.log(`[Satie] Request routed to ${data.provider} (${this.type} was unavailable)`);
    }
    if (data.warnings?.length) {
      console.warn('[Satie] Provider warnings:', data.warnings);
    }
    // Track cost from proxy response
    if (data.cost_cents != null) {
      trackCost({
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costCents: data.cost_cents,
        model: this.model,
        provider: (data.provider ?? this.type) as AIProviderType,
      });
    }
    return data.text ?? '';
  }

  fast(): ProxiedProvider {
    return new ProxiedProvider(this.type, this.fastModel());
  }
}

// ── Anthropic (Claude) — direct API call ───────────────────

const ANTHROPIC_MODELS = {
  main: 'claude-sonnet-4-20250514',
  fast: 'claude-haiku-4-5-20251001',
} as const;

export class AnthropicProvider implements AIProvider {
  readonly name = 'Claude';
  readonly type: AIProviderType = 'anthropic';

  constructor(
    private apiKey: string,
    private model: string = ANTHROPIC_MODELS.main,
  ) {}

  async call(options: AICallOptions): Promise<string> {
    // Split system prompt for prompt caching: static prefix (cached at 90% discount)
    // + dynamic suffix (per-request). The STATIC_SYSTEM_PROMPT constant is ~2500 tokens
    // and identical across all calls — perfect for Anthropic's automatic prefix caching.
    // We use cache_control breakpoints to explicitly mark the cache boundary.
    const { staticPrefix, dynamicSuffix } = this.splitSystemPrompt(options.systemPrompt);

    const systemBlocks: any[] = [
      {
        type: 'text',
        text: staticPrefix,
        cache_control: { type: 'ephemeral' },
      },
    ];
    if (dynamicSuffix) {
      systemBlocks.push({ type: 'text', text: dynamicSuffix });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? 2048,
        system: systemBlocks,
        messages: options.messages,
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API ${response.status}`);
    const data = await response.json();

    if (data.usage) {
      const u = data.usage;
      const cachedTokens = u.cache_read_input_tokens ?? 0;
      const costCents = calculateCost(this.model, 'anthropic', u.input_tokens, u.output_tokens, cachedTokens) * 100;
      trackCost({
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cachedTokens,
        costCents,
        model: this.model,
        provider: 'anthropic',
      });
    }

    return data.content?.[0]?.text ?? '';
  }

  /**
   * Split system prompt at the boundary between the static DSL reference
   * and the dynamic per-request content (samples, examples, etc.).
   */
  private splitSystemPrompt(prompt: string): { staticPrefix: string; dynamicSuffix: string } {
    // The static prompt ends right before the dynamic audio library / examples section.
    // We look for the visual tokens line (last line of STATIC_SYSTEM_PROMPT) as the split marker.
    const marker = 'Valid visual tokens: trail, sphere, cube, none. Combine them: "visual trail sphere", "visual trail cube".';
    const idx = prompt.indexOf(marker);
    if (idx === -1) {
      // Fallback: no split (e.g. repair prompt) — send as single block
      return { staticPrefix: prompt, dynamicSuffix: '' };
    }
    const splitAt = idx + marker.length;
    return {
      staticPrefix: prompt.slice(0, splitAt),
      dynamicSuffix: prompt.slice(splitAt).trim(),
    };
  }

  fast(): AnthropicProvider {
    return new AnthropicProvider(this.apiKey, ANTHROPIC_MODELS.fast);
  }
}

// ── OpenAI — direct API call ───────────────────────────────

const OPENAI_MODELS = {
  main: 'gpt-4o',
  fast: 'gpt-4o-mini',
} as const;

export class OpenAIProvider implements AIProvider {
  readonly name = 'OpenAI';
  readonly type: AIProviderType = 'openai';

  constructor(
    private apiKey: string,
    private model: string = OPENAI_MODELS.main,
  ) {}

  async call(options: AICallOptions): Promise<string> {
    const messages = [
      { role: 'system' as const, content: options.systemPrompt },
      ...options.messages,
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        messages,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API ${response.status}`);
    const data = await response.json();

    if (data.usage) {
      const u = data.usage;
      const cachedTokens = u.prompt_tokens_details?.cached_tokens ?? 0;
      const costCents = calculateCost(this.model, 'openai', u.prompt_tokens, u.completion_tokens, cachedTokens) * 100;
      trackCost({
        inputTokens: u.prompt_tokens,
        outputTokens: u.completion_tokens,
        cachedTokens,
        costCents,
        model: this.model,
        provider: 'openai',
      });
    }

    return data.choices?.[0]?.message?.content ?? '';
  }

  fast(): OpenAIProvider {
    return new OpenAIProvider(this.apiKey, OPENAI_MODELS.fast);
  }
}

// ── Google Gemini — direct API call ────────────────────────

const GEMINI_MODELS = {
  main: 'gemini-2.0-flash',
  fast: 'gemini-2.0-flash-lite',
} as const;

export class GeminiProvider implements AIProvider {
  readonly name = 'Gemini';
  readonly type: AIProviderType = 'gemini';

  constructor(
    private apiKey: string,
    private model: string = GEMINI_MODELS.main,
  ) {}

  async call(options: AICallOptions): Promise<string> {
    const contents = options.messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: options.systemPrompt }] },
          contents,
          generationConfig: {
            maxOutputTokens: options.maxTokens ?? 2048,
            temperature: options.temperature ?? 0.7,
          },
        }),
      },
    );

    if (!response.ok) throw new Error(`Gemini API ${response.status}`);
    const data = await response.json();

    if (data.usageMetadata) {
      const u = data.usageMetadata;
      const cachedTokens = u.cachedContentTokenCount ?? 0;
      const costCents = calculateCost(this.model, 'gemini', u.promptTokenCount ?? 0, u.candidatesTokenCount ?? 0, cachedTokens) * 100;
      trackCost({
        inputTokens: u.promptTokenCount ?? 0,
        outputTokens: u.candidatesTokenCount ?? 0,
        cachedTokens,
        costCents,
        model: this.model,
        provider: 'gemini',
      });
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  fast(): GeminiProvider {
    return new GeminiProvider(this.apiKey, GEMINI_MODELS.fast);
  }
}

// ── Provider factory ────────────────────────────────────────

const LS_PROVIDER = 'satie-ai-provider';

export function getPreferredProvider(): AIProviderType {
  return (localStorage.getItem(LS_PROVIDER) as AIProviderType) || 'anthropic';
}

export function setPreferredProvider(provider: AIProviderType): void {
  localStorage.setItem(LS_PROVIDER, provider);
}

/**
 * Create an AI provider.
 * If the user has their own API key → direct calls (faster, no rate limit).
 * If not → proxy through /api/ai (server-side keys, rate-limited).
 */
export function createProvider(preferred?: AIProviderType): AIProvider {
  const pref = preferred ?? getPreferredProvider();
  const anthropicKey = localStorage.getItem('satie-anthropic-key') ?? '';
  const openaiKey = localStorage.getItem('satie-openai-key') ?? '';
  const geminiKey = localStorage.getItem('satie-gemini-key') ?? '';

  // Try preferred provider with user's own key first
  const order: { type: AIProviderType; key: string; factory: (k: string) => AIProvider }[] = [
    { type: 'anthropic', key: anthropicKey, factory: (k) => new AnthropicProvider(k) },
    { type: 'openai', key: openaiKey, factory: (k) => new OpenAIProvider(k) },
    { type: 'gemini', key: geminiKey, factory: (k) => new GeminiProvider(k) },
  ];

  // Put preferred first
  order.sort((a, b) => (a.type === pref ? -1 : b.type === pref ? 1 : 0));

  for (const { key, factory } of order) {
    if (key) return factory(key);
  }

  // No user keys — fall back to proxy
  return new ProxiedProvider(pref);
}

/**
 * Create a fast (cheaper/faster) provider variant for verification/repair.
 */
export function createFastProvider(preferred?: AIProviderType): AIProvider {
  const provider = createProvider(preferred);
  if ('fast' in provider && typeof provider.fast === 'function') {
    return (provider as any).fast();
  }
  return provider;
}

/**
 * Classify whether a prompt needs Sonnet (complex) or Haiku (simple).
 *
 * Simple (Haiku): tweaks, corrections, small edits to existing scripts
 *   e.g. "make it louder", "add reverb", "change the pitch"
 *
 * Complex (Sonnet): creating from scratch, multi-voice compositions, rich descriptions
 *   e.g. "create a rainforest at night with birds and insects"
 */
export function isComplexPrompt(prompt: string, hasExistingScript: boolean): boolean {
  const lower = prompt.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // Short edits to existing scripts → simple
  if (hasExistingScript && wordCount <= 8) return false;

  // Explicit simple modification keywords
  const simplePatterns = /^(make\s+it|change|set|increase|decrease|add\s+(more\s+)?reverb|add\s+(more\s+)?delay|remove|mute|louder|quieter|slower|faster|fix|adjust|tweak|turn\s+(up|down))/;
  if (hasExistingScript && simplePatterns.test(lower)) return false;

  // Creating from scratch → complex
  if (!hasExistingScript) return true;

  // Long descriptive prompts → complex
  if (wordCount >= 15) return true;

  // Keywords suggesting a full composition
  const complexPatterns = /\b(create|compose|build|generate|design|imagine|soundscape|scene|environment|ambient|world|landscape|forest|ocean|city|space|concert|orchestra)\b/;
  if (complexPatterns.test(lower)) return true;

  // Default: simple for existing scripts, complex for new
  return !hasExistingScript;
}

/**
 * Create a provider that automatically selects the right model tier
 * based on prompt complexity. Haiku for simple edits (~$0.02/call),
 * Sonnet for complex compositions (~$0.15/call with caching).
 */
export function createSmartProvider(prompt: string, hasExistingScript: boolean, preferred?: AIProviderType): AIProvider {
  const complex = isComplexPrompt(prompt, hasExistingScript);
  if (complex) {
    return createProvider(preferred);
  }
  return createFastProvider(preferred);
}

/**
 * Get available providers (those with API keys configured).
 * Always includes 'proxy' as an option for signed-in users.
 */
export function getAvailableProviders(): AIProviderType[] {
  const available: AIProviderType[] = [];
  if (localStorage.getItem('satie-anthropic-key')) available.push('anthropic');
  if (localStorage.getItem('satie-openai-key')) available.push('openai');
  if (localStorage.getItem('satie-gemini-key')) available.push('gemini');
  // Proxy is always available for signed-in users (even if no keys)
  if (available.length === 0) available.push('anthropic');
  return available;
}

/**
 * Check if the user has any API key configured.
 * If not, they'll use the proxy (requires sign-in).
 */
export function hasUserApiKey(): boolean {
  return !!(
    localStorage.getItem('satie-anthropic-key') ||
    localStorage.getItem('satie-openai-key') ||
    localStorage.getItem('satie-gemini-key')
  );
}

/** Cache for server-side available providers */
let _serverProviders: AIProviderType[] | null = null;

/**
 * Fetch which AI providers are configured on the server (for proxy users).
 * Cached after first call.
 */
export async function getServerProviders(): Promise<AIProviderType[]> {
  if (_serverProviders) return _serverProviders;
  try {
    const res = await fetch('/api/ai');
    if (res.ok) {
      const data = await res.json();
      _serverProviders = data.providers ?? [];
      return _serverProviders!;
    }
  } catch { /* proxy not deployed */ }
  return [];
}
