import { supabase, type Sketch } from './supabase';

export async function getUserSketches(userId: string): Promise<Sketch[]> {
  const { data, error } = await supabase
    .from('sketches')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getSketch(id: string): Promise<Sketch | null> {
  const { data, error } = await supabase
    .from('sketches')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.warn('[sketches] getSketch error:', error.code, error.message);
    return null;
  }
  return data;
}

export async function createSketch(
  userId: string,
  title: string,
  script: string,
): Promise<Sketch> {
  const { data, error } = await supabase
    .from('sketches')
    .insert({ user_id: userId, title, script })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSketch(
  id: string,
  updates: Partial<Pick<Sketch, 'title' | 'script' | 'is_public'>>,
): Promise<Sketch> {
  const { data, error } = await supabase
    .from('sketches')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSketch(id: string): Promise<void> {
  const { error } = await supabase.from('sketches').delete().eq('id', id);
  if (error) throw error;
}

export async function getPublicSketches(): Promise<Sketch[]> {
  const { data, error } = await supabase
    .from('sketches')
    .select('*')
    .eq('is_public', true)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data ?? [];
}

export async function getPublicSketch(id: string): Promise<Sketch | null> {
  const { data, error } = await supabase
    .from('sketches')
    .select('*')
    .eq('id', id)
    .eq('is_public', true)
    .maybeSingle();

  if (error) {
    console.warn('[sketches] getPublicSketch error:', error.code, error.message);
    return null;
  }
  return data;
}

export async function forkSketch(userId: string, sketch: Sketch): Promise<Sketch> {
  const { data, error } = await supabase
    .from('sketches')
    .insert({
      user_id: userId,
      title: `Fork of ${sketch.title}`,
      script: sketch.script,
      forked_from: sketch.id,
    })
    .select()
    .single();

  if (error) throw error;

  // Increment fork_count on the source sketch (non-blocking)
  Promise.resolve(supabase.rpc('increment_fork_count', { sketch_id: sketch.id })).catch(() => {});

  return data;
}
