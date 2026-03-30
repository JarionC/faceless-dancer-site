# Source-Aware Extraction + Sustain Rendering Plan (2026-03-23)

## Goal
Update extraction and visualization so:
1. extracted events are source-aware (`drums`, `bass`, `other`, optional `vocals` placeholder),
2. graph uses different colors per source,
3. notes are elongated by sustain duration,
4. playback highlights active source notes in real time.

## Practical scope for current app
The discussion document describes a heavy ML stack (Demucs/Basic Pitch/madmom). Running that full stack in-browser is not realistic.

So this implementation will:
- add a modular extraction architecture aligned to that pipeline shape,
- implement a local heuristic extractor now (band/transient based) that outputs source-tagged sustain events,
- keep interfaces ready for future backend Demucs/Basic Pitch/madmom integration.

## Data model changes
1. Add a new note-event type:
- `source`: `drums | bass | other | vocals`
- `startSeconds`, `endSeconds`, `durationSeconds`
- `strength`
- optional `pitch`/`class` placeholders

2. Keep existing beat points, but add source note events for graph/playback.

## Extraction changes
1. New module: `src/lib/audio/extractSourceEvents.ts`
- `drums`: transient/onset events from high-frequency attack envelope (short sustain)
- `bass`: low-frequency envelope segments with threshold-crossing sustain estimation
- `other`: mid/high band energy segments with sustain estimation

2. Config in `.env` + runtime:
- thresholds/window sizes/min sustain durations per source

## Graph changes
1. Replace dot-only peak view with source note lanes/segments:
- render horizontal elongated segments from `startSeconds` to `endSeconds`
- color by source

2. Keep current playhead and add active-note emphasis at current playback time.

## Playback changes
1. In both live extraction view and saved view:
- while playing, highlight notes where `start <= currentTime <= end`
- use existing precise timing engine for saved playback

## Save/load schema changes
1. Save source events with sustains to JSON (in addition to major beat points).
2. Saved view uses source events if present; fallback to major beats if older JSON.

## Styling changes
- Define source color map in CSS variables (drums/bass/other/vocals)
- Ensure legend is shown in the graph UI

## Validation
- Build + tests pass
- manual check: colored source segments with variable lengths are visible
- playback: active note highlighting follows playhead in real time
