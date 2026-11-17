-- Datos de referencia de las listas cerradas (ADR 0011; D-040, D-048, D-052, D-123). Idempotente: UUID fijo por fila y
-- ON CONFLICT DO NOTHING, de modo que renombrar una fila en M11 no se deshace ni duplica al volver a sembrar.
-- `name_normalized` se escribe a mano con la regla de D-118 (sin espacios sobrantes, minúsculas, sin tildes).

-- Tipo de experiencia gastronómica (D-052); su UUID es la constante GASTRONOMIC_EXPERIENCE_TYPE_ID del código de pruebas.
insert into app.experience_types (id, name, name_normalized, is_gastronomic)
values ('5a0b0e50-0000-4000-8000-000000000001', 'Sabores de Caldas', 'sabores de caldas', true)
on conflict do nothing;

-- Tipos de establecimiento (D-040): la marca gastronómica va solo en restaurante y café.
insert into app.establishment_types (id, name, name_normalized, is_gastronomic) values
  ('5a0b0e50-0000-4000-8000-0000000000a1', 'Hotel', 'hotel', false),
  ('5a0b0e50-0000-4000-8000-0000000000a2', 'Finca cafetera', 'finca cafetera', false),
  ('5a0b0e50-0000-4000-8000-0000000000a3', 'Alojamiento rural', 'alojamiento rural', false),
  ('5a0b0e50-0000-4000-8000-0000000000a4', 'Restaurante', 'restaurante', true),
  ('5a0b0e50-0000-4000-8000-0000000000a5', 'Café', 'cafe', true)
on conflict do nothing;
