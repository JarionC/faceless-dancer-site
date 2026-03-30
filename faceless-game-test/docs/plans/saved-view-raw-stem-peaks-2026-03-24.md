# Plan: Raw Stem Peaks Instead of Continuous Envelope

Date: 2026-03-24

## Goal
In Saved Major Beats separation chart, keep using raw stem data but render discrete beat/onset events (peaks) rather than continuous sustained segments.

## Changes
1. In `src/components/SavedMajorBeatsView.tsx`:
- For each separated stem audio:
  - compute raw beat series with `extractBeatDataFromAudioBuffer`
  - run `findProminentPeakIndices` on that series
  - map only peak points to short `SourceEvent` notes
- Use slightly more sensitive peak params than global defaults for stem-local detail.

2. Keep fallback paths unchanged when no separated stems are present.

## Validation
- `npm run build`
- Visual result should show individual beat notes instead of solid lanes.
