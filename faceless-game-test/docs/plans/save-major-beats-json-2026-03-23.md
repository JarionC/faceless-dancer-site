# Save Major Beats Button + JSON Storage Plan (2026-03-23)

## Goal
Add a `Save Major Beats` button under the beat graph that saves detected peak points (timestamp + value) to JSON in a local app storage directory.

## Storage Approach (local app)
Because this is a browser app, direct writes to arbitrary local directories are not available without a backend.
So we will add a lightweight local Node backend to persist files.

## Proposed Changes
1. Add backend server:
- New `server/` module with Express.
- Endpoint: `POST /api/beats/save`
- Payload:
  - entry metadata (`name`, `fileName`, `durationSeconds`, optional id)
  - `majorBeats`: array of `{ timeSeconds, strength }`
- Server writes JSON file to `beat-storage/` in project root.
- File naming: timestamp + sanitized entry name.

2. Frontend button and save flow:
- Add `Save Major Beats` button under graph in `src/components/BeatChart.tsx` or `src/App.tsx` (preferred in App for API call wiring).
- Build payload from current entry + detected peak points.
- POST to backend endpoint.
- Show success/error status message.

3. Runtime config/env:
- Add `VITE_BEAT_API_BASE_URL` in `.env` for frontend-to-backend URL (default `http://localhost:8787`).
- Add backend env var `PORT` if needed.

4. NPM scripts:
- Add script to run backend.
- Add script to run frontend + backend together for local development.

5. Directory creation:
- Ensure `beat-storage/` is auto-created if missing before writes.

## Validation
- Save action creates JSON file in `beat-storage/`.
- File contains only major beat points with timestamp + strength values.
- Existing build/tests continue to pass.
