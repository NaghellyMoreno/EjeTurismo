# Eje Turismo

Plataforma de promoción y descubrimiento de destinos, atractivos, servicios y experiencias turísticas de Manizales y los municipios del Eje Cafetero. La usan visitantes, prestadores turísticos y administradores, principalmente mediante un bot de Telegram y una Telegram Mini App, respaldados por un backend con roles y permisos.

**Fuente de verdad del producto:** `docs/00-contexto-producto.md`. Ningún requisito, diseño ni código puede contradecirlo. Léelo por secciones, según la tarea.

**Sistema de agentes:** los agentes y skills son genéricos y están instalados en `~/.claude`. Las reglas propias de este proyecto para cada agente están en `docs/guia-agentes.md`.

## Reglas de trabajo
- Redacta en español: documentos, interfaz, mensajes al usuario y commits.
- La IA propone; la usuaria decide y valida.
- No inventes reglas, cifras, normas, integraciones ni comportamientos. Si falta información, pregunta. Si eres un subagente y no puedes preguntar, detente en ese punto y repórtalo como pendiente al orquestador.
- Distingue siempre **Confirmado**, **Inferido** y **Pendiente**. Una inferencia nunca se vuelve regla sin aprobación.
- Si una tarea contradice el contexto del producto, señala la contradicción y detente.
- Las decisiones de `docs/decisiones.md` están congeladas: no se modifican ni se reabren. Las dudas se resuelven en máximo 3 rondas.
- Para citar el contexto escribe "sección 3.4". No uses el símbolo de párrafo.

## Stack y publicación (fijos)
- Lenguaje: TypeScript
- Frontend: Telegram Mini App en Next.js; el bot es la interfaz conversacional (comandos, botones, formularios)
- Backend: Next.js (rutas API) y grammY para el bot, por webhook
- Base de datos: PostgreSQL en Supabase. Fotografías en Vercel Blob. Ubicación mediante enlace a Google Maps
- Publicación: Vercel. Funciones serverless sin proceso permanente (el bot usa webhook, no polling) y sin disco persistente (base de datos y fotos en servicios externos)

## Mapa del repositorio
| Ruta | Contenido | Quién escribe |
| --- | --- | --- |
| `docs/00-contexto-producto.md` | Contexto aprobado del producto | Solo la usuaria |
| `docs/guia-agentes.md` | Reglas del proyecto para cada agente | Solo la usuaria |
| `docs/decisiones.md` | Decisiones congeladas (solo se agrega con `>>`) | orchestrator agrega; nadie modifica |
| `docs/01-brief.md`, `docs/02-requisitos.md` | Brief y requisitos | product-manager |
| `docs/03-arquitectura.md`, `docs/adr/` | Arquitectura y decisiones | architect |
| `api/openapi.yaml` | Contrato entre frontend y backend | architect |
| `docs/04-readiness.md` | Revisión de preparación | readiness-reviewer |
| `feature_list.json` | Funcionalidades y estado `passes` | product-manager crea; solo qa-evaluator cambia `passes` |
| `contracts/<id>.md` | Contrato de terminado por funcionalidad | developer propone, qa-evaluator revisa |
| `qa/<id>.md` | Informe de QA por funcionalidad | qa-evaluator |
| `progress.md` | Bitácora: una línea por trabajo terminado | developer |
| `init.sh` | Levanta el entorno y corre una prueba de humo | developer |

## Flujo
- Modo proyecto: `claude --agent orchestrator`. Modo cambio (ajustes pequeños): `claude`.
- Una funcionalidad a la vez, con contrato aprobado antes de escribir código.
- Al empezar una sesión de código: leer `progress.md`, `git log --oneline -10` y ejecutar `./init.sh`.
- Git: nunca ejecutes `git init` ni configures remotos; los crea la usuaria. Si no hay repositorio, detente y pídeselo.

