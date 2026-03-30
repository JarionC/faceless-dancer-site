# Plan: Use Raw Stem Beat Data In Saved Separation Chart

Date: 2026-03-24

## Goal
In the Saved Major Beats section (after running separation), render chart lanes from raw per-stem beat strength data rather than post-processed extracted stem events.

## Current Behavior
- `SavedMajorBeatsView` decodes each separated stem audio file.
- It runs `extractStemEventsFromAudioBuffer(...)` (post-processing/harmonic-transient splitting/filtering).
- Result is displayed as chart segments.

## Desired Behavior
- Decode each separated stem audio file.
- Compute raw beat strength points directly from each stem (window/hop/smoothing).
- Convert those points into chart segments tied to the original stem label.
- Display those raw stem segments in chart and playback progression.

## Changes
1. `src/components/SavedMajorBeatsView.tsx`
- Replace `extractStemEventsFromAudioBuffer` usage in separated-source loading path.
- Use `extractBeatDataFromAudioBuffer` with runtime config (`beatWindowSize`, `beatHopSize`, `beatSmoothingAlpha`).
- Map each beat point to `SourceEvent`:
  - source: stem label
  - start/end: consecutive point times (or short fixed tail for last point)
  - strength: raw beat point strength

2. Keep fallback behavior unchanged
- If no separated sources, continue using existing saved source events / major beats fallback.

## Validation
- `npm run build`
- Manual check:
  - run separation
  - chart lanes reflect raw stem dynamics without synthetic sub-source labels (`*_hNN`, `*_tNN`).
