/**
 * Combined tag + semantic vector search for community samples.
 * Used by AI generation pipeline to find relevant community samples.
 */
import { searchByTags, searchByText, searchByEmbedding, type CommunitySample } from './communitySamples';
import { computeEmbedding } from './communityTagging';

// LRU cache for recent search results
const cache = new Map<string, { samples: CommunitySample[]; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute
const CACHE_MAX = 50;

function cacheKey(query: string, tags: string[]): string {
  return `${query}|${tags.sort().join(',')}`;
}

function getCached(key: string): CommunitySample[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.samples;
}

function setCache(key: string, samples: CommunitySample[]) {
  if (cache.size >= CACHE_MAX) {
    // Evict oldest
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { samples, ts: Date.now() });
}

/**
 * Search community samples using both tags and semantic similarity.
 * Returns deduplicated, re-ranked results.
 */
export async function searchCommunity(
  prompt: string,
  soundKeywords: string[],
  limit = 10,
): Promise<CommunitySample[]> {
  const key = cacheKey(prompt, soundKeywords);
  const cached = getCached(key);
  if (cached) return cached;

  // Run tag search and text search in parallel
  const searches: Promise<CommunitySample[]>[] = [];

  if (soundKeywords.length > 0) {
    searches.push(searchByTags(soundKeywords, limit));
  }

  if (prompt.trim()) {
    searches.push(searchByText(prompt, limit));
  }

  // Also try semantic search if we can compute an embedding
  const embeddingPromise = computeEmbedding(prompt, '', soundKeywords);
  searches.push(
    embeddingPromise.then(async (emb) => {
      if (!emb) return [];
      return searchByEmbedding(emb, limit, 0.5);
    }),
  );

  const results = await Promise.all(searches);

  // Merge and deduplicate
  const seen = new Set<string>();
  const merged: CommunitySample[] = [];

  for (const resultSet of results) {
    for (const sample of resultSet) {
      if (!seen.has(sample.id)) {
        seen.add(sample.id);
        merged.push(sample);
      }
    }
  }

  // Re-rank: prioritize samples that appeared in multiple searches + high downloads
  const countMap = new Map<string, number>();
  for (const resultSet of results) {
    for (const sample of resultSet) {
      countMap.set(sample.id, (countMap.get(sample.id) ?? 0) + 1);
    }
  }

  merged.sort((a, b) => {
    const countDiff = (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0);
    if (countDiff !== 0) return countDiff;
    return b.download_count - a.download_count;
  });

  const final = merged.slice(0, limit);
  setCache(key, final);
  return final;
}

/**
 * Format community samples for inclusion in AI system prompt.
 */
export function formatCommunitySamplesForPrompt(samples: CommunitySample[]): string {
  if (samples.length === 0) return '';

  const lines = samples.map(s =>
    `  - community/${s.name} (tags: ${s.tags.slice(0, 4).join(', ')})`
  );

  return `\nCOMMUNITY SAMPLES (shared by users — use with community/ prefix, they will be auto-downloaded):\n${lines.join('\n')}\n\nYou may use community samples when they match the user's intent. Prefer them over gen for common sounds.`;
}
