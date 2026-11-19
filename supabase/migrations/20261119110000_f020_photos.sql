-- F020: fotografías de una ficha y sus límites (HU-017; D-031, D-042; ADR 0009). Solo agrega tablas, disparadores y permisos.
-- `listing_photos`: como máximo 10 por versión, suma de `size_bytes` hasta 2 GB y solo en versiones editables (borrador de una ficha
-- de prestador o versión publicada de un atractivo). `photo_uploads`: subidas emitidas; cuentan para la cuota global mientras no vencen.
create table app.listing_photos (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references app.listing_versions (id) on delete cascade,
  blob_pathname text not null,
  content_type text not null,
  size_bytes integer not null,
  position integer not null,
  telegram_file_id text,
  uploaded_by uuid references app.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint listing_photos_content_type_check check (content_type in ('image/jpeg', 'image/png')),
  constraint listing_photos_size_check check (size_bytes >= 1),
  constraint listing_photos_position_check check (position between 1 and 10),
  constraint listing_photos_version_pathname_key unique (version_id, blob_pathname),
  -- Diferible: al quitar una foto las siguientes se renumeran dentro de la misma transacción.
  constraint listing_photos_version_position_key unique (version_id, position) deferrable initially immediate
);
create index listing_photos_pathname_idx on app.listing_photos (blob_pathname);

create table app.photo_uploads (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references app.listing_versions (id) on delete cascade,
  requested_by_account_id uuid not null references app.accounts (id) on delete cascade,
  pathname text not null,
  declared_size integer not null check (declared_size >= 1),
  content_type text not null check (content_type in ('image/jpeg', 'image/png')),
  expires_at timestamptz not null,
  registered_at timestamptz,
  created_at timestamptz not null default now()
);
create index photo_uploads_version_idx on app.photo_uploads (version_id);

-- Bloquea la versión y aplica las tres reglas con el mismo error que el servicio traduce a 409 (constraint `listing_photos_*`).
create function app.listing_photos_guard() returns trigger language plpgsql as $$
declare
  target uuid;
  version_status text;
  listing_kind text;
  total bigint;
  amount integer;
begin
  target := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  select v.status, l.kind into version_status, listing_kind
    from app.listing_versions v join app.listings l on l.id = v.listing_id
    where v.id = target for update of v;
  if not ((listing_kind = 'attraction' and version_status = 'published') or (listing_kind <> 'attraction' and version_status = 'draft')) then
    raise exception 'las fotos solo se cambian en una versión editable' using errcode = '23514', constraint = 'listing_photos_editable_version';
  end if;
  if tg_op <> 'INSERT' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select count(*), coalesce(sum(size_bytes), 0) into amount, total from app.listing_photos where version_id = new.version_id;
  if amount >= 10 then
    raise exception 'una versión admite como máximo 10 fotos' using errcode = '23514', constraint = 'listing_photos_limit';
  end if;
  if total + new.size_bytes > 2147483648 then
    raise exception 'las fotos de una versión suman como máximo 2 GB' using errcode = '23514', constraint = 'listing_photos_total_size';
  end if;
  return new;
end;
$$;
create trigger listing_photos_guard before insert or update or delete on app.listing_photos
  for each row execute function app.listing_photos_guard();

revoke all on app.listing_photos, app.photo_uploads from public, anon, authenticated, service_role;
grant select, insert, delete on app.listing_photos to eje_app;
grant update (position) on app.listing_photos to eje_app;
grant select, insert on app.photo_uploads to eje_app;
grant update (registered_at) on app.photo_uploads to eje_app;

alter table app.listing_photos enable row level security;
alter table app.photo_uploads enable row level security;
create policy eje_app_select on app.listing_photos for select to eje_app using (true);
create policy eje_app_insert on app.listing_photos for insert to eje_app with check (true);
create policy eje_app_update on app.listing_photos for update to eje_app using (true) with check (true);
create policy eje_app_delete on app.listing_photos for delete to eje_app using (true);
create policy eje_app_select on app.photo_uploads for select to eje_app using (true);
create policy eje_app_insert on app.photo_uploads for insert to eje_app with check (true);
create policy eje_app_update on app.photo_uploads for update to eje_app using (true) with check (true);
