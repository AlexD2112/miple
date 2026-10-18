alter table public.profiles
  add column if not exists allow_staples boolean not null default false;
