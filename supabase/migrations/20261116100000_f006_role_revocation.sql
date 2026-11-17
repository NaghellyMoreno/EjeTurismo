-- F006: revocar el rol de un administrador o prestador (ADR 0003; D-015, D-020, D-038, D-043, D-076).
-- `role_grants` solo permite cambiar `revoked_at` y `revoked_by_account_id`; nunca el rol, el ID de Telegram ni la fecha de otorgamiento.
-- No hay DELETE. `audit_events` sigue con solo INSERT y SELECT (D-076). No toca el disparador de D-038.
grant update (revoked_at, revoked_by_account_id) on app.role_grants to eje_app;
create policy eje_app_update on app.role_grants for update to eje_app using (true) with check (true);
