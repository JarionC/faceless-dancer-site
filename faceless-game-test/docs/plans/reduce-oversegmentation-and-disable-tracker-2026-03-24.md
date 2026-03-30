# Reduce Oversegmentation + Disable Tracker Plan (2026-03-24)

## Problem
- A single-speaker test still fragments into many rows (e.g. 67 layers), indicating over-segmentation in stem event extraction.
- Post-pass grouping is not fixing identity drift and can amplify label churn side effects.

## Changes
1. Disable post-pass grouping
- Remove `stabilizeSourceTracks` call in `SavedMajorBeatsView`.
- Use raw stem extractor output directly (temporarily) as requested.

2. Reduce split factors in stem extraction defaults
- Lower band counts and transient branching aggressiveness by env/runtime defaults:
  - fewer harmonic/transient bands
  - higher base threshold
  - lower transient boost
  - longer minimum durations
  - larger merge gap for sustain continuity

3. Tighten stem extractor to avoid lane explosion
- Add event count guardrails per parent stem:
  - drop ultra-weak sparse sub-bands
  - cap total active sub-source lanes per stem by aggregate strength
- Preserve sustain representation while reducing source churn.

4. Make Demucs runtime more conservative
- Set `DEMUX_SHIFTS` back to a moderate value (e.g. 4) for practical quality/perf.
- Optionally use standard `htdemucs` (4-stem) instead of `htdemucs_6s` to reduce ambiguous cross-labeling.

## Validation
- `npm run build`
- single-speaker 5-minute test should produce a small, stable number of rows (not dozens).
