# Postgres + Bunny Beat Storage Migration Plan (2026-04-07)

## Goal
Move runtime data from SQLite + local beat storage to Postgres + Bunny (`beat-storage` prefix), and provide one-time import services for data in `docs/prod-backups`.

## Current State
- Server runtime DB is SQLite (`better-sqlite3`) with SQL migrations under `server/src/db/migrations`.
- Submission assets are already stored in Bunny (`assets.bunny_object_path`, `assets.bunny_public_url`).
- Game/beat assets are local filesystem under `BEAT_STORAGE_DIR` (`json`, `audio`, `previews`, `separated`, `covers`, `analysis`).
- Worker APIs (`/separate`, `/analyze`, `/preview`) require local filesystem paths.
- Backup directory exists: `docs/prod-backups/beat-storage` and `docs/prod-backups/faceless-dancer-20260407-191330.db`.

## Critical Observation
`docs/prod-backups/faceless-dancer-20260407-191330.db` currently appears empty (no tables). Before DB import execution, we need a valid SQLite snapshot that includes actual schema/data.

## Phase Plan

### Phase 1: Postgres Runtime Support
1. Add Postgres dependency and config (`DATABASE_URL`, pool sizing, SSL toggle).
2. Add Postgres schema migration files equivalent to current SQLite schema.
3. Introduce a DB adapter layer used by modules instead of direct SQLite calls.
4. Port auth/submissions/admin/schedule/siteSettings/game queries to Postgres SQL.
5. Keep API response shapes and behavior unchanged.

### Phase 2: Bunny-Backed Beat Storage
1. Add Bunny beat storage module with prefix `beat-storage`.
2. Store/read all game artifacts in Bunny-compatible paths:
   - `beat-storage/json/...`
   - `beat-storage/audio/...`
   - `beat-storage/previews/...`
   - `beat-storage/separated/...`
   - `beat-storage/covers/...`
   - `beat-storage/analysis/...`
3. Add storage adapter boundary so game routes/services do not depend directly on local fs.

### Phase 3: Worker Compatibility Bridge
1. Keep worker unchanged for now (still local-path based).
2. Add hydrate/sync flow in server:
   - pull required Bunny objects to local worker-shared dir before worker job start,
   - push newly generated outputs back to Bunny after completion.
3. Preserve current worker API contract and operational flow.

### Phase 4: One-Time Import Services
1. `import:prod-db`
   - Read SQLite backup from `docs/prod-backups/*.db`.
   - Insert/upsert into Postgres in FK-safe order.
   - Emit per-table counts and verification summary.
2. `import:prod-beat-storage`
   - Upload all files under `docs/prod-backups/beat-storage` to Bunny under `beat-storage/...`.
   - Support dry-run mode and final summary.

### Phase 5: Docker + Env Wiring
1. Add `postgres` service to `docker-compose.yml`.
2. Update server env config for Postgres + beat storage mode/prefix.
3. Keep existing Bunny submission asset behavior intact.

## Proposed Environment Variables
- `DATABASE_PROVIDER` (`postgres` default for target state)
- `DATABASE_URL`
- `POSTGRES_SSL_MODE` (optional)
- `BEAT_STORAGE_PROVIDER` (`bunny` target state)
- `BEAT_BUNNY_PREFIX` (`beat-storage`)
- `BEAT_LOCAL_CACHE_DIR` (worker hydration cache)

## Risks
- SQLite -> Postgres SQL differences (`datetime('now')`, boolean handling, conflict syntax nuances).
- Inconsistent/incomplete SQLite backup input for one-time DB import.
- Worker sync race conditions if hydrate/upload boundaries are not explicit.

## Verification Checklist
1. Row counts match between source DB and Postgres per table.
2. Spot-check auth/login, submissions, admin queue, schedule, site settings, leaderboards.
3. Game endpoints can read/write beat assets through Bunny pathing.
4. Worker jobs run and artifacts persist back to Bunny.
5. Restarted containers recover correctly with no dependency on prior local beat files.

## Incremental Delivery Order
1. Postgres adapter + schema migration.
2. Port DB modules to adapter.
3. Beat storage adapter with Bunny support.
4. Worker hydrate/sync bridge.
5. One-time import scripts + verification.