## Invariantes del producto (el código nunca los rompe)
1. Cada operación verifica en el backend usuario, rol, negocio al que pertenece y permisos; nunca se confía solo en el bot ni en la Mini App (sección 3.11).
2. La información de cada negocio está separada; un prestador solo ve y edita lo suyo (sección 3.12).
3. Solo el administrador aprueba o rechaza lo que registra un prestador. El visitante solo ve fichas publicadas; al editar una ficha publicada, la versión anterior sigue visible hasta que se apruebe la nueva (sección 3.3).
4. El rol de administrador o prestador existe solo si el administrador autorizó el ID de Telegram (secciones 2.3 y 3.16).
5. No hay motor de reservas, pagos ni administración hotelera; las solicitudes de información o interés se remiten al prestador, que es el único que cambia su estado (secciones 3.8 y 3.14).
6. La solución funciona sola; ninguna integración con otros aplicativos es requisito (sección 3.11).
7. Los datos personales se tratan conforme a la Ley 1581 de 2012, con aviso de privacidad aceptado antes de recolectarlos; el número de identidad nunca se muestra al visitante (sección 3.15).
8. Las operaciones importantes piden confirmación antes de ejecutarse (sección 3.12).

## Seguridad
- Credenciales solo en `.env` y en las variables de entorno de la plataforma. `.env` nunca se lee ni se sube al repositorio; `.env.example` lleva los nombres sin valores. Incluye el token del bot de Telegram y las claves de Supabase y Vercel Blob.

## Convenciones
- Zona horaria: America/Bogota 
- Identificadores de código en inglés; textos visibles para el usuario en español.
- Un commit por funcionalidad o corrección, con mensaje descriptivo.

## Identidad visual
Solo modo claro. Estos colores son los únicos permitidos; se definen una vez como variables de estilo y no se inventan otros. Los cinco primeros salen del logo y la paleta de la usuaria; texto y primario oscuro fueron aprobados por ella.

| Rol | Hex | Uso |
| --- | --- | --- |
| Primario | `#659287` | Fondos de marca, encabezados, elementos decorativos |
| Primario oscuro | `#3F6B5F` | Botones y énfasis con texto (blanco sobre este color) |
| Secundario | `#88BDA4` | Elementos secundarios, estados activos |
| Suave | `#B1D3B9` | Tarjetas, divisores, fondos de sección |
| Fondo claro | `#E6F2DD` | Fondo general de la aplicación |
| Acento | `#C1FF72` | Detalles puntuales (insignias, resaltados); nunca como color de texto |
| Texto | `#1F3A33` | Texto principal |

Reglas de contraste (WCAG, mínimo 4.5 para texto normal):
- Texto `#1F3A33` sobre fondo claro, suave, secundario o acento: permitido.
- Blanco sobre primario oscuro `#3F6B5F`: permitido.
- Texto claro, blanco o acento sobre primario `#659287`: no permitido (contraste cercano a 3); solo para texto grande o decorativo.

## Convenciones de commits
Todo commit sigue Conventional Commits: `tipo(alcance opcional): descripción`. El tipo va en inglés y en minúscula; la descripción va en español, en imperativo o infinitivo, sin punto final y de máximo ~72 caracteres. Ejemplo: `feat(bot): agregar comando /destinos`.

| Tipo | Cuándo usarlo |
| --- | --- |
| `feat` | Se agrega una funcionalidad nueva (por ejemplo, una de `feature_list.json`) |
| `fix` | Corrección de un error |
| `docs` | Cambios solo en documentación (docs, README, comentarios) |
| `style` | Formato o estilos que no afectan la lógica (espacios, ajustes visuales) |
| `refactor` | Reestructurar código sin cambiar su comportamiento |
| `test` | Agregar o corregir pruebas |
| `chore` | Configuración, dependencias y tareas de mantenimiento |

- Un commit usa un solo tipo; si el cambio mezcla tipos, se divide en varios commits.
- Todos los agentes y sesiones que hagan commits respetan esta convención.
