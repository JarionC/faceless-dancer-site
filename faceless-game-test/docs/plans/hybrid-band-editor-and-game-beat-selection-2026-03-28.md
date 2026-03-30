# Hybrid Band Editor + Game Beat Selection Plan (2026-03-28)

## Goal
Add a workflow to:
- tune hybrid band split thresholds and analysis detection thresholds from the frontend,
- drag-select time regions per lane/band (including sustain),
- save selected events as final `gameBeats` for the chosen song,
- have game playback consume `gameBeats` first.

## Scope
1. Backend/API
- Extend analyze start API to accept per-request analysis overrides.
- Pass overrides from API server -> worker.
- Worker uses request overrides with env fallback.
- Add API endpoint to save `gameBeats` + selection metadata onto existing saved entry.

2. Storage/Types/Validation
- Persist `gameBeats`, `gameBeatSelections`, `gameBeatConfig` in saved entry JSON.
- Add payload validation for new save endpoint.
- Update shared TypeScript entry types.

3. Frontend editor
- Add hybrid controls for band boundaries and existing analysis thresholds.
- Add strength filter controls for lane inclusion.
- Add drag-selection on timeline per source lane.
- Build final game beats from selected ranges and save to backend.

4. Game consumption
- `GameView` uses `entry.gameBeats` when available.

5. Config
- Add frontend runtime config defaults and matching values to `.env`.

## Verification
- Build frontend (`npm run build`).
- Manual flow check:
  - run hybrid analysis with custom params,
  - create multi-lane selections,
  - save game beats,
  - reload and confirm game uses saved beats.
