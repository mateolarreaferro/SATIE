import { supabase, type Profile } from './supabase';

export async function getProfile(userId: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[profiles] getProfile error:', error.code, error.message);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Batched profile fetch — one round-trip for N ids.
 * Returns a record keyed by user id (missing ids simply absent from the map).
 */
export async function getProfilesByIds(ids: string[]): Promise<Record<string, Profile>> {
  if (ids.length === 0) return {};
  const unique = [...new Set(ids)];
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .in('id', unique);

    if (error) {
      console.warn('[profiles] getProfilesByIds error:', error.code, error.message);
      return {};
    }
    const out: Record<string, Profile> = {};
    for (const p of data ?? []) out[p.id] = p;
    return out;
  } catch {
    return {};
  }
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('username', username)
      .maybeSingle();

    if (error) {
      console.warn('[profiles] getProfileByUsername error:', error.code, error.message);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function upsertProfile(
  userId: string,
  updates: Partial<Pick<Profile, 'username' | 'display_name' | 'bio' | 'avatar_url'>>,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...updates })
    .select()
    .maybeSingle();

  if (error) {
    console.warn('[profiles] upsertProfile error:', error.code, error.message);
    return null;
  }
  return data;
}
