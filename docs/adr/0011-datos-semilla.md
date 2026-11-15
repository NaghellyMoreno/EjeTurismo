# 0011. Datos semilla en SQL versionado, separados por entorno

- **Estado:** Propuesta (revisada en la iteración 2 de preparación: M-16, D-048, D-050; y en la iteración 3: D-052, D-053. Pendiente de la usuaria: contenido de la semilla de demostración y de las categorías y los demás tipos de experiencia)
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.1 y 3.4; D-004, D-027, D-034, D-040, D-041, D-048, D-050, D-052, D-053; guía de agentes (developer: datos de prueba Pendiente)

## Contexto
Hacen falta datos para desarrollar, probar y demostrar. El contenido lo decide la usuaria. Están confirmados:
- los municipios iniciales Manizales, Supía y Filadelfia, del departamento de Caldas (D-027);
- que restaurante y café son tipos de establecimiento (D-004), y la lista de tipos de establecimiento de D-040;
- que la semilla incluye un tipo de experiencia gastronómica marcado como gastronómico, para que el directorio cumpla la sección 3.4 (D-048), y que se llama "Sabores de Caldas" (D-052);
- que, con el nombre decidido, la semilla carga "Sabores de Caldas" (D-053);
- que la versión del aviso es "2026-11-v3", vigente desde su publicación en producción (D-050).

No se pueden inventar prestadores, atractivos ni números de identidad.

## Decisión
Tres niveles, todos en SQL versionado en el repositorio y cargados con `psql` por los scripts `db:*` (ADR 0014; sin Docker, D-063):
1. **Referencia (todos los entornos, incluida producción):** `supabase/seed/reference.sql`. Contiene:
   - la versión vigente del aviso de privacidad, `version = '2026-11-v3'` (D-050), con el texto aprobado (D-034) tal como quede en `docs/05-aviso-privacidad.md`, y `published_at` igual al momento de la carga en cada entorno (ADR 0005);
   - los municipios de D-027;
   - los tipos de establecimiento de D-040 (hotel, finca cafetera, alojamiento rural, restaurante y café), con `is_gastronomic = true` solo en restaurante y café;
   - el tipo de experiencia "Sabores de Caldas" con `is_gastronomic = true` (D-048, D-052), con las reglas de "Tipo de experiencia gastronómica" (abajo);
   - las categorías y los demás tipos de experiencia que indique la usuaria. Si no los indica, la semilla no trae ninguno y el administrador los crea en la Mini App (M11, F011; D-041).

   Es idempotente: cada fila tiene un UUID fijo y se inserta con `INSERT ... ON CONFLICT DO NOTHING`, sin columna de conflicto, de modo que no duplica ni por UUID ni por nombre. La semilla se carga con el rol de migraciones, el único que puede escribir `is_gastronomic` (ADR 0004). En producción se carga con `pnpm db:seed:reference`, igual que en los demás entornos y sin reglas especiales para ninguna fila.
2. **Desarrollo y demostración (nunca producción):** `supabase/seed/demo.sql`. Fichas, negocios y cuentas de ejemplo con datos que la usuaria apruebe. Los IDs de Telegram y los documentos de identidad son ficticios y van marcados como tales; cada registro de prestador lleva un tipo de D-046 (`CC`, `CE`, `PPT` o `PA`). En local lo cargan `pnpm db:seed` y `pnpm db:reset`, después de `reference.sql` (ADR 0014). La sección `[db.seed]` de `supabase/config.toml` ya no se usa, porque `supabase db reset` requiere Docker (D-063).
3. **Pruebas automáticas:** fábricas en TypeScript (`tests/factories`) que crean sus propios datos en cada prueba y no dependen de la semilla de demostración. Las pruebas del directorio gastronómico ubican el tipo sembrado por su UUID fijo, nunca por su nombre.

**Tipo de experiencia gastronómica (D-048, D-052).**
- Nombre: exactamente `Sabores de Caldas` (Confirmado, D-052), en todos los entornos.
- Va en su propio archivo, `supabase/seed/reference-gastronomic-experience-type.sql`, que `reference.sql` incluye.
- UUID fijo, constante compartida con el código de pruebas (`GASTRONOMIC_EXPERIENCE_TYPE_ID`).
- La marca y el UUID no dependen del nombre. Si el administrador cambia el nombre en M11 (`updateExperienceType`), la marca `is_gastronomic` y el UUID no cambian, y como la semilla no actualiza filas existentes, volver a ejecutarla no deshace el cambio ni crea otra fila.
- D-053 fijaba que la fila se omitiera en producción mientras el nombre fuera un marcador. Con D-052 ya no hay marcador, así que esa regla no tiene caso de aplicación: el script de producción no lleva ninguna regla especial y no existe la constante de marcador.

Los textos que la usuaria apruebe se pasan a SQL sin cambios de redacción.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Semilla en JSON con un script cargador | Fácil de editar | Otro formato y otro cargador; `psql` ya carga SQL |
| Cargar datos desde la interfaz | Sin archivos | No es reproducible ni sirve para pruebas |
| Idempotencia por nombre (`ON CONFLICT (name_normalized)`) | Sin UUID fijos | Si el administrador cambia el nombre de "Sabores de Caldas" en M11, volver a sembrar crearía otra fila con ese nombre y con la marca gastronómica |
| Crear "Sabores de Caldas" desde M11 en lugar de la semilla | Sin archivo aparte | La API no puede fijar `is_gastronomic` (ADR 0004); el tipo no entraría al directorio |

## Consecuencias
- Más fácil: entornos reproducibles con `pnpm db:reset`. El directorio gastronómico incluye experiencias de "Sabores de Caldas" en todos los entornos desde la primera carga de la semilla (D-048, D-052), y QA puede cerrar F017, paso 5, con el nombre definitivo.
- El script de producción es el mismo para todas las filas de referencia.
- Pendiente (usuaria): contenido de la semilla de demostración, y las categorías y los demás tipos de experiencia iniciales (`docs/03-arquitectura.md`, Pendiente 5). No bloquean, porque el administrador los puede crear (F010, F011). Los tipos de establecimiento quedaron fijados por D-040.
