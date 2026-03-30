# Plan: Onset-Only Hybrid Beats + DDR Hit Candidate Source

Date: 2026-03-25

## Goal
1. Make `hybrid_beat` use onset detection only (no beat_track fusion).
2. Use those hybrid beats as DDR hit candidates in game mode.

## Changes
1. Worker analysis (`worker/hybrid_analyze.py`)
- Replace beat/onset fusion with onset-only extraction.
- Keep onset strength normalization.
- Apply stronger thinning rules:
  - minimum onset strength threshold
  - minimum distance in seconds between accepted onsets
- Output these as `majorBeats` in analysis JSON.

2. New env knobs
- `BEAT_ANALYSIS_ONSET_MIN_STRENGTH`
- `BEAT_ANALYSIS_ONSET_MIN_DISTANCE_SECONDS`
- Wire into `.env`, `docker-compose.yml`, `Dockerfile.worker`, and worker runtime reading.

3. DDR integration (`src/components/GameView.tsx`)
- On song load, try `GET /api/analyze/:id/result`.
- If analysis exists, use `result.majorBeats` as melody note timing source.
- Fallback to saved red-dot major beats if no analysis result.

4. Keep graph mode behavior
- `Hybrid Beats + Sustains` remains visible in Saved Major Beats; hybrid beats will now be onset-only and less repetitive.

## Validation
- rebuild worker + frontend/backend services
- run analysis for a saved song
- verify analysis result beat count is reduced vs prior run
- verify game mode uses analysis beats when available
