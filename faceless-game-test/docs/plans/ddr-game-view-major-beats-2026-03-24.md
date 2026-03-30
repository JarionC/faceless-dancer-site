# Plan: DDR-Style Melody Game View (Using Saved Red Dots)

Date: 2026-03-24

## Goal
Add a gameplay view where user selects a saved song, plays it in sync, and hits arrow inputs (Left/Up/Down/Right) against incoming notes generated from saved melody beats (currently red-dot major beats).

## Scope
- New frontend game module/view.
- Uses existing saved entry API and existing precise playback engine.
- Melody-note service abstraction point added, with initial implementation backed by saved `majorBeats`.

## Implementation
1. New `GameView` component
- Song/session selector using `GET /api/beats/list` and `GET /api/beats/:id`.
- Loads song audio via `GET /api/beats/:id/audio` into precise playback engine.
- Square game area with top receptor row: left/up/down/right.
- Notes rise upward and meet receptor at exact beat timestamp.
- Keyboard input support: ArrowLeft/ArrowUp/ArrowDown/ArrowRight.

2. Note generation abstraction
- Add melody chart adapter function that currently maps `entry.majorBeats` -> timed notes + lane assignment.
- Keep this function isolated so it can later call an external melody-beat service without rewriting UI/game loop.

3. Timing + judgement system
- Judgement windows (configurable):
  - perfect
  - great
  - good
  - poor
  - miss
- Use heard-time from precise playback engine for hit tests.
- Auto-mark misses for notes passing miss window.

4. UI + state
- Display judgements, combo, totals by bucket.
- Play/Pause/Restart controls.
- Ensure sync visualization updates via RAF tied to playback time.

5. Runtime/env config
- Add VITE runtime config for:
  - approach time (note travel)
  - judgement window thresholds
  - receptor layout constants (if needed)
- Update `.env` and `src/config/runtime.ts`.

6. App integration
- Add game section in `App.tsx` (below existing tools).

## Validation
- `npm run build`
- Manual timing sanity check on a saved session:
  - Notes visually hit receptor exactly at beat time.
  - Judgement bucket changes correctly by timing offset.

## Non-goals (this pass)
- Click/tap receptor input (future pass).
- Backend melody service implementation (only abstraction hook now).
