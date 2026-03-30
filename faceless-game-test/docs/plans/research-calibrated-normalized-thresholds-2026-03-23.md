# Research-Based Normalized Threshold Calibration Plan (2026-03-23)

## Research conclusions (primary sources)
1. Librosa onset detection normalizes envelopes to [0,1] before picking, and uses optimized defaults with `delta=0.07` and `wait=30ms`.
   Source: https://librosa.org/doc/main/generated/librosa.onset.onset_detect.html
2. Librosa source docs show the same calibrated defaults from large-scale search (`delta=0.07`, `wait~30ms`, adaptive avg/max windows around 100ms).
   Source: https://librosa.org/doc/0.11.0/_modules/librosa/onset.html
3. Aubio docs indicate onset peak thresholds are typically in `[0.001, 0.900]`, with practical defaults around `0.3`, and min inter-onset around `20–30ms`.
   Source: https://aubio.org/manual/0.4.7/cli.html
4. madmom beat/downbeat processors often operate with very low activation thresholds (e.g. 0 or 0.05), because outputs are probabilistic activations and are filtered by the sequence model.
   Source: https://madmom.readthedocs.io/en/v0.16.1/modules/features/beats.html
5. MIR peak-picking references recommend adaptive local thresholds + minimum distance constraints; MSAF examples use local median + relative offset around `0.05` after normalization.
   Source: https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S1_PeakPicking.html

## What this implies for our normalized extractor
Our per-source envelopes are normalized [0,1], so thresholding should be:
- low trigger floor near onset deltas (`~0.07-0.12`) for transient capture,
- higher class thresholds (`~0.18-0.35`) to avoid over-labeling,
- strict bass dominance constraint to prevent bass over-capture,
- `~30ms` minimum inter-onset as default.

## Proposed calibrated defaults (set in .env)
- `VITE_SOURCE_DRUMS_THRESHOLD=0.22`
- `VITE_SOURCE_DRUM_TRIGGER_FLOOR=0.08`
- `VITE_SOURCE_DRUM_TRANSIENT_GAIN=1.8`
- `VITE_SOURCE_BASS_THRESHOLD=0.32`
- `VITE_SOURCE_BASS_DOMINANCE_RATIO=1.40`
- `VITE_SOURCE_BASS_MAX_SUSTAIN_SECONDS=0.70`
- `VITE_SOURCE_OTHER_THRESHOLD=0.18`
- `VITE_SOURCE_REASSIGN_MARGIN=0.10`
- `VITE_SOURCE_MIN_INTER_ONSET_SECONDS=0.03`
- `VITE_SOURCE_ADAPTIVE_THRESHOLD_WINDOW=16`
- `VITE_SOURCE_TRANSIENT_HOP_SCALE=2`

## Additional “based on current song data” adjustment
Implement per-song adaptive thresholds from envelope statistics:
- Compute P50/P75/P90 for each source envelope.
- Effective threshold = `max(config_floor, P75 + 0.15*(P90-P75))` for sustained sources.
- Drum effective threshold = `max(drum_floor, P50 + 0.10*(P90-P50))`.
This keeps defaults grounded in research while adapting to each track’s dynamic profile.

## Validation
1. Build/tests pass.
2. Compare event distribution before/after on uploaded tracks:
- lower bass share when false positives were present,
- higher drum event recall on distinct non-bass hits,
- source balance no longer dominated by bass lane.
