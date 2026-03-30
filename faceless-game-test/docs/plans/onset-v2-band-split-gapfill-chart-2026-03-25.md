# Plan: Onset V2 (Band-Split + Adaptive + Gap-Fill) and Chart Split Lanes

Date: 2026-03-25

## Goal
1. Improve hybrid beat detection accuracy by adding:
- low/mid/high split onset streams
- adaptive local thresholding
- second-pass gap fill for missed beats
2. Expose split beat streams in Saved Major Beats chart.

## Changes
1. `worker/hybrid_analyze.py`
- Build low/mid/high onset envelopes from band-limited mel spectrograms.
- Normalize envelopes and detect peaks with adaptive threshold:
  - local median + k * IQR
- Strict pass + permissive gap-fill pass.
- Weighted combine of band envelopes for main `majorBeats`.
- Include `bandBeats` in analysis JSON:
  - `low`, `mid`, `high`, `combined`.

2. `worker/server.py`
- Add env-driven args for analysis v2 settings and pass to `hybrid_analyze.py`.

3. Config wiring
- `.env`, `docker-compose.yml`, `Dockerfile.worker` add v2 tuning vars:
  - band ranges and weights
  - threshold multipliers
  - min-distance and gap-fill settings

4. Frontend chart
- `src/components/SavedMajorBeatsView.tsx`
  - parse and render `bandBeats` as separate source lanes in hybrid mode.
  - retain hybrid sustain lane.

## Validation
- Python compile checks.
- `npm run build`.
- Rebuild/restart stack.
- Run analysis and verify result contains `bandBeats` and chart shows split lanes.
