-- F030: solicitudes de información de los visitantes (HU-024; D-005, D-010, D-029, D-043, D-044; ADR 0002).
-- Migración aditiva: solo crea la tabla, su función, su disparador y sus permisos. `eje_app` solo puede leer e insertar:
-- el cambio de estado, las respuestas y el historial son de F032. No hay DELETE (las cuentas borran sus solicitudes por CASCADE).
-- Los CHECK de texto usan btrim para rechazar textos de solo espacios; el máximo de 4096 es técnico mientras D-013 siga pendiente.
create table app.information_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references app.listings (id),
  business_id uuid not null references app.businesses (id),
  visitor_account_id uuid not null references app.accounts (id) on delete cascade,
  requester_name text not null,
  interest_date date not null,
  party_size integer not null,
  message text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint information_requests_party_size_check check (party_size > 0),
  constraint information_requests_status_check check (status in ('new', 'attended', 'closed')),
  constraint information_requests_requester_name_check check (btrim(requester_name) <> '' and char_length(requester_name) <= 4096),
  constraint information_requests_message_check check (btrim(message) <> '' and char_length(message) <= 4096)
);
create index information_requests_business_id_idx on app.information_requests (business_id, created_at desc);
create index information_requests_visitor_account_id_idx on app.information_requests (visitor_account_id);

-- Disparador de inserción (ADR 0002): la ficha tiene una versión publicada, es de un negocio (no un atractivo, D-005), el negocio
-- es el de la ficha, su prestador conserva el rol activo (D-029, D-043) y la fecha no es anterior al día de creación en
-- America/Bogota (D-044). Los mensajes los traduce el servicio a 404, 409 y 422.
create function app.information_requests_check_insert() returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  listing_row record;
begin
  select l.kind, l.business_id into listing_row from app.listings l where l.id = new.listing_id;
  if not found or not exists (select 1 from app.listing_versions v where v.listing_id = new.listing_id and v.status = 'published') then
    raise exception 'listing_not_published' using errcode = 'P0001';
  end if;
  if listing_row.kind = 'attraction' or listing_row.business_id is null or listing_row.business_id <> new.business_id then
    raise exception 'listing_not_accepting_requests' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from app.businesses b
    join app.accounts a on a.id = b.provider_account_id
    join app.role_grants g on g.telegram_user_id = a.telegram_user_id and g.role = 'provider' and g.revoked_at is null
    where b.id = new.business_id
  ) then
    raise exception 'listing_not_accepting_requests' using errcode = 'P0001';
  end if;
  if new.interest_date < (new.created_at at time zone 'America/Bogota')::date then
    raise exception 'interest_date_in_past' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger information_requests_check_insert before insert on app.information_requests
  for each row execute function app.information_requests_check_insert();

revoke all on app.information_requests from public, anon, authenticated, service_role;
grant select, insert on app.information_requests to eje_app;
alter table app.information_requests enable row level security;
create policy eje_app_select on app.information_requests for select to eje_app using (true);
create policy eje_app_insert on app.information_requests for insert to eje_app with check (true);
