# Prominent Peak Detection + Chart Markers Plan (2026-03-23)

## Goal
Detect prominent beat peaks from extracted beat-strength data and render red marker dots on the graph at those peaks.

## Proposed Changes
1. Add a dedicated peak-detection module:
- New file: `src/lib/audio/findProminentPeaks.ts`
- Input: `BeatPoint[]` + detection config.
- Output: peak point indices (or time/value pairs) for prominent local maxima.

2. Make detection configurable via env/runtime config:
- Add to `.env`:
  - `VITE_PEAK_MIN_PROMINENCE`
  - `VITE_PEAK_MIN_STRENGTH`
  - `VITE_PEAK_MIN_DISTANCE_POINTS`
- Add parser/validation in `src/config/runtime.ts`.

3. Wire peak detection in app state flow:
- In `src/App.tsx`, after beat extraction, run peak detection and store peak indices with entry data.
- Extend shared type(s) in `src/types/beat.ts` to include peak marker data.

4. Render peak markers on graph:
- Update `src/components/BeatChart.tsx` to accept peak data.
- Draw small red circles on the beat line at peak locations.
- Keep existing playhead and scroll behavior unchanged.

## Detection Logic (initial)
- A point is a candidate peak if it is greater than immediate neighbors.
- Prominence approximation:
  - compare peak value against local baseline from nearby neighborhood minima.
- Filter by:
  - minimum absolute strength
  - minimum prominence
  - minimum spacing (distance in points) to avoid clustered markers.

## Validation
- Build and tests pass.
- Add unit tests for new peak module:
  - finds peaks on synthetic data
  - respects min prominence/strength
  - respects min distance filter
