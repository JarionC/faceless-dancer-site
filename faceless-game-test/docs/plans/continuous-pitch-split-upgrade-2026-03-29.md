# Continuous Pitch Split Upgrade (2026-03-29)

## Goal
Improve sustain pitch-change capture by adding continuous pitch contour splitting (beyond note-event only splitting).

## Plan
1. Worker analysis upgrade
- Compute continuous pitch contour on harmonic signal (`librosa.pyin`).
- Split each sustain event by contour pitch-change boundaries.
- Preserve original timing when contour is unavailable.

2. New tunable controls (override/env + UI)
- Enable Continuous Pitch Split (toggle)
- Pitch Split Threshold (semitones)
- Pitch Split Min Segment (seconds)
- Pitch Split Min Voiced Probability

3. Plumbing
- Add new override fields in frontend `analysisOverrides`.
- Parse and forward through API server -> worker server -> hybrid_analyze CLI.
- Add env defaults (`.env`, `docker-compose.yml`, `Dockerfile.worker`, runtime config defaults).

4. Verify
- Python compile check.
- Frontend build check.
- Ensure existing sustain merge controls still apply after split.
