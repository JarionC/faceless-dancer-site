# Sustain Min Length Control (2026-03-28)

## Goal
Add a user-controlled minimum sustain duration so only sustains at or above that length are shown and used.

## Scope
1. Worker analysis
- Add `sustainMinDurationSeconds` override/env support.
- Filter Basic Pitch note events by min duration.
- Use same minimum for fallback harmonic sustain detection.

2. Config
- Add env defaults for worker (`BEAT_ANALYSIS_SUSTAIN_MIN_DURATION_SECONDS`).
- Add frontend runtime default (`VITE_HYBRID_ANALYSIS_SUSTAIN_MIN_DURATION_SECONDS_DEFAULT`).

3. Frontend controls + behavior
- Add `Sustain Min Duration (s)` in Hybrid Analyze Controls.
- Pass it in analysis overrides when re-running analysis.
- Live-filter hybrid sustain events in chart and selection/save flow using current control value.

4. Verify
- Build and sanity-check flow.
