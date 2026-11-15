-- F003: autorizar o rechazar registros de prestadores (ADR 0003, 0005, 0007; D-038, D-076, D-081).
-- No cambia índices ni disparadores de F002. `audit_events` sigue con solo INSERT y SELECT (D-076).

-- Bandeja de salida (ADR 0007): cada aviso a un tercero se inserta en la misma transacción de la operación que lo causa.
-- `payload` nunca lleva el número, el tipo de documento ni el motivo de rechazo.
create table app.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_telegram_user_id bigint not null,
  template text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  -- Nulo cuando no hay reintento programado (enviado, fallido sin reintentos o aún sin intentar).
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_outbox_due on app.notification_outbox (next_attempt_at) where status = 'pending';

revoke all on app.notification_outbox from public, anon, authenticated, service_role;
grant select, insert on app.notification_outbox to eje_app;
grant update (status, attempts, next_attempt_at, sent_at) on app.notification_outbox to eje_app;
alter table app.notification_outbox enable row level security;
create policy eje_app_select on app.notification_outbox for select to eje_app using (true);
create policy eje_app_insert on app.notification_outbox for insert to eje_app with check (true);
create policy eje_app_update on app.notification_outbox for update to eje_app using (true) with check (true);

-- Decidir un registro: solo cambian estas columnas; nunca el tipo, el número cifrado, el hash, la cuenta ni la fecha de creación.
grant update (status, decided_at, decided_by_account_id, rejection_reason) on app.provider_registrations to eje_app;
create policy eje_app_update on app.provider_registrations for update to eje_app using (true) with check (true);

-- El permiso de prestador nace al aprobar (invariante 4); el disparador de F002 exige el registro aprobado.
grant insert on app.role_grants to eje_app;
create policy eje_app_insert on app.role_grants for insert to eje_app with check (true);
