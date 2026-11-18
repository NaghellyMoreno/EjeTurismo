-- F012: fichas y atractivo del administrador (HU-009; D-003, D-005, D-042, D-118, D-146; ADR 0002, 0004).
-- `businesses` nace vacía (sin servicio ni ruta): la usa F013. `eje_app` no tiene DELETE en ninguna tabla nueva y
-- `listing_status_events` solo admite INSERT y SELECT. Los CHECK se escriben con btrim para rechazar textos de solo espacios.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create table app.businesses (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid references app.accounts (id) on delete set null,
  owner_removed_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.listings (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  business_id uuid references app.businesses (id),
  created_by_account_id uuid references app.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint listings_kind_check check (kind in ('attraction', 'establishment', 'route_experience')),
  constraint listings_business_id_key unique (business_id),
  constraint listings_attraction_without_business_check check ((kind = 'attraction') = (business_id is null))
);

create table app.listing_versions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references app.listings (id),
  version_number integer not null check (version_number >= 1),
  status text not null,
  name text not null,
  name_normalized text not null,
  municipality_id uuid not null references app.municipalities (id),
  category_id uuid references app.categories (id),
  establishment_type_id uuid references app.establishment_types (id),
  experience_type_id uuid references app.experience_types (id),
  description text,
  schedule text,
  contact text,
  maps_url text,
  guides_info text,
  third_party_declared_at timestamptz,
  submitted_at timestamptz,
  submitted_by uuid references app.accounts (id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references app.accounts (id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_versions_listing_version_key unique (listing_id, version_number),
  constraint listing_versions_status_check check (status in ('draft', 'pending', 'published', 'rejected', 'superseded')),
  constraint listing_versions_name_check check (btrim(name) <> '' and char_length(name) <= 100),
  constraint listing_versions_name_normalized_check check (name_normalized <> '' and char_length(name_normalized) <= 100),
  constraint listing_versions_lengths_check check (
    char_length(description) <= 1500 and char_length(schedule) <= 300 and char_length(contact) <= 200
    and char_length(maps_url) <= 2048 and char_length(guides_info) <= 4096
  ),
  constraint listing_versions_required_fields_check check (
    status not in ('pending', 'published') or (
      category_id is not null
      and coalesce(btrim(description), '') <> '' and coalesce(btrim(schedule), '') <> ''
      and coalesce(btrim(contact), '') <> '' and coalesce(btrim(maps_url), '') <> ''
    )
  ),
  constraint listing_versions_rejection_reason_check check (status <> 'rejected' or coalesce(btrim(rejection_reason), '') <> '')
);

-- Una sola versión publicada y una sola abierta (borrador o pendiente) por ficha (invariante 3).
create unique index listing_versions_one_published_key on app.listing_versions (listing_id) where status = 'published';
create unique index listing_versions_one_open_key on app.listing_versions (listing_id) where status in ('draft', 'pending');

-- Duplicados (D-003, D-118, D-146): dos fichas distintas no comparten nombre normalizado en un municipio mientras
-- tengan una versión en borrador, pendiente, publicada o rechazada. Las versiones de una misma ficha sí pueden compartirlo.
alter table app.listing_versions add constraint listing_versions_duplicate_name_excl
  exclude using gist (municipality_id with =, name_normalized with =, listing_id with <>)
  where (status in ('draft', 'pending', 'published', 'rejected'));

create index listing_versions_published_idx on app.listing_versions (municipality_id, category_id) where status = 'published';

-- Coherencia entre el tipo de ficha y sus datos propios (ADR 0004): el CHECK no puede ver `listings.kind`, por eso es disparador.
create function app.listing_versions_check_kind() returns trigger language plpgsql as $$
declare
  listing_kind text;
begin
  select kind into listing_kind from app.listings where id = new.listing_id;
  if new.establishment_type_id is not null and listing_kind <> 'establishment' then
    raise exception 'establishment_type_id solo se admite en establecimientos' using errcode = '23514', constraint = 'listing_versions_kind_check';
  end if;
  if (new.experience_type_id is not null or new.guides_info is not null) and listing_kind <> 'route_experience' then
    raise exception 'experience_type_id y guides_info solo se admiten en rutas y experiencias' using errcode = '23514', constraint = 'listing_versions_kind_check';
  end if;
  return new;
end;
$$;
create trigger listing_versions_check_kind before insert or update on app.listing_versions
  for each row execute function app.listing_versions_check_kind();

create table app.listing_status_events (
  id bigint generated always as identity primary key,
  listing_id uuid not null references app.listings (id),
  version_id uuid not null references app.listing_versions (id),
  from_status text,
  to_status text not null,
  actor_account_id uuid references app.accounts (id) on delete set null,
  actor_role text not null check (actor_role in ('provider', 'admin', 'system')),
  reason text,
  occurred_at timestamptz not null default now()
);

-- Escribe un evento por cada versión insertada o cuyo estado cambia. El actor sale de `app.actor_account_id` y
-- `app.actor_role` (los fija el servicio dentro de la transacción) o, si faltan, de quien decidió, envió o creó la ficha.
create function app.listing_versions_record_status() returns trigger language plpgsql as $$
declare
  actor_id uuid;
  actor_kind text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;
  actor_id := coalesce(
    nullif(current_setting('app.actor_account_id', true), '')::uuid,
    new.decided_by, new.submitted_by,
    (select created_by_account_id from app.listings where id = new.listing_id)
  );
  actor_kind := coalesce(nullif(current_setting('app.actor_role', true), ''), 'system');
  insert into app.listing_status_events (listing_id, version_id, from_status, to_status, actor_account_id, actor_role, reason)
  values (new.listing_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status, actor_id, actor_kind, new.rejection_reason);
  return new;
end;
$$;
create trigger listing_versions_record_status after insert or update of status on app.listing_versions
  for each row execute function app.listing_versions_record_status();

revoke all on app.businesses, app.listings, app.listing_versions, app.listing_status_events from public, anon, authenticated, service_role;
grant select on app.businesses to eje_app;
grant select, insert on app.listings, app.listing_versions, app.listing_status_events to eje_app;
grant usage on all sequences in schema app to eje_app;

alter table app.businesses enable row level security;
alter table app.listings enable row level security;
alter table app.listing_versions enable row level security;
alter table app.listing_status_events enable row level security;
create policy eje_app_select on app.businesses for select to eje_app using (true);
create policy eje_app_select on app.listings for select to eje_app using (true);
create policy eje_app_insert on app.listings for insert to eje_app with check (true);
create policy eje_app_select on app.listing_versions for select to eje_app using (true);
create policy eje_app_insert on app.listing_versions for insert to eje_app with check (true);
create policy eje_app_select on app.listing_status_events for select to eje_app using (true);
create policy eje_app_insert on app.listing_status_events for insert to eje_app with check (true);
