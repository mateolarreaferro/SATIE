/**
 * Community Sample Library — CRUD + search for shared audio samples.
 * Samples are stored in a `community-samples` bucket at: {user_id}/{uuid}_{filename}
 * A `community_samples` table tracks metadata, tags, and embeddings.
 */
import { supabase } from './supabase';
import { getCachedSample, cacheSample } from './sampleCache';

const BUCKET = 'community-samples';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const COMMUNITY_PREFIX = 'community/';

export interface CommunitySample {
  id: string;
  uploader_id: string;
  name: string;
  description: string;
  tags: string[];
  storage_path: string;
  content_hash: string | null;
  size_bytes: number;
  duration_ms: number;
  waveform_peaks: number[] | null;
  download_count: number;
  created_at: string;
  // Joined fields (optional, from profile lookups)
  uploader_username?: string;
  uploader_avatar_url?: string;
  // Search result fields
  similarity?: number;
}

export interface UploadParams {
  userId: string;
  name: string;
  description: string;
  tags: string[];
  data: ArrayBuffer;
  durationMs: number;
  waveformPeaks: number[];
  embedding?: number[];
}

/** Compute a content hash of the first 64KB for dedup. */
async function computeContentHash(data: ArrayBuffer): Promise<string> {
  const slice = data.slice(0, 65536);
  const hashBuffer = await crypto.subtle.digest('SHA-256', slice);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Upload a sample to the community library. */
export async function uploadCommunitySample(params: UploadParams): Promise<CommunitySample> {
  const { userId, name, description, tags, data, durationMs, waveformPeaks, embedding } = params;

  if (data.byteLength > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(data.byteLength / 1024 / 1024).toFixed(1)}MB (max 50MB)`);
  }

  // Check for duplicates
  const contentHash = await computeContentHash(data);
  const { data: existing } = await supabase
    .from('community_samples')
    .select('id, name')
    .eq('content_hash', contentHash)
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error(`A similar sample already exists: "${existing[0].name}"`);
  }

  // Rate limit: max 20 uploads per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('community_samples')
    .select('id', { count: 'exact', head: true })
    .eq('uploader_id', userId)
    .gte('created_at', oneHourAgo);

  if (count !== null && count >= 20) {
    throw new Error('Upload rate limit reached (20 per hour). Please try again later.');
  }

  // Upload to storage
  const fileId = crypto.randomUUID();
  const safeName = encodeURIComponent(name.replace(/\//g, '_'));
  const storagePath = `${userId}/${fileId}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, data, {
      contentType: 'audio/wav',
      upsert: false,
    });

  if (uploadError) throw uploadError;

  // Insert metadata
  const row: Record<string, unknown> = {
    uploader_id: userId,
    name,
    description,
    tags,
    storage_path: storagePath,
    content_hash: contentHash,
    size_bytes: data.byteLength,
    duration_ms: durationMs,
    waveform_peaks: waveformPeaks,
  };

  if (embedding) {
    row.embedding = JSON.stringify(embedding);
  }

  const { data: inserted, error: dbError } = await supabase
    .from('community_samples')
    .insert(row)
    .select()
    .single();

  if (dbError) {
    console.error('[CommunitySamples] DB insert failed:', dbError, 'Row:', row);
    // Clean up storage on DB failure
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw dbError;
  }

  // Cache locally
  const cacheKey = `${COMMUNITY_PREFIX}${name}`;
  await cacheSample(cacheKey, data);

  return inserted as CommunitySample;
}

/** Update a community sample's embedding (called after tagging is confirmed). */
export async function updateSampleEmbedding(
  sampleId: string,
  embedding: number[],
): Promise<void> {
  const { error } = await supabase
    .from('community_samples')
    .update({ embedding: JSON.stringify(embedding) })
    .eq('id', sampleId);

  if (error) throw error;
}

