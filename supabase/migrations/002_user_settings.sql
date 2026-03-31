-- User settings table for API keys
-- Keys are stored encrypted at rest by Supabase (column-level encryption is optional;
-- Supabase encrypts the underlying storage by default).

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  anthropic_key text default '',
  elevenlabs_key text default '',
  openai_key text default '',
  gemini_key text default '',
  updated_at timestamptz default now()
);

alter table public.user_settings enable row level security;

-- Users can only read/write their own settings
create policy "Users can read own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own settings"
  on public.user_settings for update
  using (auth.uid() = user_id);
