# 0011. Datos semilla en SQL versionado, separados por entorno

- **Estado:** Propuesta (contenido de la semilla de demostración Pendiente de la usuaria)
- **Fecha:** 2026-11-14
- **Fuente:** sección 3.1; D-004, D-027, D-034, D-040, D-041; guía de agentes (developer: datos de prueba Pendiente)

## Contexto
Hacen falta datos para desarrollar, probar y demostrar. El contenido lo decide la usuaria; están confirmados los municipios iniciales Manizales, Supía y Filadelfia, del departamento de Caldas (D-027), y que restaurante y café son tipos de establecimiento (D-004). No se pueden inventar prestadores, atractivos ni números de identidad.

## Decisión
Tres niveles, todos en SQL versionado en el repositorio y cargados por la CLI de Supabase o por scripts:
1. **Referencia (todos los entornos, incluida producción):** `supabase/seed/reference.sql`. Contiene:
   - la versión vigente del aviso de privacidad, con el texto aprobado (D-034) tal como quede en `docs/05-aviso-privacidad.md`;
   - los municipios de D-027;
   - los tipos de establecimiento de D-040 (hotel, finca cafetera, alojamiento rural, restaurante y café), con `is_gastronomic = true` solo en restaurante y café;
   - las categorías y los tipos de experiencia que indique la usuaria. Si no los indica, la semilla no trae ninguno y el administrador los crea en la Mini App (M11, F011; D-041). Idempotente (`INSERT ... ON CONFLICT DO NOTHING`). En producción se carga con `pnpm db:seed:reference`.
2. **Desarrollo y demostración (nunca producción):** `supabase/seed/demo.sql`. Fichas, negocios y cuentas de ejemplo con datos que la usuaria apruebe; los IDs de Telegram y números de identidad son ficticios y marcados como tales. `supabase db reset` lo carga en local mediante `supabase/config.toml` (`[db.seed] sql_paths`).
3. **Pruebas automáticas:** fábricas en TypeScript (`tests/factories`) que crean sus propios datos en cada prueba; no dependen de la semilla de demostración.

Los textos que la usuaria apruebe se pasan a SQL sin cambios de redacción.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Semilla en JSON con un script cargador | Fácil de editar | Otro formato y otro cargador; la CLI de Supabase ya carga SQL |
| Cargar datos desde la interfaz | Sin archivos | No es reproducible ni sirve para pruebas |

## Consecuencias
- Más fácil: entornos reproducibles con `pnpm db:reset`.
- Pendiente (usuaria): contenido de la semilla de demostración y, si los quiere precargados, las categorías y los tipos de experiencia iniciales. No bloquea, porque el administrador los puede crear (F010, F011). Los tipos de establecimiento quedaron fijados por D-040.
