import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase credentials not found. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  );
}

// Use a placeholder URL when env vars are missing (e.g. in CI/test) so createClient doesn't throw
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
);

export interface Sketch {
  id: string;
  user_id: string;
  title: string;
  script: string;
  is_public: boolean;
  forked_from: string | null;
  like_count: number;
  fork_count: number;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

export interface SketchVersion {
  id: string;
  sketch_id: string;
  script: string;
  title: string;
  version_number: number;
  created_at: string;
}

export interface SketchLike {
  user_id: string;
  sketch_id: string;
  created_at: string;
}
