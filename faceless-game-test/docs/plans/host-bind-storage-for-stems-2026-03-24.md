# Plan: Save Beat Storage Directly on Host Filesystem

Date: 2026-03-24

## Goal
Make saved beat data and per-run stem archives accessible directly on the host filesystem (not hidden in Docker named volumes).

## Changes
1. Update `docker-compose.yml` to replace named volume mounts with bind mounts:
- separation-worker:
  - from `beat_storage:/app/beat-storage`
  - to `./beat-storage:/app/beat-storage`
- backend:
  - from `beat_storage:/app/beat-storage`
  - to `./beat-storage:/app/beat-storage`

2. Keep `worker_models` as named volume (or keep unchanged) to preserve fast model cache behavior.

3. Remove unused `beat_storage` named volume declaration from compose.

4. Validate by restarting services and confirming archived stems appear under host path:
- `D:\faceless-game-test\beat-storage\stem-runs\...`

## Success Criteria
- New separations write stems to host directory under `beat-storage/stem-runs`.
- User can browse files directly in the project folder.
