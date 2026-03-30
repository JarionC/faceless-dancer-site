# Live Chart Filter + Varied Lane Assignment (2026-03-28)

## Goal
1. Make lane `Min Strength` thresholds live-filter what is shown on the Hybrid chart.
2. Make gameplay lane assignment varied even when notes come from the same source band.

## Changes

### A) Live chart filtering by lane thresholds
- In `SavedMajorBeatsView`, when `Chart Data = Hybrid`, filter rendered `sourceEvents` by `laneStrengthThresholds` before drawing.
- Apply same filtered set to selection and beat-saving logic so chart view and saved output match exactly.
- Keep non-hybrid modes unchanged.

### B) Varied lane assignment for game notes
- Replace source-locked lane mapping in `melodyChartService` with a spread strategy:
  - Primary lane seed from time/strength/index.
  - Anti-repeat rule to avoid consecutive same lane.
  - For near-simultaneous notes, distribute across different lanes before reuse.
- Preserve support for overlapping notes (multiple lanes active at once).

### C) Verify
- Build (`npm run build`).
- Manual sanity:
  - Raising min strength hides weaker chart notes in Hybrid mode.
  - Saved game beats reflect filtered chart.
  - Notes from same band still produce varied lane patterns.
