-- F034: revocar mi autorización (D-018, D-019, D-021, D-036, D-076).
-- La aplicación borra la cuenta (y por cascada su sesión, sus contadores y su registro de prestador) y las filas de
-- `role_grants` con el ID de Telegram de quien revoca. `consent_events` y `audit_events` siguen sin UPDATE ni DELETE.
grant delete on app.accounts to eje_app;
grant delete on app.role_grants to eje_app;
create policy eje_app_delete on app.role_grants for delete to eje_app using (true);
