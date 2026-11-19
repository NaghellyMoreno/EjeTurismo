-- F015: una versión publicada no se oculta ni se devuelve a otro estado (HU-016, D-153, D-155; invariante 3).
-- Solo agrega una regla: sacar una versión de `published` únicamente es válido hacia `superseded` (al aprobar la nueva).
create function app.listing_versions_guard_published() returns trigger language plpgsql as $$
begin
  if old.status = 'published' and new.status <> 'published' and new.status <> 'superseded' then
    raise exception 'una versión publicada solo puede pasar a superseded' using errcode = '23514', constraint = 'listing_versions_published_transition';
  end if;
  return new;
end;
$$;
create trigger listing_versions_guard_published before update on app.listing_versions
  for each row execute function app.listing_versions_guard_published();
