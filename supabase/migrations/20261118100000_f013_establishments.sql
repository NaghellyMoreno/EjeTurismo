-- F013: establecimientos del prestador (HU-010; D-006, D-044). Solo agrega permisos: F012 dejó `businesses` y
-- `listing_versions` sin servicio. `eje_app` puede crear negocios y actualizar las columnas de contenido y de estado
-- de una versión (guardar el borrador y enviarla a revisión); sigue sin DELETE y sin tocar `listing_status_events`.
grant insert on app.businesses to eje_app;
create policy eje_app_insert on app.businesses for insert to eje_app with check (true);

grant update (
  name, name_normalized, municipality_id, category_id, establishment_type_id, description, schedule, contact, maps_url,
  status, third_party_declared_at, submitted_at, submitted_by, updated_at
) on app.listing_versions to eje_app;
create policy eje_app_update on app.listing_versions for update to eje_app using (true) with check (true);

-- Las listas de F013 filtran los negocios por dueño.
create index businesses_provider_account_idx on app.businesses (provider_account_id);
