-- F002: registro de prestador, permisos por rol y auditoría (ADR 0003, 0005, 0006; D-038, D-046, D-047, D-054, D-055, D-076).
-- `role_grants` nace aquí solo con lo que F002 necesita (disparador de D-038 y lectura de roles); F003 y F004 la completan.

-- Tipos de documento de D-046. La base rechaza cualquier otro valor aunque el servicio falle (ADR 0005).
create type app.identity_document_type as enum ('CC', 'CE', 'PPT', 'PA');

create table app.provider_registrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  identity_document_type app.identity_document_type not null,
  -- AES-256-GCM: IV (12) + etiqueta (16) + texto cifrado. Nunca el número en claro (ADR 0005).
  identity_number_encrypted bytea not null,
  -- HMAC-SHA256 de "tipo:número normalizado": detecta duplicados sin descifrar (D-054, D-055).
  identity_number_hash bytea not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_account_id uuid references app.accounts (id) on delete set null,
  rejection_reason text
);
-- Una cuenta con un registro pendiente o aprobado no abre otro; un documento tampoco se repite (D-054).
create unique index provider_registrations_one_active_per_account
  on app.provider_registrations (account_id) where status in ('pending', 'approved');
create unique index provider_registrations_one_active_per_document
  on app.provider_registrations (identity_number_hash) where status in ('pending', 'approved');

create table app.role_grants (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  role text not null check (role in ('admin', 'provider')),
  is_principal boolean not null default false,
  provider_registration_id uuid references app.provider_registrations (id) on delete cascade,
  granted_by_account_id uuid references app.accounts (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_account_id uuid references app.accounts (id) on delete set null,
  constraint role_grants_provider_needs_registration check (role <> 'provider' or provider_registration_id is not null),
  constraint role_grants_principal_is_admin check (not is_principal or role = 'admin')
);
create unique index role_grants_one_active_per_role on app.role_grants (telegram_user_id, role) where revoked_at is null;
create unique index role_grants_one_active_principal on app.role_grants (is_principal) where is_principal and revoked_at is null;

-- D-038, D-047: quien tiene permiso de administrador activo no puede registrarse como prestador.
create function app.reject_admin_registration() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1
    from app.accounts a
    join app.role_grants g on g.telegram_user_id = a.telegram_user_id
    where a.id = new.account_id and g.role = 'admin' and g.revoked_at is null
  ) then
    raise exception 'admin_cannot_register_as_provider' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger provider_registrations_reject_admin
  before insert on app.provider_registrations
  for each row execute function app.reject_admin_registration();

-- Invariante 4: el permiso de prestador solo existe con un registro aprobado y sin permiso de administrador activo (D-038).
create function app.check_provider_grant() returns trigger
language plpgsql as $$
begin
  if new.role = 'provider' then
    if not exists (
      select 1 from app.provider_registrations r where r.id = new.provider_registration_id and r.status = 'approved'
    ) then
      raise exception 'provider_grant_requires_approved_registration' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from app.role_grants g
      where g.telegram_user_id = new.telegram_user_id and g.role = 'admin' and g.revoked_at is null
    ) then
      raise exception 'admin_cannot_be_provider' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
create trigger role_grants_check_provider
  before insert on app.role_grants
  for each row execute function app.check_provider_grant();

-- Trazabilidad (sección 3.12). `details` nunca lleva datos personales. El rol de la aplicación solo inserta y lee (D-076).
create table app.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_account_id uuid references app.accounts (id) on delete set null,
  actor_role text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb
);

revoke all on app.provider_registrations, app.role_grants, app.audit_events from public, anon, authenticated, service_role;
grant select, insert on app.provider_registrations to eje_app;
grant select on app.role_grants to eje_app;
grant select, insert on app.audit_events to eje_app;
grant usage on all sequences in schema app to eje_app;

alter table app.provider_registrations enable row level security;
alter table app.role_grants enable row level security;
alter table app.audit_events enable row level security;
create policy eje_app_select on app.provider_registrations for select to eje_app using (true);
create policy eje_app_insert on app.provider_registrations for insert to eje_app with check (true);
create policy eje_app_select on app.role_grants for select to eje_app using (true);
create policy eje_app_select on app.audit_events for select to eje_app using (true);
create policy eje_app_insert on app.audit_events for insert to eje_app with check (true);
