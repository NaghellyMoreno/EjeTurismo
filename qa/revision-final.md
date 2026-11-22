# Revisión final transversal

- **Fecha:** 2026-11-21
- **Commit evaluado:** 70b383f (árbol limpio)
- **Veredicto:** CON HALLAZGOS (1 de gravedad media confirmado: ruta cron/outbox inexistente; 2 menores)

## Ejecución
| Comprobación | Resultado |
| --- | --- |
| `./init.sh` | Código 0; 19 migraciones, semillas, humo 411/411 |
| `pnpm lint` | Sin errores |
| `pnpm typecheck` | Sin errores |
| `pnpm api:check` | Sin diferencias (schema.d.ts al día con openapi.yaml) |
| `pnpm test` | 134 archivos, 2298/2298 pruebas |
| `feature_list.json` | 35 de 35 funcionalidades con `passes: true`; todas tienen `contracts/<id>.md` y `qa/<id>.md` |
| Informes `qa/F*.md` | Todos terminan en PASA (las menciones de FALLA son de evaluaciones previas ya corregidas) |

## Invariantes de CLAUDE.md
| # | Invariante | Veredicto | Evidencia |
| --- | --- | --- | --- |
| 1 | Verificación en backend de usuario, rol, negocio y permisos | PASA | Suite verde; F007, F008, F009 (initData firmado en cada petición), F033 (403 a otros roles y a visitantes); 43 `PROTECTED_OPERATIONS` cubiertas por `tests/unit/init-data-coverage.test.ts`; rutas cron con excepción explícita (D-200) |
| 2 | Información separada por negocio | PASA | F016, F033 (prestador B, ADM, V reciben 403 sin cambios en la base) |
| 3 | Solo el administrador aprueba; visitante solo ve publicadas; versión anterior visible hasta aprobar | PASA | F014, F015, F022 a F024 (informes PASA, pruebas en la suite) |
| 4 | Rol solo si el administrador autorizó el ID | PASA | F002, F004, F007, F008 |
| 5 | Sin reservas, pagos ni administración hotelera; solo el prestador cambia el estado de la solicitud | PASA | F032, F033; búsqueda en `src` sin términos de pago, checkout ni reserva |
| 6 | Funciona sola, sin integraciones obligatorias | PASA | Solo Telegram, Supabase y Blob (stack fijo); Maps es un enlace |
| 7 | Ley 1581, aviso antes de recolectar; identidad nunca al visitante | PASA | F001, F036; el número de documento aparece en `src` solo en registro y revisión de prestador (administradores), `types.ts` y el filtro del logger; F027 |
| 8 | Confirmación en operaciones importantes | PASA | F028 y pruebas de cada funcionalidad (cancelar no ejecuta) |

## Tareas cron (`vercel.json`)
| Ruta | Existe en `src` | Protegida por `CRON_SECRET` | Evidencia |
| --- | --- | --- | --- |
| `/api/v1/internal/cron/retention` | Sí | Sí, `Bearer` con `timingSafeEqual`, falla cerrado | `handlers.ts` 583-598; `retention-job.test.ts` 217-235 (401 sin secreto, secreto incorrecto o `CRON_SECRET` vacío) |
| `/api/v1/internal/cron/maintenance` | Sí | Sí, igual | Ídem |
| `/api/v1/internal/cron/outbox` | **No** | No aplica | Ver hallazgo H1 |

## Trazabilidad requisitos a funcionalidades
Cada historia vigente tiene al menos una funcionalidad en `feature_list.json` (campo `stories`), coincidente con la tabla de `docs/02-requisitos.md`:
HU-001 F001, F036; HU-002 F002, F027; HU-003 F003, F007; HU-004 F004, F008; HU-005 F006; HU-006 F005, F007, F009; HU-007 F010; HU-008 F011; HU-009 F012; HU-010 F013, F016; HU-011 F017; HU-012 F018; HU-014 F008, F014; HU-015 F014; HU-016 F015; HU-017 F020; HU-018 F021; HU-019 F022; HU-020 F023, F027; HU-021 F024; HU-024 F030, F037; HU-025 F031; HU-026 F032, F033; HU-027 F028; HU-028 F029; HU-030 F034 a F038.
Fuera de entrega por D-030 (sin funcionalidad, correcto): HU-013, HU-022, HU-023, HU-029 (F019, F025 y F026 no existen en la lista, coherente con esos retiros).
RNF: RNF-021 queda cubierto por F038; RNF-019 (rendimiento y accesibilidad) sigue Pendiente en los requisitos y no es verificable.

## Secretos y .env
- `git ls-files` solo rastrea `.env.example`; `.env` y `.env.*` están en `.gitignore`. No leí `.env`.
- Búsqueda en archivos rastreados de patrones de token de bot, JWT, `vercel_blob_rw_`, `sk_live` y URLs con contraseña: solo aparece `tests/unit/db-ssl.test.ts:4`, con la contraseña de ejemplo `clave` (valor ficticio, no es secreto).
- `qa/evidencia/` y `test-results/` están ignorados por git (ver H3).

## Hallazgos
### Confirmado
- **H1 (media). `vercel.json` programa `/api/v1/internal/cron/outbox` (`0 11 * * *`), pero no existe ninguna ruta en `src/app/api/v1/internal/cron/`** (solo `maintenance` y `retention`). Vercel recibirá un 404 cada día. Además `api/openapi.yaml` (línea 1351, `runOutboxRetryJob`), `src/shared/api/schema.d.ts` (903) y la ADR 0007 (línea 24) todavía describen esa ruta. Origen: D-093 y D-197 decidieron no construir cron/outbox, pero nadie retiró la entrada de `vercel.json`, del OpenAPI ni de la ADR. Efecto: una notificación fallida al prestador no se reintenta (riesgo ya anotado en D-093); contradice el contrato `api/openapi.yaml` frente al código. Reproducir: `ls src/app/api/v1/internal/cron/` y comparar con `vercel.json`. Corrección sugerida (requiere decisión de la usuaria, las decisiones están congeladas): o retirar la entrada de `vercel.json`, del OpenAPI y de la ADR, o construir la ruta.
- **H2 (menor). Evidencias de QA fuera del repositorio.** `.gitignore` excluye `qa/evidencia/` y `qa/evidencias/`; existen 10 carpetas locales (F003, F005, F006, F007, F011, F012, F013, F014, F028, F034) que `git ls-files` no rastrea. La guía de agentes dice que las evidencias son un entregable. Reproducir: `git ls-files qa/evidencia` (vacío). Además hay funcionalidades de las 35 sin carpeta de evidencia (los informes citan las pruebas por nombre).

### Inferido
- **H3.** Si la usuaria quiere entregar las capturas y trazas, debe retirar esa línea de `.gitignore` o guardarlas aparte; no puedo saber si se ignoraron por tamaño o privacidad a propósito.
- **H4.** Por H1, el resumen "el prestador recibe la alerta" depende de un único intento de envío; no probé una caída real de Telegram en producción (solo pruebas con dobles).

### Pendiente
- RNF-019: cifras de rendimiento y accesibilidad sin definir en el contexto.
- Plazo de conservación posterior al 31 de enero de 2027 (RNF-021, D-051): se decide antes de esa fecha, no bloquea la entrega.
- Pruebas en dispositivos reales o Telegram en producción (webhook, Vercel, CRON_SECRET configurado en la plataforma): no verificables sin navegador ni despliegue; no se probó el despliegue.
