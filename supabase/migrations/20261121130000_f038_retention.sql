-- F038: eliminación de datos personales del 31 de enero de 2027 (RNF-021; D-043, D-051, D-197, D-198, D-199).
-- Migración única: configuración del plazo, función de eliminación y cambio de `photo_uploads.requested_by_account_id`.

-- D-199: las subidas de fichas de atractivo se conservan; al borrar las cuentas, el responsable queda en nulo.
alter table app.photo_uploads alter column requested_by_account_id drop not null;
alter table app.photo_uploads drop constraint photo_uploads_requested_by_account_id_fkey;
alter table app.photo_uploads
  add constraint photo_uploads_requested_by_account_id_fkey
  foreign key (requested_by_account_id) references app.accounts(id) on delete set null;

-- Una sola fila. `eje_app` no puede leerla ni modificarla (solo la función, que es del propietario).
create table app.retention_settings (
  id boolean primary key default true check (id),
  deadline date not null default date '2027-01-31',
  executed_at timestamptz
);
insert into app.retention_settings default values;
alter table app.retention_settings enable row level security;
revoke all on app.retention_settings from public, eje_app;

-- Lógica de eliminación con el instante como parámetro: solo el propietario la llama (pruebas y `purge:run`).
-- La fecha se toma en America/Bogota. Una sola transacción: si algo falla, no se borra nada.
create function app.purge_personal_data_at(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  settings app.retention_settings%rowtype;
  provider_versions uuid[];
  deleted jsonb := '{}'::jsonb;
  n bigint;
begin
  select * into settings from app.retention_settings where id for update;
  if settings.executed_at is not null then
    return jsonb_build_object('executed', false, 'skippedReason', 'retention_already_executed', 'deleted', deleted);
  end if;
  if (p_now at time zone 'America/Bogota')::date < settings.deadline then
    return jsonb_build_object('executed', false, 'skippedReason', 'retention_deadline_not_reached', 'deleted', deleted);
  end if;

  select coalesce(array_agg(v.id), '{}') into provider_versions
    from app.listing_versions v join app.listings l on l.id = v.listing_id
    where l.kind <> 'attraction';

  -- La guarda de fotos solo admite cambios en versiones editables; la eliminación la suspende dentro de esta transacción.
  alter table app.listing_photos disable trigger listing_photos_guard;

  delete from app.information_request_replies;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('information_request_replies', n);
  delete from app.information_request_status_events;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('information_request_status_events', n);
  delete from app.information_requests;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('information_requests', n);
  delete from app.listing_status_events;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('listing_status_events', n);
  delete from app.listing_photos where version_id = any (provider_versions);
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('listing_photos', n);
  delete from app.photo_uploads where version_id = any (provider_versions);
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('photo_uploads', n);
  delete from app.listing_versions where id = any (provider_versions);
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('listing_versions', n);
  delete from app.listings where kind <> 'attraction';
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('listings', n);
  delete from app.businesses;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('businesses', n);
  delete from app.role_grants;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('role_grants', n);
  delete from app.provider_registrations;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('provider_registrations', n);
  delete from app.consent_events;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('consent_events', n);
  delete from app.audit_events;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('audit_events', n);
  delete from app.notification_outbox;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('notification_outbox', n);
  delete from app.processed_updates;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('processed_updates', n);
  delete from app.bot_sessions;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('bot_sessions', n);
  delete from app.rate_limit_counters;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('rate_limit_counters', n);
  -- Los responsables de lo conservado (municipios, listas, atractivos, subidas) quedan en nulo por sus claves foráneas.
  delete from app.accounts;
  get diagnostics n = row_count; deleted := deleted || jsonb_build_object('accounts', n);

  alter table app.listing_photos enable trigger listing_photos_guard;
  update app.retention_settings set executed_at = p_now where id;
  return jsonb_build_object('executed', true, 'skippedReason', null, 'deleted', deleted);
end;
$$;

-- Envoltorio sin parámetros: la aplicación no puede elegir la fecha.
create function app.purge_personal_data()
returns jsonb
language sql
security definer
set search_path = app, pg_temp
as $$ select app.purge_personal_data_at(now()) $$;

revoke all on function app.purge_personal_data_at(timestamptz) from public, eje_app;
revoke all on function app.purge_personal_data() from public, eje_app;
grant execute on function app.purge_personal_data() to eje_app;
