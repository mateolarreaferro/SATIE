import { supabase, type SketchVersion } from './supabase';

/**
 * Save a version snapshot of a sketch.
 * Called on explicit save — not on autosave.
 */
export async function saveVersion(
  sketchId: string,
  title: string,
  script: string,
): Promise<SketchVersion> {
  // Get the next version number
  const { count } = await supabase
    .from('sketch_versions')
    .select('*', { count: 'exact', head: true })
    .eq('sketch_id', sketchId);

  const versionNumber = (count ?? 0) + 1;

  const { data, error } = await supabase
    .from('sketch_versions')
    .insert({
      sketch_id: sketchId,
      title,
      script,
      version_number: versionNumber,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all versions of a sketch, newest first.
 */
export async function getVersions(sketchId: string): Promise<SketchVersion[]> {
  const { data, error } = await supabase
    .from('sketch_versions')
    .select('*')
    .eq('sketch_id', sketchId)
    .order('version_number', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data ?? [];
}

/**
 * Get a specific version.
 */
export async function getVersion(versionId: string): Promise<SketchVersion | null> {
  const { data, error } = await supabase
    .from('sketch_versions')
    .select('*')
    .eq('id', versionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}