/** Download a community sample's audio data. Checks IndexedDB cache first. */
export async function downloadCommunitySample(sample: CommunitySample): Promise<ArrayBuffer> {
  const cacheKey = `${COMMUNITY_PREFIX}${sample.name}`;

  // Check local cache
  const cached = await getCachedSample(cacheKey);
  if (cached) return cached;

  // Download from storage
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(sample.storage_path);

  if (error) throw error;
  if (!data) throw new Error(`No data returned for ${sample.name}`);

  const arrayBuffer = await data.arrayBuffer();

  // Cache locally
  await cacheSample(cacheKey, arrayBuffer);

  // Increment download counter
  await supabase.rpc('increment_community_download', { sample_id: sample.id });

  return arrayBuffer;
}

/** Download a community sample by name (for lazy loading from engine). */
export async function downloadCommunitySampleByName(name: string): Promise<ArrayBuffer | null> {
  const cacheKey = `${COMMUNITY_PREFIX}${name}`;

  // Check local cache
  const cached = await getCachedSample(cacheKey);
  if (cached) return cached;

  // Look up by name
  const { data: samples } = await supabase
    .from('community_samples')
    .select('*')
    .eq('name', name)
    .limit(1);

  if (!samples || samples.length === 0) return null;

  return downloadCommunitySample(samples[0] as CommunitySample);
}

/** Delete a community sample (owner only). */
export async function deleteCommunitySample(sample: CommunitySample): Promise<void> {
  await supabase.storage.from(BUCKET).remove([sample.storage_path]);
  const { error } = await supabase
    .from('community_samples')
    .delete()
    .eq('id', sample.id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Search functions
// ---------------------------------------------------------------------------

/** Search community samples by tags (array containment). */
export async function searchByTags(
  tags: string[],
  limit = 20,
): Promise<CommunitySample[]> {
  if (tags.length === 0) return [];

  // Search for samples that contain ANY of the provided tags
  const { data, error } = await supabase
    .from('community_samples')
    .select('*')
    .overlaps('tags', tags)
    .order('download_count', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CommunitySample[];
}

/** Full-text search on name + description. */
export async function searchByText(
  query: string,
  limit = 20,
): Promise<CommunitySample[]> {
  if (!query.trim()) return [];

  const { data, error } = await supabase
    .rpc('search_community_samples', {
      query,
      max_results: limit,
    });

  if (error) throw error;
  return (data ?? []) as CommunitySample[];
}

/** Semantic vector search using pgvector cosine similarity. */
export async function searchByEmbedding(
  embedding: number[],
  limit = 20,
  threshold = 0.5,
): Promise<CommunitySample[]> {
  const { data, error } = await supabase
    .rpc('search_community_by_embedding', {
      query_embedding: JSON.stringify(embedding),
      match_threshold: threshold,
      max_results: limit,
    });

  if (error) throw error;
  return (data ?? []) as CommunitySample[];
}

/** Get popular community samples. */
export async function getPopularSamples(limit = 50): Promise<CommunitySample[]> {
  const { data, error } = await supabase
    .from('community_samples')
    .select('*')
    .order('download_count', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CommunitySample[];
}

/** Get recent community samples. */
export async function getRecentSamples(limit = 50): Promise<CommunitySample[]> {
  const { data, error } = await supabase
    .from('community_samples')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CommunitySample[];
}

/** Get all community samples uploaded by a specific user. */
export async function getUserCommunitySamples(userId: string): Promise<CommunitySample[]> {
  const { data, error } = await supabase
    .from('community_samples')
    .select('*')
    .eq('uploader_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as CommunitySample[];
}

/** Get a single community sample by ID. */
export async function getCommunitySample(sampleId: string): Promise<CommunitySample | null> {
  const { data, error } = await supabase
    .from('community_samples')
    .select('*')
    .eq('id', sampleId)
    .single();

  if (error) return null;
  return data as CommunitySample;
}

/** Get all unique tags with their usage counts. */
export async function getPopularTags(limit = 30): Promise<{ tag: string; count: number }[]> {
  // Unnest all tags and count occurrences
  const { data, error } = await supabase
    .from('community_samples')
    .select('tags');

  if (error) throw error;

  const tagCounts = new Map<string, number>();
  for (const row of data ?? []) {
    for (const tag of (row as { tags: string[] }).tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Get total count of community samples. */
export async function getCommunityCount(): Promise<number> {
  const { count, error } = await supabase
    .from('community_samples')
    .select('id', { count: 'exact', head: true });

  if (error) return 0;
  return count ?? 0;
}
