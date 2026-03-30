# Sustain Merge Controls (2026-03-28)

## Goal
Add two sustain-fragmentation controls and expose them in Hybrid Analyze Controls:
- Sustain Merge Gap (s)
- Sustain Bridge Floor

## Plan
1. Worker sustain post-processing
- Add merge routine after sustain extraction.
- Merge adjacent sustains when gap <= merge gap.
- Apply bridge check using gap energy ratio vs neighboring sustain strengths.

2. Worker/API override plumbing
- Add env defaults and request override fields:
  - `sustainMergeGapSeconds`
  - `sustainBridgeFloor`
- Pass through worker server -> hybrid_analyze CLI.

3. Frontend controls
- Add both controls to Hybrid Analyze Controls with help bubbles.
- Include values in analysis overrides payload.
- Persist defaults in runtime config + `.env`.

4. Verification
- Build and confirm no type/runtime regressions.
