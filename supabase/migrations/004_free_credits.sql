-- Track whether a user has claimed their free signup credits
alter table public.credits add column if not exists free_credits_claimed boolean not null default false;
