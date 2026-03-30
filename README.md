# Faceless Dancer Site

Single-box deployment scaffold with:
- Preact frontend
- Express + SQLite backend
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
2. Start services:
   - `docker compose up --build -d`
3. App endpoints:
   - frontend: `http://localhost:8080`
   - backend health: `http://localhost:3001/health`

SQLite persistence in Docker uses host path `./data` mounted at `/app/data`.
On startup, `db-bootstrap` performs a one-time migration: if `./data/faceless-dancer.db`
does not exist but legacy volume `db-data` has one, it copies that DB into `./data`.
Avoid `docker compose down -v` if you still need the legacy `db-data` volume for migration.

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
