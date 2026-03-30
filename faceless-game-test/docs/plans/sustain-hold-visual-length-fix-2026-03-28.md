# Sustain Hold Visual Length Fix (2026-03-28)

## Problem
Saved sustain notes are present, but in GameView the rendered hold tails appear too short and too similar in length.

## Root Cause
Current tail rendering clamps hold height too aggressively (`Math.min(72, ...)`), compressing duration differences visually.

## Plan
1. Remove aggressive max clamp for hold-tail display length.
2. Map sustain duration to visual lane travel proportion directly:
   - hold tail length ~ `(duration / approachSeconds) * travelDistance`.
3. Keep a small minimum tail size only for readability.
4. Verify hold logic remains unchanged (timing/scoring still based on `endSeconds`).
5. Build check.
