import { supabase } from './supabase';

export async function likeSketch(userId: string, sketchId: string): Promise<void> {
  const { error } = await supabase
    .from('sketch_likes')
    .insert({ user_id: userId, sketch_id: sketchId });

  if (error) {
    // Unique constraint violation = already liked, ignore
    if (error.code === '23505') return;
    throw error;
  }

  // Increment like_count on the sketch (non-blocking)
  supabase.rpc('increment_like_count', { sketch_id: sketchId }).then(() => {}, () => {});
}

export async function unlikeSketch(userId: string, sketchId: string): Promise<void> {
  const { error } = await supabase
    .from('sketch_likes')
    .delete()
    .eq('user_id', userId)
    .eq('sketch_id', sketchId);

  if (error) throw error;

  // Decrement like_count on the sketch (non-blocking)
  supabase.rpc('decrement_like_count', { sketch_id: sketchId }).then(() => {}, () => {});
}

export async function hasUserLiked(userId: string, sketchId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('sketch_likes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('sketch_id', sketchId);

  if (error) return false;
  return (count ?? 0) > 0;
}

export async function getSketchLikeCount(sketchId: string): Promise<number> {
  const { count, error } = await supabase
    .from('sketch_likes')
    .select('*', { count: 'exact', head: true })
    .eq('sketch_id', sketchId);

  if (error) return 0;
  return count ?? 0;
}
