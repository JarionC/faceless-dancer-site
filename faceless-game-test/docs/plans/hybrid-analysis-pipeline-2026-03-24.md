# Plan: Hybrid Beat + Sustain Analysis Pipeline For DDR Charting

Date: 2026-03-24

## Goal
Replace purely heuristic extraction with a hybrid analysis pipeline aligned with recommendations:
- robust beat timing (tempo + onsets)
- sustain note extraction
- persist results and visualize in app graphs for quality assessment

## Architecture
1. Separation worker adds analysis job endpoints:
- `POST /analyze` (entryId, storageDir)
- `GET /analyze-status/:entryId`
- `GET /analyze-result/:entryId`

2. Analysis algorithm (Python in worker):
- Load song audio.
- Use `librosa` for onset envelope + beat track.
- Fuse beat times and onset times into major beat candidates.
- Attempt sustain extraction via Basic Pitch note events; fallback to librosa harmonic-envelope segments if unavailable.
- Save result JSON under `beat-storage/analysis/<id>.json`.
- Update entry JSON with `hybridAnalysis` metadata.

3. Backend proxy routes:
- `POST /api/analyze/:id/start`
- `GET /api/analyze/:id/status`
- `GET /api/analyze/:id/result`

4. Frontend integration:
- Saved Major Beats view adds controls to run/poll analysis.
- Chart data mode selector:
  - current separated/raw stem peaks
  - hybrid analysis beats+sustains
- Map analysis outputs to chart lanes so quality is visually inspectable.

5. Config/env:
- add analysis env knobs (fuse window, min confidence, sustain fallback thresholds).

## Validation
- Build worker image with new dependencies.
- Run one analysis on saved song and verify JSON output exists.
- `npm run build` passes.
- UI displays hybrid lanes with beats and sustains.
