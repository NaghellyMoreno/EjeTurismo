# 0016. Ubicación como enlace de Google Maps validado, sin integración

- **Estado:** Propuesta
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.7 y 3.11; HU-018; D-003; invariante 6; CLAUDE.md (Stack: ubicación mediante enlace a Google Maps)

## Contexto
La ubicación se muestra con un enlace a Google Maps (sección 3.7) y es campo obligatorio (D-003). La solución debe funcionar sola (invariante 6). Rechazar enlaces que no sean de Google Maps viene de HU-018, criterio 2, y es una regla aprobada en D-044.

## Decisión
- Se guarda solo el texto del enlace (`maps_url`). No se llama a ninguna API de Google, no se usan claves ni se calculan coordenadas.
- Validación en el dominio: URL `https`, sin usuario ni contraseña, con host en la lista permitida `google.com`, `www.google.com` (ruta que empieza por `/maps`), `maps.google.com`, `maps.app.goo.gl` y `goo.gl` (ruta que empieza por `/maps`); longitud máxima técnica de 2048 caracteres. La lista es Inferida (HU-018 criterio 2) y está en un solo módulo para ajustarla.
- El bot muestra un botón con tipo `url` que abre el enlace; la Mini App usa `Telegram.WebApp.openLink`.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Integración con la API de Google Maps | Mapas embebidos | Clave, costo y dependencia externa; contradice "solo enlace" |
| Aceptar cualquier URL | Simple | Permite enlaces engañosos en fichas publicadas |

## Consecuencias
- Más fácil: sin costo ni credenciales adicionales.
- No se verifica que el enlace apunte al lugar correcto; eso lo revisa el administrador al aprobar.
