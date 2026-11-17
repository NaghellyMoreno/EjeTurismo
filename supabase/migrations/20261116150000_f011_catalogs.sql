-- F011: listas cerradas de categorías, tipos de experiencia y tipos de establecimiento (D-004, D-040, D-048, D-118, D-119).
-- Las listas solo crecen y se renombran: `eje_app` no tiene DELETE. `is_gastronomic` solo la fija la semilla (ADR 0004, 0011):
-- `eje_app` no tiene INSERT ni UPDATE sobre esa columna.

create table app.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name <> '' and char_length(name) <= 100),
  name_normalized text not null check (name_normalized <> '' and char_length(name_normalized) <= 100),
  created_by_account_id uuid references app.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by_account_id uuid references app.accounts (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint categories_name_normalized_key unique (name_normalized)
);

create table app.experience_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name <> '' and char_length(name) <= 100),
  name_normalized text not null check (name_normalized <> '' and char_length(name_normalized) <= 100),
  is_gastronomic boolean not null default false,
  created_by_account_id uuid references app.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by_account_id uuid references app.accounts (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint experience_types_name_normalized_key unique (name_normalized)
);

create table app.establishment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name <> '' and char_length(name) <= 100),
  name_normalized text not null check (name_normalized <> '' and char_length(name_normalized) <= 100),
  is_gastronomic boolean not null default false,
  created_by_account_id uuid references app.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by_account_id uuid references app.accounts (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint establishment_types_name_normalized_key unique (name_normalized)
);

revoke all on app.categories, app.experience_types, app.establishment_types from public, anon, authenticated, service_role;
grant select on app.categories, app.experience_types, app.establishment_types to eje_app;
grant insert (id, name, name_normalized, created_by_account_id, created_at, updated_by_account_id, updated_at)
  on app.categories, app.experience_types, app.establishment_types to eje_app;
grant update (name, name_normalized, updated_by_account_id, updated_at)
  on app.categories, app.experience_types, app.establishment_types to eje_app;

alter table app.categories enable row level security;
alter table app.experience_types enable row level security;
alter table app.establishment_types enable row level security;
create policy eje_app_select on app.categories for select to eje_app using (true);
create policy eje_app_insert on app.categories for insert to eje_app with check (true);
create policy eje_app_update on app.categories for update to eje_app using (true) with check (true);
create policy eje_app_select on app.experience_types for select to eje_app using (true);
create policy eje_app_insert on app.experience_types for insert to eje_app with check (true);
create policy eje_app_update on app.experience_types for update to eje_app using (true) with check (true);
create policy eje_app_select on app.establishment_types for select to eje_app using (true);
create policy eje_app_insert on app.establishment_types for insert to eje_app with check (true);
create policy eje_app_update on app.establishment_types for update to eje_app using (true) with check (true);
