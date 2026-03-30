# Docker Compose Packaging Plan (2026-03-23)

## Goal
Make the app fully runnable with one command: `docker compose up`.

## Approach
Create two services in Docker Compose:
1. `backend` (Node) serving `POST /api/beats/save` on port `8787`.
2. `frontend` (Vite preview) serving the built UI on port `5173`.

Browser will call backend at `http://localhost:8787`.

## Changes
1. Add `Dockerfile.backend`:
- Base: `node:20-alpine`
- Copy `server/`
- Expose `8787`
- Run `node server/index.mjs`

2. Add `Dockerfile.frontend`:
- Base: `node:20-alpine`
- Copy app sources (`src`, config files, `index.html`, `package*.json`)
- Install deps
- Build frontend with `VITE_BEAT_API_BASE_URL=http://localhost:8787`
- Run `vite preview --host 0.0.0.0 --port 4173`

3. Add `docker-compose.yml`:
- `backend` service maps `8787:8787`
- `frontend` service maps `5173:4173`, depends on backend
- Persist `beat-storage` using a named volume mounted into backend
- Set backend env (`BEAT_API_PORT`, `BEAT_STORAGE_DIR`)

4. Add `.dockerignore` to keep build context small.

5. Update frontend API URL handling if needed:
- Ensure save requests work with configured base URL in containerized run.

## Validation
- `docker compose config` should pass.
- `docker compose up --build` starts both services.
- UI reachable on `http://localhost:5173`.
- Save button writes JSON into backend storage volume.
