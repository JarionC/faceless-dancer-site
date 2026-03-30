# Chart Width/Scroll UX Plan (2026-03-23)

## Goal
Make beat graph less compressed by increasing horizontal resolution, while allowing horizontal scroll in its container.

## Changes
1. Update `src/components/BeatChart.tsx`:
- Replace fixed chart width (`1000`) with dynamic width based on duration/point count.
- Use a larger minimum width (for example 1800px) so short/medium tracks are still readable.
- Keep x-axis and playhead math tied to computed width.

2. Keep scroll behavior:
- Continue using `.chart-wrapper { overflow-x: auto; }`.
- Ensure SVG renders at intrinsic computed pixel width and does not shrink to container width.

3. Minor style tweak in `src/styles.css`:
- Keep responsive behavior, but allow horizontal panning comfortably.

## Validation
- Build and test run.
- Manual check: long track shows clear waveform progression and horizontal scroll is available.
