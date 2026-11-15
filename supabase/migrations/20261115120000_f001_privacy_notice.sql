-- F001: aviso de privacidad, cuentas y prueba de aceptación (ADR 0005, 0006, 0008; D-008, D-036, D-039).
-- Sirve igual en local y en Supabase: sin contraseñas, sin objetos propios de Supabase.
create schema if not exists app;

-- Rol de la aplicación (ADR 0006): solo DML sobre `app`, sin DDL. La contraseña, en la nube, la fija la responsable fuera del repositorio.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'eje_app') then
    create role eje_app login;
  end if;
end
$$;

revoke all on schema app from public;
revoke all on schema app from anon, authenticated, service_role;
grant usage on schema app to eje_app;

-- Versiones del aviso. Una sola puede ser vigente (índice único parcial).
create table app.privacy_notice_versions (
  version text primary key,
  body_markdown text not null,
  declaration_text text not null,
  revocation_note text,
  published_at timestamptz not null default now(),
  is_current boolean not null default false
);
create unique index privacy_notice_versions_one_current on app.privacy_notice_versions (is_current) where is_current;

-- Solo existe tras aceptar el aviso (D-008).
create table app.accounts (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  telegram_display_name text,
  consent_notice_version text not null references app.privacy_notice_versions (version),
  consent_accepted_at timestamptz not null,
  consent_channel text not null check (consent_channel in ('bot', 'mini_app')),
  created_at timestamptz not null default now()
);

-- Prueba de autorización: sin identificador de la persona (D-036).
create table app.consent_events (
  id bigint generated always as identity primary key,
  event text not null check (event in ('accepted', 'revoked')),
  channel text not null check (channel in ('bot', 'mini_app')),
  notice_version text not null references app.privacy_notice_versions (version),
  occurred_at timestamptz not null default now()
);

-- Tablas de la arquitectura que F001 solo lee para comprobar que siguen vacías antes de aceptar (ADR 0006, 0008, 0015).
create table app.processed_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);
create table app.bot_sessions (
  account_id uuid primary key references app.accounts (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table app.rate_limit_counters (
  account_id uuid not null references app.accounts (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (account_id, action, window_start)
);

-- Permisos de eje_app (ADR 0006). consent_events: solo INSERT y SELECT.
revoke all on all tables in schema app from public, anon, authenticated, service_role;
grant select on app.privacy_notice_versions to eje_app;
grant select, insert, update on app.accounts to eje_app;
grant select, insert on app.consent_events to eje_app;
grant select, insert on app.processed_updates to eje_app;
grant select, insert, update, delete on app.bot_sessions to eje_app;
grant select, insert, update, delete on app.rate_limit_counters to eje_app;
grant usage on all sequences in schema app to eje_app;

-- RLS activo con una política solo para eje_app: anon y authenticated no ven nada aunque se activara la Data API.
alter table app.privacy_notice_versions enable row level security;
alter table app.accounts enable row level security;
alter table app.consent_events enable row level security;
alter table app.processed_updates enable row level security;
alter table app.bot_sessions enable row level security;
alter table app.rate_limit_counters enable row level security;

create policy eje_app_all on app.privacy_notice_versions for select to eje_app using (true);
create policy eje_app_all on app.accounts for all to eje_app using (true) with check (true);
create policy eje_app_select on app.consent_events for select to eje_app using (true);
create policy eje_app_insert on app.consent_events for insert to eje_app with check (true);
create policy eje_app_select on app.processed_updates for select to eje_app using (true);
create policy eje_app_insert on app.processed_updates for insert to eje_app with check (true);
create policy eje_app_all on app.bot_sessions for all to eje_app using (true) with check (true);
create policy eje_app_all on app.rate_limit_counters for all to eje_app using (true) with check (true);
