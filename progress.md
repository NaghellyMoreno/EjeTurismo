# Bitácora del proyecto

Una línea por trabajo terminado, la más reciente al final.

| Fecha | Funcionalidad | Qué se hizo | Qué sigue |
| --- | --- | --- | --- |
| 2026-11-15 | inicialización | Esqueleto Next.js/TypeScript según ADR 0013 y 0014, ruta `/api/health` con prueba, conexión Kysely, migración inicial vacía, `vercel.json`, `.env.example`, `init.sh` | Escribir el contrato de F001 (modo contrato). Pendiente: Docker y Node 24 en la máquina |
| 2026-11-15 | corrección | Tipos del contrato regenerados con `pnpm api:types` (v0.3.2, /api/health) y prueba de `timestamp` ISO UTC | Escribir el contrato de F001 (modo contrato) |
| 2026-11-15 | corrección | Base local sin Docker (ADR 0014, D-063, D-065): scripts `db:bootstrap`, `db:migrate`, `db:seed`, `db:reset`, `db:test:clean` en `scripts/db/`, `supabase/local/bootstrap.sql`, `init.sh` y `.env.example` actualizados | Instalar `postgresql@17` y verificar los scripts contra el servidor real; contrato de F001 |
| 2026-11-15 | F001 (contrato) | Contrato propuesto en contracts/F001.md con 36 criterios y 5 pendientes | Revisión de qa-evaluator y aprobación; luego implementar F001 |
| 2026-11-15 | F001 (implementar) | Migración `20261115120000_f001_privacy_notice` y semilla del aviso v3; servicios, `initData`, rutas HTTP, webhook y bot grammY (B01 en 3 mensajes, "No acepto", B02); `notice:publish` y `bot:set-webhook`; 121 pruebas (unitarias, integración y bot) | Evaluación de qa-evaluator de F001 (criterios 1 a 40); `postgresql@17` local ya verificado |
| 2026-11-15 | F002 (contrato) | Contrato propuesto en contracts/F002.md con 43 criterios y 6 pendientes (P1 a P6) | Revisión de qa-evaluator y respuesta de la usuaria a P1 y P2; luego implementar F002 |
| 2026-11-15 | F002 (implementar) | Migración `20261115130000_f002_provider_registration`; servicios de registro, cifrado/hash del número, límite por cuenta y sesión del bot; rutas POST y GET `/api/v1/provider-registrations`; guardián de rol provider; B04/B05 en el bot; pruebas de F001 (criterios 10 y 14) ajustadas por D-074; 211 pruebas en verde | Evaluación de qa-evaluator de F002 (criterios 1 a 45); luego F003 |
| 2026-11-15 | F003 (implementar) | Migración 20261115140000_f003_registration_review (notification_outbox y permisos por columna); servicios de listado, aprobación y rechazo en una transacción con guardián admin; rutas GET y POST approval y rejection; aviso al usuario con after() y deliverNotifications; B06, B07 y B20 en el bot; 2 aserciones de F002 ajustadas por D-091; 281 pruebas en verde | Evaluación de qa-evaluator de F003 (criterios 1 a 42); luego F005 (menú de prestador y volver a registrarse tras rechazo, D-094) |
