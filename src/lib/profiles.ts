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

export async function getUserPublicSketches(userId: string): Promise<import('./supabase').Sketch[]> {
  const { data, error } = await supabase
    .from('sketches')
    .select('*')
    .eq('user_id', userId)
    .eq('is_public', true)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}
