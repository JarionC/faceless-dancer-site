# Pitch-Aware Sustain Controls (2026-03-28)

## Goal
Improve sustain quality by adding pitch-aware controls:
1. Sustain Max Pitch Jump (semitones)
2. Split Sustains On Pitch Change (toggle)
3. Min Pitch Confidence (filter)

## Plan
1. Worker analysis logic
- Add override/env args for the 3 controls.
- Filter Basic Pitch note events by min confidence.
- In sustain merge logic:
  - enforce max semitone jump when both notes have pitch,
  - optionally force split on pitch change when toggle is enabled.

2. Worker/server plumbing
- Parse new override fields in `worker/server.py`.
- Pass through to `hybrid_analyze.py` CLI.
- Add env defaults to `.env`, `docker-compose.yml`, and `Dockerfile.worker`.

3. Frontend runtime + controls
- Add defaults to `runtimeConfig` and `.env` frontend vars.
- Add controls to Hybrid Analyze panel with help bubbles.
- Send values in `analysisOverrides`.

4. Verify
- Python compile check.
- Frontend build check.
- Confirm no regressions in save/select flow.
