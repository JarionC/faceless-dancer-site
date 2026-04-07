# Faceless Dancer Site

Single-box deployment scaffold with:
- Preact frontend
- Express + Postgres backend
- Solana signature auth + holder verification
- Bunny storage uploads
- Admin console APIs for reviewing submissions and downloading assets

## Workspace layout
- `client/` frontend app
- `server/` backend app
- `shared/` shared schemas/types

## Local development
1. Install dependencies:
   - `npm install`
2. Create env file:
   - copy `.env.example` to `.env`
3. Run migrations:
   - `npm run migrate`
4. Start dev servers:
   - `npm run dev`

## Docker (same-box production)
1. Set `.env` in repo root
2. Ensure persistent host dirs exist:
   - `sudo mkdir -p /var/lib/faceless-dancer/data /var/lib/faceless-dancer/beat-storage /var/lib/faceless-dancer/worker-models`
3. Start services:
   - `docker compose up --build -d`
4. App endpoints:
   - frontend: `http://localhost:8080`
   - backend health: `http://localhost:3001/health`

Persistent storage uses absolute host paths outside the repo:
- `POSTGRES_HOST_PATH` (default `/var/lib/faceless-dancer/postgres`) -> Postgres data dir
- `BEAT_STORAGE_HOST_PATH` (default `/var/lib/faceless-dancer/beat-storage`) -> `/app/beat-storage`
- `WORKER_MODELS_HOST_PATH` (default `/var/lib/faceless-dancer/worker-models`) -> `/app/worker-models`

Deployment/startup does not copy, reset, or replace persistent files.
Schema changes are explicit: run migrations manually when you choose.

One-time migration/import helpers:
- `npm run import:db --workspace server` (SQLite backup -> Postgres)
- `npm run import:beat-storage --workspace server` (local beat-storage backup -> Bunny prefix)

## API summary
- `POST /api/auth/nonce`
- `POST /api/auth/verify`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/submissions`
- `GET /api/submissions/me`
- `POST /api/submissions/:submissionId/assets`
- `GET /api/admin/submissions`
- `GET /api/admin/submissions/:submissionId`
- `POST /api/admin/submissions/:submissionId/status`
- `GET /api/admin/assets/:assetId/download`
