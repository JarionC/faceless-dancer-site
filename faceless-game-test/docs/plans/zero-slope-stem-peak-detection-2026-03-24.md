# Plan: Zero-Slope Stem Peak Detection With Distance Threshold

Date: 2026-03-24

## Goal
Replace stem peak extraction in Saved Major Beats separation view with derivative-based zero-slope maxima detection and minimum distance gating.

## Changes
1. Add new detector module:
- `src/lib/audio/findZeroSlopePeaks.ts`
- Steps:
  - smooth series (moving average)
  - detect local maxima via slope sign change (+ to -)
  - apply min strength and prominence filters
  - enforce minimum peak distance (keep strongest when too close)

2. Add stem-specific runtime/env config:
- `VITE_STEM_PEAK_SMOOTHING_WINDOW`
- `VITE_STEM_PEAK_MIN_STRENGTH`
- `VITE_STEM_PEAK_MIN_PROMINENCE`
- `VITE_STEM_PEAK_MIN_DISTANCE_POINTS`
- wire in `src/config/runtime.ts` and `.env`

3. Use detector in saved separation chart path:
- update `src/components/SavedMajorBeatsView.tsx` to call zero-slope detector instead of current generic prominent-peaks function for separated stems.

## Validation
- `npm run build`
- Visual check: discrete peaks align with local maxima and respect spacing threshold.
