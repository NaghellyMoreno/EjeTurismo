-- F014: aprobar o rechazar una ficha pendiente (HU-014; D-002, D-006, D-029; ADR 0002). Solo agrega permisos y reglas:
-- `eje_app` puede registrar quién decidió, cuándo y con qué motivo, y la base impone las transiciones (invariante 3).
-- Sigue sin poder borrar versiones ni tocar `listing_status_events`.
grant update (decided_at, decided_by, rejection_reason) on app.listing_versions to eje_app;

-- `published` y `rejected` solo se alcanzan desde `pending` y con `decided_by` de una cuenta con permiso `admin` activo
-- (el administrador principal tiene su fila `is_principal` en `role_grants`, D-101). Los demás cambios de estado
-- (por ejemplo, `published` a `superseded`) no se restringen aquí.
create function app.listing_versions_check_decision() returns trigger language plpgsql as $$
begin
  if new.status = old.status or new.status not in ('published', 'rejected') then
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'una versión solo se publica o se rechaza desde pending' using errcode = '23514', constraint = 'listing_versions_decision_transition';
  end if;
  if new.decided_by is null or not exists (
    select 1 from app.accounts a
    join app.role_grants g on g.telegram_user_id = a.telegram_user_id
    where a.id = new.decided_by and g.role = 'admin' and g.revoked_at is null
  ) then
    raise exception 'la decisión debe venir de un administrador activo' using errcode = '23514', constraint = 'listing_versions_decision_actor';
  end if;
  return new;
end;
$$;
create trigger listing_versions_check_decision before update on app.listing_versions
  for each row execute function app.listing_versions_check_decision();
