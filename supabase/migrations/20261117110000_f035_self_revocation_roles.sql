-- F035: efectos de revocar mi autorización para prestador y administrador (D-018, D-019, D-021, D-036, D-076, D-139).
-- La aplicación borra también los avisos de `notification_outbox` dirigidos al ID de Telegram de quien revoca.
-- `consent_events` y `audit_events` siguen sin UPDATE ni DELETE (D-076).
grant delete on app.notification_outbox to eje_app;
create policy eje_app_delete on app.notification_outbox for delete to eje_app using (true);
