-- Miple MVP schema
-- Run with `supabase db push` or paste into the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shelf life lookup (receipts don't print expiry dates)
-- ---------------------------------------------------------------------------
create table public.shelf_life (
  category text primary key,
  days     int  not null check (days > 0)
);

insert into public.shelf_life (category, days) values
  ('leafy_greens', 5),
  ('berries', 4),
  ('fresh_fruit', 7),
  ('fresh_vegetables', 7),
  ('root_vegetables', 21),
  ('herbs', 5),
  ('raw_poultry', 2),
  ('raw_meat', 3),
  ('raw_seafood', 2),
  ('deli_meat', 5),
  ('dairy_milk', 7),
  ('dairy_cheese', 21),
  ('yogurt', 14),
  ('eggs', 28),
  ('tofu', 7),
  ('bread', 5),
  ('tortillas', 14),
  ('cooked_leftovers', 4),
  ('frozen', 90),
  ('canned', 365),
  ('dry_goods', 180),
  ('condiments', 90),
  ('snacks', 60),
  ('beverages', 30),
  ('other', 7);

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  display_name      text,
  diet              text not null default 'omnivore',   -- omnivore | vegetarian | vegan | pescatarian | keto | ...
  allergies         text[] not null default '{}',       -- canonical keys, see server/src/domain/allergens.ts
  dislikes          text[] not null default '{}',
  calorie_target    int  not null default 2000,
  protein_target_g  int  not null default 120,
  carbs_target_g    int  not null default 220,
  fat_target_g      int  not null default 65,
  phone             text unique,                         -- E.164, used for Photon nudges
  nudges_enabled    boolean not null default true,
  healthkit_enabled boolean not null default false,
  timezone          text not null default 'America/New_York',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Auto-create a profile row on sign-up
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Receipts and pantry items
-- ---------------------------------------------------------------------------
create table public.receipts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  store        text,
  purchased_at date not null default current_date,
  total        numeric(10, 2),
  created_at   timestamptz not null default now()
);

create table public.items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  receipt_id       uuid references public.receipts (id) on delete set null,
  name             text not null,
  raw_name         text,                                 -- e.g. "ORG SPNCH 5OZ"
  category         text not null default 'other' references public.shelf_life (category),
  quantity         numeric(10, 2) not null default 1,
  unit             text,
  price            numeric(10, 2),
  purchase_date    date not null default current_date,
  estimated_expiry date,
  status           text not null default 'active' check (status in ('active', 'used', 'wasted')),
  source           text not null default 'manual' check (source in ('receipt', 'manual', 'leftover', 'fridge_scan')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index items_user_status_expiry on public.items (user_id, status, estimated_expiry);

-- Expiry = purchase date + category shelf life, unless the user (or LLM) set one.
create function public.items_set_expiry() returns trigger
language plpgsql as $$
begin
  if new.estimated_expiry is null then
    select new.purchase_date + s.days into new.estimated_expiry
    from public.shelf_life s where s.category = new.category;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger items_set_expiry
  before insert or update on public.items
  for each row execute function public.items_set_expiry();

-- ---------------------------------------------------------------------------
-- Recipes and meal slots
-- ---------------------------------------------------------------------------
create table public.recipes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  -- [{ "item_id": uuid | null, "name": text, "quantity": text }]
  ingredients jsonb not null default '[]',
  steps       jsonb not null default '[]',
  minutes     int  not null,
  servings    int  not null default 1,
  calories    int  not null,
  protein_g   int  not null,
  carbs_g     int  not null,
  fat_g       int  not null,
  created_at  timestamptz not null default now()
);

create table public.meal_slots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  recipe_id         uuid references public.recipes (id) on delete set null,
  calendar_event_id text,
  status            text not null default 'planned' check (status in ('planned', 'cooked', 'skipped')),
  logged_to_health  boolean not null default false,
  nudged_at         timestamptz,
  cooked_at         timestamptz,
  created_at        timestamptz not null default now()
);

create index meal_slots_user_start on public.meal_slots (user_id, starts_at);

-- ---------------------------------------------------------------------------
-- Cook a meal: mark slot cooked, consume linked items, create a leftover.
-- Single source of truth for the app ("Mark cooked") and the Photon "done" reply.
-- ---------------------------------------------------------------------------
create function public.cook_meal_slot(p_slot_id uuid, p_leftover_servings int default 1)
returns public.meal_slots
language plpgsql security invoker set search_path = public as $$
declare
  v_slot   public.meal_slots;
  v_recipe public.recipes;
begin
  select * into v_slot from public.meal_slots where id = p_slot_id for update;
  if not found then raise exception 'meal slot % not found', p_slot_id; end if;
  if v_slot.status = 'cooked' then return v_slot; end if;

  select * into v_recipe from public.recipes where id = v_slot.recipe_id;

  if found then
    update public.items
       set status = 'used'
     where user_id = v_slot.user_id
       and status = 'active'
       and id in (
         select (ing ->> 'item_id')::uuid
           from jsonb_array_elements(v_recipe.ingredients) ing
          where ing ->> 'item_id' is not null
       );

    if p_leftover_servings > 0 then
      insert into public.items (user_id, name, category, quantity, unit, purchase_date, estimated_expiry, source)
      values (v_slot.user_id, 'Leftover: ' || v_recipe.title, 'cooked_leftovers',
              p_leftover_servings, 'serving', current_date, current_date + 4, 'leftover');
    end if;
  end if;

  update public.meal_slots
     set status = 'cooked', cooked_at = now()
   where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end $$;

-- Daily housekeeping: anything past expiry and still active counts as wasted.
create function public.mark_expired_wasted() returns int
language sql security definer set search_path = public as $$
  with w as (
    update public.items set status = 'wasted'
     where status = 'active' and estimated_expiry < current_date
    returning 1
  ) select count(*)::int from w;
$$;
revoke execute on function public.mark_expired_wasted() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Weekly stats for the Wrapped card
-- ---------------------------------------------------------------------------
create view public.weekly_stats with (security_invoker = true) as
select
  u.user_id,
  date_trunc('week', now())::date as week_start,
  coalesce((select sum(r.total) from public.receipts r
             where r.user_id = u.user_id and r.purchased_at >= date_trunc('week', now())), 0) as spent,
  (select count(*) from public.items i
    where i.user_id = u.user_id and i.status = 'used' and i.updated_at >= date_trunc('week', now()))::int as items_saved,
  (select count(*) from public.items i
    where i.user_id = u.user_id and i.status = 'wasted' and i.updated_at >= date_trunc('week', now()))::int as items_wasted
from (select id as user_id from public.profiles) u;

-- ---------------------------------------------------------------------------
-- Row level security: every row belongs to exactly one user.
-- The Node server uses the service-role key and bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.receipts   enable row level security;
alter table public.items      enable row level security;
alter table public.recipes    enable row level security;
alter table public.meal_slots enable row level security;
alter table public.shelf_life enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own receipts" on public.receipts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own items" on public.items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own recipes" on public.recipes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own meal slots" on public.meal_slots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "shelf life is public" on public.shelf_life
  for select using (true);
