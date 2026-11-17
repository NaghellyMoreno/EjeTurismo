-- F010: municipios administrados por el administrador (HU-007; D-013, D-027, D-118, D-122).
-- Catálogo común sin datos personales. `name_normalized` (sin tildes, en minúsculas, sin espacios repetidos) es único
-- y detecta duplicados (ADR 0002). `created_by` y `updated_by` quedan nulos al borrar la cuenta (D-043).
create table app.municipalities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 4096),
  name_normalized text not null unique,
  department text not null check (btrim(department) <> '' and char_length(department) <= 4096),
  general_info text check (char_length(general_info) <= 4096),
  zone text check (char_length(zone) <= 4096),
  created_by uuid references app.accounts (id) on delete set null,
  updated_by uuid references app.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on app.municipalities from public, anon, authenticated, service_role;
grant select, insert on app.municipalities to eje_app;
grant update (name, name_normalized, department, general_info, zone, updated_by, updated_at) on app.municipalities to eje_app;
alter table app.municipalities enable row level security;
create policy eje_app_select on app.municipalities for select to eje_app using (true);
create policy eje_app_insert on app.municipalities for insert to eje_app with check (true);
create policy eje_app_update on app.municipalities for update to eje_app using (true) with check (true);
