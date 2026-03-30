# Docker Env Propagation Fix Plan (2026-03-23)

## Problem
Frontend container build does not include `.env`, so Vite uses code fallback values instead of user-configured `VITE_PEAK_*` settings.

## Fix
1. Update `Dockerfile.frontend` to include `.env` in build context before `npm run build`.
2. Keep `VITE_BEAT_API_BASE_URL` build arg override so API URL remains explicit.
3. Rebuild frontend image and verify compiled app reflects `.env` peak settings.

## Validation
- `docker compose build frontend` succeeds.
- Running app shows peak markers based on `.env` values (`0.05`, `0.1`, `8`).
