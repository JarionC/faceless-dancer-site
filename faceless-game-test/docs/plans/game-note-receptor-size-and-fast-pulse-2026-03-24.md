# Plan: Receptor/Note Pixel Match + Faster Input Pulse

Date: 2026-03-24

## Goal
1. Melody notes and receptor controls match in size so overlap is exact at hit line.
2. Key press pulse becomes much faster/snappier for rhythm timing feedback.

## Changes
- `src/components/GameView.tsx`
  - use shared constants for receptor/note size and lane center alignment.
  - tune pulse timeout from current value to a shorter value.
- `src/styles.css`
  - set receptor and note dimensions to same fixed size.
  - tighten transition durations for pulse animation.

## Validation
- `npm run build`
- visual check: note sits directly over receptor at hit moment.
