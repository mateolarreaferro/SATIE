import { supabase, type Sketch, type SketchListItem } from './supabase';
import { cachedQuery, invalidateCache } from './queryCache';

const LIST_COLS =
  'id, user_id, title, script_preview, is_public, forked_from, like_count, fork_count, created_at, updated_at';

const USER_LIST_TTL = 30_000;
const PUBLIC_LIST_TTL = 60_000;

const userKey = (userId: string) => `sketches:user:${userId}`;
const publicKey = () => 'sketches:public';
const userPublicKey = (userId: string) => `sketches:user-public:${userId}`;

function invalidateUserCaches(userId: string | null | undefined) {
  if (userId) {
    invalidateCache(userKey(userId));
    invalidateCache(userPublicKey(userId));
  }
  invalidateCache(publicKey());
}

/** Full sketch (with script) — for Editor / detail views. */
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

/** Full public sketch — for SketchView. */
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

/** List view of a user's sketches — omits full script. Cached in sessionStorage. */
export async function getUserSketchesList(userId: string): Promise<SketchListItem[]> {
  return cachedQuery(userKey(userId), USER_LIST_TTL, async () => {
    const { data, error } = await supabase
      .from('sketches')
      .select(LIST_COLS)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    return (data ?? []) as SketchListItem[];
  });
}

/** List view of public sketches — omits full script. Cached in sessionStorage. */
export async function getPublicSketchesList(): Promise<SketchListItem[]> {
  return cachedQuery(publicKey(), PUBLIC_LIST_TTL, async () => {
    const { data, error } = await supabase
      .from('sketches')
      .select(LIST_COLS)
      .eq('is_public', true)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return (data ?? []) as SketchListItem[];
  });
}

/** List view of a single user's public sketches — for profile pages. */
export async function getUserPublicSketchesList(userId: string): Promise<SketchListItem[]> {
  return cachedQuery(userPublicKey(userId), USER_LIST_TTL, async () => {
    const { data, error } = await supabase
      .from('sketches')
      .select(LIST_COLS)
      .eq('user_id', userId)
      .eq('is_public', true)
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    return (data ?? []) as SketchListItem[];
  });
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
  invalidateUserCaches(userId);
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
  invalidateUserCaches(data?.user_id);
  return data;
}

export async function deleteSketch(id: string): Promise<void> {
  const { data: existing } = await supabase
    .from('sketches')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  const { error } = await supabase.from('sketches').delete().eq('id', id);
  if (error) throw error;
  invalidateUserCaches(existing?.user_id);
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

  invalidateUserCaches(userId);
  invalidateUserCaches(sketch.user_id);
  return data;
}
