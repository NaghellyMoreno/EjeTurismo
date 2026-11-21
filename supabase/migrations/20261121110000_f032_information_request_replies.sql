-- F032: responder una solicitud de información y cambiar su estado (HU-026; D-010, D-011, D-044, D-182, D-189; ADR 0007).
-- Migración aditiva: crea las respuestas y el historial de estados, el disparador de estado y los permisos mínimos.
-- `eje_app` puede leer y agregar respuestas, leer el historial y cambiar solo `status` y `updated_at` de las solicitudes.
-- Nadie borra: las respuestas y los eventos se van con la solicitud (CASCADE desde la cuenta del visitante).
create table app.information_request_replies (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references app.information_requests (id) on delete cascade,
  body text not null,
  sent_by_account_id uuid references app.accounts (id) on delete set null,
  sent_at timestamptz not null default now(),
  constraint information_request_replies_body_check check (btrim(body) <> '' and char_length(body) <= 4096)
);
create index information_request_replies_request_id_idx on app.information_request_replies (request_id, sent_at);

create table app.information_request_status_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references app.information_requests (id) on delete cascade,
  from_status text not null,
  to_status text not null,
  actor_account_id uuid references app.accounts (id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint information_request_status_events_status_check check (
    from_status in ('new', 'attended') and to_status in ('attended', 'closed') and from_status <> to_status
  )
);
create index information_request_status_events_request_id_idx on app.information_request_status_events (request_id, occurred_at);

-- ¿Es `account_id` el prestador dueño del negocio, con el permiso de prestador vigente? (invariantes 1, 2 y 4)
create function app.is_business_provider(business uuid, account_id uuid) returns boolean
language sql stable
set search_path = app, pg_temp
as $$
  select exists (
    select 1
    from app.businesses b
    join app.accounts a on a.id = b.provider_account_id
    join app.role_grants g on g.telegram_user_id = a.telegram_user_id and g.role = 'provider' and g.revoked_at is null
    where b.id = business and a.id = account_id
  )
$$;

-- Disparador de estado: solo el dueño del negocio (cuenta fijada por el servicio en `app.actor_account_id` dentro de la
-- transacción) cambia el estado, solo en el orden new, attended, closed (D-044), y cada cambio deja su evento con fecha y
-- responsable. Corre con los permisos del propietario porque `eje_app` no puede escribir el historial.
create function app.information_requests_check_update() returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  actor_id uuid := nullif(current_setting('app.actor_account_id', true), '')::uuid;
begin
  if new.status = old.status then
    return new;
  end if;
  if actor_id is null or not app.is_business_provider(old.business_id, actor_id) then
    raise exception 'not_request_owner' using errcode = 'P0001';
  end if;
  if not ((old.status = 'new' and new.status = 'attended') or (old.status = 'attended' and new.status = 'closed')) then
    raise exception 'invalid_state_transition' using errcode = 'P0001';
  end if;
  insert into app.information_request_status_events (request_id, from_status, to_status, actor_account_id, occurred_at)
  values (old.id, old.status, new.status, actor_id, new.updated_at);
  return new;
end
$$;

create trigger information_requests_check_update before update on app.information_requests
  for each row execute function app.information_requests_check_update();

-- Disparador de respuestas: solo el dueño del negocio responde y no se responde una solicitud cerrada.
create function app.information_request_replies_check_insert() returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
  request_row record;
begin
  select r.business_id, r.status into request_row from app.information_requests r where r.id = new.request_id for share;
  if not found or new.sent_by_account_id is null or not app.is_business_provider(request_row.business_id, new.sent_by_account_id) then
    raise exception 'not_request_owner' using errcode = 'P0001';
  end if;
  if request_row.status = 'closed' then
    raise exception 'request_closed' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger information_request_replies_check_insert before insert on app.information_request_replies
  for each row execute function app.information_request_replies_check_insert();

revoke all on app.information_request_replies, app.information_request_status_events from public, anon, authenticated, service_role;
grant select, insert on app.information_request_replies to eje_app;
grant select on app.information_request_status_events to eje_app;
grant update (status, updated_at) on app.information_requests to eje_app;

alter table app.information_request_replies enable row level security;
alter table app.information_request_status_events enable row level security;
create policy eje_app_select on app.information_request_replies for select to eje_app using (true);
create policy eje_app_insert on app.information_request_replies for insert to eje_app with check (true);
create policy eje_app_select on app.information_request_status_events for select to eje_app using (true);
create policy eje_app_update on app.information_requests for update to eje_app using (true) with check (true);
