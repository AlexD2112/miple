-- Food log: everything the user eats, not just meals cooked from the plan.
-- Entries come from a meal photo, a nutrition label, a typed description, a barcode,
-- the USDA search, quick-add numbers, or a cooked Ripe recipe.
create table public.food_log (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  eaten_on         date not null default current_date,          -- the user's local day
  eaten_at         timestamptz not null default now(),
  meal             text not null default 'snack' check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  name             text not null,
  brand            text,
  servings         numeric(8, 2) not null default 1 check (servings > 0),
  serving_desc     text,                                        -- e.g. "1 cup (240 g)"
  -- Macros for ONE serving; totals are servings x these.
  calories         numeric(8, 1) not null default 0 check (calories >= 0),
  protein_g        numeric(7, 1) not null default 0 check (protein_g >= 0),
  carbs_g          numeric(7, 1) not null default 0 check (carbs_g >= 0),
  fat_g            numeric(7, 1) not null default 0 check (fat_g >= 0),
  fiber_g          numeric(7, 1) check (fiber_g >= 0),
  source           text not null default 'quick'
                   check (source in ('photo', 'label', 'describe', 'barcode', 'search', 'quick', 'recipe', 'copy')),
  barcode          text,
  meal_slot_id     uuid references public.meal_slots (id) on delete cascade,
  logged_to_health boolean not null default false,
  created_at       timestamptz not null default now()
);

create index food_log_user_day on public.food_log (user_id, eaten_on);
-- One log entry per cooked plan meal, so cooking twice can't double count.
create unique index food_log_meal_slot on public.food_log (meal_slot_id) where meal_slot_id is not null;

alter table public.food_log enable row level security;
create policy "own food log" on public.food_log
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Shopping list: things to buy, typed in, scanned from a photo of a list, or added from suggestions.
create table public.shopping_list (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  quantity   text,                                              -- free text, e.g. "2 lb" or "1 dozen"
  category   text not null default 'other' references public.shelf_life (category),
  checked    boolean not null default false,
  source     text not null default 'manual' check (source in ('manual', 'scan', 'suggestion', 'chef')),
  created_at timestamptz not null default now()
);

create index shopping_list_user on public.shopping_list (user_id, checked, created_at);

alter table public.shopping_list enable row level security;
create policy "own shopping list" on public.shopping_list
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
