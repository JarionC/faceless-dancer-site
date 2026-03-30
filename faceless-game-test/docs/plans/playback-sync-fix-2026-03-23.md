# Playback Sync Fix Plan (2026-03-23)

## Problem
1. Graph playhead begins before audible audio output.
2. Pause behavior appears delayed relative to the graph/audio timeline.

## Root Cause Hypothesis
- The app starts playhead updates on `onPlay`, which can fire before actual audible output (`onPlaying`).
- Browser audio output latency can make `HTMLAudioElement.currentTime` lead what is heard.
- Native control events can produce timing jitter if we rely on minimal event set.

## Implementation Changes
1. Update `AudioPlayer` event handling:
- Start playhead clock on `onPlaying` instead of `onPlay`.
- Stop clock on `onPause`, `onWaiting`, and `onEnded`.
- On `onSeeking` and `onSeeked`, immediately emit current time for graph alignment.

2. Add configurable latency compensation:
- Add `VITE_AUDIO_OUTPUT_LATENCY_SECONDS` to `.env`.
- Add parser in runtime config.
- When reporting time to graph, use:
  - `displayTime = max(0, audio.currentTime - latencyCompensation)` while playing.
  - clamp to duration.

3. Tighten clock behavior:
- Ensure clock reads adjusted time each animation frame.
- Immediately push an adjusted timestamp at `onPlaying` and `onPause` boundaries.

4. Keep modular structure:
- Any adjustment helper functions in `src/lib/audio/playbackClock.ts` or local component helpers.

## Validation
- Manual check with a short beat-heavy track:
  - Press play: audible first beat should align with playhead onset.
  - Press pause: graph should stop at approximately heard stop point.
  - Seek and resume should remain aligned.
- Build + tests run after patch.
