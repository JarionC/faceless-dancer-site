# Bass Over-Capture + Drum Under-Detection Fix Plan (2026-03-23)

## Problem
- Bass source is over-claiming events (especially sustained regions).
- Drum source is under-detecting distinct hits/transients.

## Fix strategy
1. Source scoring pass (per analysis frame)
- Compute explicit scores for `drums`, `bass`, and synthetic sources.
- `drums`: transient-heavy score (flux-like delta + high-band attack).
- `bass`: low-band score gated by dominance ratio against all non-bass bands.

2. Bass de-bias rules
- Add `bassDominanceRatio` requirement.
- Add `bassMaxSustainSeconds` cap for any single bass segment.
- Split bass segments on valleys and enforce minimum retrigger gap.

3. Drum sensitivity upgrade
- Add `drumTransientGain` multiplier to transient channel.
- Add lower `drumTriggerFloor` and shorter min duration.
- Use peak-preserving merge to keep rapid drum patterns.

4. Conflict resolver
- For overlapping windows, assign/retain source by highest normalized score.
- If drum score exceeds bass by margin, reclassify overlap as drum.

5. Config updates (.env + runtime)
- `VITE_SOURCE_BASS_DOMINANCE_RATIO`
- `VITE_SOURCE_BASS_MAX_SUSTAIN_SECONDS`
- `VITE_SOURCE_DRUM_TRANSIENT_GAIN`
- `VITE_SOURCE_DRUM_TRIGGER_FLOOR`
- `VITE_SOURCE_REASSIGN_MARGIN`

6. Validation
- unit tests for:
  - bass dominance gate
  - bass sustain cap split
  - drum promotion over overlapping bass
- run build/tests and docker build.

## Expected result
- Distinct non-bass beats stop being absorbed by bass.
- Drum lane captures more audible hits.
- Saved playback shows more accurate non-bass activations at those timestamps.
