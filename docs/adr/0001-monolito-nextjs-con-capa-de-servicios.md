# 0001. Un solo proyecto Next.js con una capa de servicios que concentra reglas y autorización

- **Estado:** Propuesta
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.10, 3.11, 3.16 y 3.17 del contexto; RNF-001, RNF-006, RNF-018; guía de agentes (architect)

## Contexto
El stack es fijo (CLAUDE.md): TypeScript, Next.js para la Mini App y las rutas API, grammY por webhook para el bot, PostgreSQL en Supabase, Vercel Blob y publicación en Vercel sin proceso permanente ni disco. El bot y la Mini App son interfaces; el backend concentra lógica, validaciones, autenticación, autorización y persistencia (sección 3.11). El error común de la plataforma es confiar en el `chat_id` o en la interfaz como prueba de rol (guía de agentes).

Hay dos adaptadores de entrada: el webhook de Telegram (bot) y la API HTTP (Mini App y pruebas directas de QA). Si cada uno implementa sus propias reglas, divergen.

## Decisión
1. Un solo proyecto Next.js (App Router) desplegado en Vercel contiene: la Mini App (páginas), la API HTTP `/api/v1/...` y la ruta del webhook del bot `/api/v1/telegram/webhook`.
2. Toda regla de negocio y toda autorización vive en una **capa de servicios** (`src/server/services`). Cada servicio recibe un `Actor` construido por el backend (nunca por la interfaz) y verifica en cada llamada: cuenta, aceptación del aviso vigente, rol activo leído de la base de datos, negocio al que pertenece el recurso y permiso.
3. Los dos adaptadores (route handlers de la API y manejadores de grammY) solo traducen entrada y salida; llaman a los mismos servicios. El bot llama a los servicios dentro del mismo proceso, no a la API por HTTP.
4. Una regla de ESLint (`no-restricted-imports`) impide que `src/app` y `src/bot` importen `src/server/db` o `src/server/storage`; solo pueden importar `src/server/services`. Así no existe un camino a los datos que salte la autorización.
5. La base de datos repite las reglas críticas como restricciones y disparadores (ADR 0002), de modo que un error en un servicio no rompe un invariante.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Bot que llama a la API HTTP propia | Un único punto de entrada HTTP | Salto de red extra por cada mensaje, doble serialización, más latencia en una función serverless; misma garantía que llamar al servicio |
| Proyectos separados para bot y Mini App | Despliegues independientes | Duplica configuración, variables y tipos; el contexto aprobó backend y Mini App en el mismo proyecto (sección 3.17) |
| Autorización en cada adaptador | Rápido de escribir | Diverge entre bot y Mini App; contradice la sección 3.11 |

## Consecuencias
- Más fácil: una sola fuente de reglas, probada una vez para ambos canales; QA puede atacar la API directamente (F007, F008, F016, F033) y obtiene el mismo resultado que por el bot.
- Más difícil: la capa de servicios debe diseñarse con contratos claros (entrada validada, `Actor`, resultado o error tipado).
- Funciona sola (invariante 6): sin integraciones con otros aplicativos; Google Maps es solo un enlace (ADR 0016).
