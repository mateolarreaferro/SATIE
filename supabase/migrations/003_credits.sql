-- Credits table — prepaid balance for AI and audio generation
create table if not exists public.credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_cents integer not null default 0,  -- balance in cents ($20 = 2000)
  updated_at timestamptz default now()
);

alter table public.credits enable row level security;

-- Users can read their own balance
create policy "Users can read own credits"
  on public.credits for select using (auth.uid() = user_id);

-- Only the service role (webhook/proxy) can modify credits
-- No user-facing insert/update policies
