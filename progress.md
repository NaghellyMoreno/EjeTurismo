# Bitácora del proyecto

Una línea por trabajo terminado, la más reciente al final.

| Fecha | Funcionalidad | Qué se hizo | Qué sigue |
| --- | --- | --- | --- |
| 2026-11-15 | inicialización | Esqueleto Next.js/TypeScript según ADR 0013 y 0014, ruta `/api/health` con prueba, conexión Kysely, migración inicial vacía, `vercel.json`, `.env.example`, `init.sh` | Escribir el contrato de F001 (modo contrato). Pendiente: Docker y Node 24 en la máquina |
| 2026-11-15 | corrección | Tipos del contrato regenerados con `pnpm api:types` (v0.3.2, /api/health) y prueba de `timestamp` ISO UTC | Escribir el contrato de F001 (modo contrato) |
| 2026-11-15 | corrección | Base local sin Docker (ADR 0014, D-063, D-065): scripts `db:bootstrap`, `db:migrate`, `db:seed`, `db:reset`, `db:test:clean` en `scripts/db/`, `supabase/local/bootstrap.sql`, `init.sh` y `.env.example` actualizados | Instalar `postgresql@17` y verificar los scripts contra el servidor real; contrato de F001 |
| 2026-11-15 | F001 (contrato) | Contrato propuesto en contracts/F001.md con 36 criterios y 5 pendientes | Revisión de qa-evaluator y aprobación; luego implementar F001 |
