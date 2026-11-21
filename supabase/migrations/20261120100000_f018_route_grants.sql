-- F018: la ruta o experiencia guarda tipo de experiencia y datos del guía en el borrador (D-170).
-- La migración de F013 concedió a `eje_app` el permiso de actualizar solo las columnas de F013; estas dos faltaban.
grant update (experience_type_id, guides_info) on app.listing_versions to eje_app;
