/**
 * AI auto-tagging for community samples.
 * Analyzes audio features and filename, then asks an AI provider
 * to suggest tags and a description.
 */
import { createFastProvider } from './aiProvider';
import type { AudioFeatures } from './audioAnalysis';

export interface TagSuggestion {
  tags: string[];
  description: string;
}

const TAG_SYSTEM_PROMPT = `You tag audio samples for a spatial audio platform. Your job is to write a SPECIFIC, UNIQUE description and relevant tags for each sample based on its filename and acoustic features.

CRITICAL RULES FOR DESCRIPTIONS:
- The description must be SPECIFIC to THIS particular sound. Never write generic descriptions like "An audio sample featuring..." or "A sound clip of..."
- Write as if you're telling a musician what they'll hear: "Warm sub-bass pulse with slow LFO wobble" or "Crisp finger-picked acoustic guitar, single note sustaining into silence" or "Dense city traffic hum with occasional horn honks"
- Use vivid, sonic language: what does it sound like, how does it feel, what's its character?
- Keep it to one sentence, max 15 words. Be direct.
- NEVER start with "A" or "An". Start with an adjective or noun.

Tag categories (pick 5-10 from across these):
- **source**: what made the sound (piano, field recording, synth, voice, guitar, drum machine, foley, etc.)
- **character**: sonic qualities (warm, harsh, metallic, breathy, hollow, saturated, glitchy, lo-fi, crisp)
- **mood**: emotional quality (peaceful, anxious, nostalgic, eerie, uplifting, meditative, chaotic)
- **use**: how it might be used (loop, one-shot, texture, pad, lead, bass, percussion, ambience, transition)
- **context**: where it belongs (nature, urban, underwater, cinematic, club, ritual, domestic)

Respond ONLY with valid JSON: { "tags": [...], "description": "..." }
No markdown, no explanation, just the JSON object.`;

/**
 * Ask the AI to suggest tags and a description for an audio sample.
 */
export async function suggestTags(
  filename: string,
  features: AudioFeatures,
): Promise<TagSuggestion> {
  const provider = createFastProvider();

  const featureSummary = [
    `Filename: "${filename}"`,
    `Duration: ${(features.durationMs / 1000).toFixed(1)}s`,
    `Sample rate: ${features.sampleRate}Hz, Channels: ${features.channels}`,
    `RMS level: ${features.rms} (${features.rms < 0.05 ? 'very quiet' : features.rms < 0.15 ? 'quiet' : features.rms < 0.35 ? 'moderate' : 'loud'})`,
    `Peak amplitude: ${features.peakAmplitude}`,
    `Spectral centroid: ${features.spectralCentroid}Hz (${features.spectralCentroid < 500 ? 'bass-heavy/dark' : features.spectralCentroid < 2000 ? 'mid-range' : features.spectralCentroid < 5000 ? 'bright' : 'very bright/hissy'})`,
    `Zero-crossing rate: ${features.zeroCrossingRate} (${features.zeroCrossingRate < 0.02 ? 'tonal/smooth' : features.zeroCrossingRate < 0.1 ? 'mixed' : 'noisy/percussive'})`,
  ].join('\n');

  const result = await provider.call({
    systemPrompt: TAG_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: featureSummary }],
    maxTokens: 256,
    temperature: 0.6,
  });

  try {
    // Strip any markdown wrapping
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean)
        : [],
      description: typeof parsed.description === 'string' ? parsed.description : '',
    };
  } catch {
    // Fallback: extract what we can from the filename
    const nameTokens = filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_\-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .map((t) => t.toLowerCase());

    return {
      tags: nameTokens.slice(0, 5),
      description: `Audio sample: ${filename}`,
    };
  }
}

/**
 * Compute a text embedding for a sample's metadata.
 * Uses the /api/ai proxy with an embed action.
 * Falls back gracefully if embedding is unavailable.
 */
export async function computeEmbedding(
  name: string,
  description: string,
  tags: string[],
): Promise<number[] | null> {
  const text = `${name} ${description} ${tags.join(' ')}`;

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'embed',
        text,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.embedding ?? null;
  } catch {
    return null;
  }
}
