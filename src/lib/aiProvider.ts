/**
 * Unified AI provider abstraction for Satie.
 * Supports Anthropic (Claude), OpenAI, and Google Gemini.
 */

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

export interface AIProvider {
  readonly name: string;
  readonly type: AIProviderType;
  call(options: AICallOptions): Promise<string>;
}

// ── Anthropic (Claude) ─────────────────────────────────────

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
        system: options.systemPrompt,
        messages: options.messages,
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API ${response.status}`);
    const data = await response.json();
    return data.content?.[0]?.text ?? '';
  }

  /** Create a fast (Haiku) variant for repair/verification tasks. */
  fast(): AnthropicProvider {
    return new AnthropicProvider(this.apiKey, ANTHROPIC_MODELS.fast);
  }
}

// ── OpenAI ──────────────────────────────────────────────────

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
    return data.choices?.[0]?.message?.content ?? '';
  }

  fast(): OpenAIProvider {
    return new OpenAIProvider(this.apiKey, OPENAI_MODELS.fast);
  }
}

// ── Google Gemini ───────────────────────────────────────────

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
 * Create an AI provider from the user's stored keys.
 * Falls through available providers if the preferred one has no key.
 */
export function createProvider(preferred?: AIProviderType): AIProvider {
  const pref = preferred ?? getPreferredProvider();
  const anthropicKey = localStorage.getItem('satie-anthropic-key') ?? '';
  const openaiKey = localStorage.getItem('satie-openai-key') ?? '';
  const geminiKey = localStorage.getItem('satie-gemini-key') ?? '';

  // Try preferred provider first, then fall back
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

  throw new Error('No AI provider configured. Add an API key in dashboard settings.');
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
 * Get available providers (those with API keys configured).
 */
export function getAvailableProviders(): AIProviderType[] {
  const available: AIProviderType[] = [];
  if (localStorage.getItem('satie-anthropic-key')) available.push('anthropic');
  if (localStorage.getItem('satie-openai-key')) available.push('openai');
  if (localStorage.getItem('satie-gemini-key')) available.push('gemini');
  return available;
}
