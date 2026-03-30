# Stable Source Identity Tracking Plan (2026-03-24)

## Problem
- The same audible instrument can hop between rows/labels over time (e.g. appears as `other`, `piano`, `vocals` at different moments).
- Current labeling is local/per-event and does not enforce temporal identity consistency.

## Goal
- Keep instrument-like sources on stable rows across the timeline.

## Approach
1. Add a post-pass source tracker on separated-stem events
- After extracting all separated events, run a global relabel step that assigns each event to a persistent `track` based on continuity and timbre-proxy similarity.

2. Track assignment logic
- Parse event source labels (`<stem>_hNN` / `<stem>_tNN`) into features:
  - branch (`h` sustain vs `t` transient)
  - band index
  - duration
  - strength
  - parent stem label
- Sort by time and greedily match to existing tracks using a weighted score:
  - time continuity (gap)
  - branch match
  - band proximity
  - duration consistency
  - parent-stem consistency (soft penalty, not hard)
- Create new track only when no existing track is a good fit.

3. Stable row naming
- Replace per-event source labels with persistent track labels:
  - `inst_01`, `inst_02`, ...
- Keep metadata-derived ordering stable by first-appearance time.

4. Config knobs (env + runtime config)
- Add tunables for identity tracking thresholds:
  - max gap seconds
  - band penalty weight
  - stem switch penalty
  - minimum events per track

5. Validation
- `npm run build`
- Replay saved view and verify sustained instruments stay on one row much more consistently.
