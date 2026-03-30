# High-Density Source UI + Detail-Sensitive Extraction Plan (2026-03-23)

## Goals
1. Make graph/playback UIs handle many sources cleanly.
2. Improve extraction sensitivity so more distinct beats and note changes are captured.

## Part A: UI for many sources
### Problems today
- Fixed lane spacing can become cramped with many `source_XX` lanes.
- Labels/legend become noisy with many sources.
- Vertical space not adaptive to lane count.

### Changes
1. Dynamic chart height based on source count:
- `height = base + laneCount * laneGap`
- maintain horizontal scroll and add vertical scroll in chart wrapper when needed.

2. Source grouping/order:
- Prioritize named sources first (`drums`, `bass`, `vocals`, `guitar`, `piano`).
- Then `source_XX` sorted numerically.

3. Visual clarity in dense mode:
- thinner lane lines and segment widths when lane count is high.
- sticky legend row with compact chips and overflow wrapping.
- optional lane filter toggles (show/hide source) in chart and saved playback.

4. Playback chart parity:
- Apply the same dynamic-lane rendering strategy in `SavedMajorBeatsView`.

## Part B: Better detail pickup in extraction
### Problems today
- Current heuristic may under-detect short note changes/transients.
- Thresholding can miss low-intensity but relevant events.

### Changes
1. Multi-resolution extraction pass:
- run two passes: fast hop for transients + medium hop for sustains.
- merge events across passes.

2. Adaptive thresholds per source band:
- threshold from local percentile (rolling baseline) instead of fixed absolute only.
- keep env-controlled floor values.

3. Segment split/merge refinement:
- split long events at internal valleys to capture note changes.
- merge very tiny adjacent fragments to avoid noise.

4. Optional event cap controls:
- add env controls for max events/sec and min inter-onset distance to tune density without flooding.

## Config additions
- `VITE_SOURCE_UI_MAX_VISIBLE_LANES`
- `VITE_SOURCE_DYNAMIC_LANE_GAP_MIN`
- `VITE_SOURCE_TRANSIENT_HOP_SCALE`
- `VITE_SOURCE_ADAPTIVE_THRESHOLD_WINDOW`
- `VITE_SOURCE_MIN_INTER_ONSET_SECONDS`

## Validation
- Build/tests pass.
- Manual check with dense track:
  - many sources remain readable in both charts.
  - more short note changes/transients appear.
  - playback highlighting remains synced.
