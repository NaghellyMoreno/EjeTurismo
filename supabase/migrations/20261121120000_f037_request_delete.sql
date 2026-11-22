-- F037: efectos de revocar la autorización sobre las solicitudes de información (HU-030; D-019, D-029, D-194).
-- Migración aditiva: `eje_app` puede borrar solicitudes (el servicio de revocación borra las recibidas por los negocios
-- de quien revoca). Las respuestas y el historial se van con la solicitud (CASCADE). Sin otros permisos nuevos.
grant delete on app.information_requests to eje_app;
create policy eje_app_delete on app.information_requests for delete to eje_app using (true);
