# Save Audio + Synced Saved-Beats View Plan (2026-03-23)

## Research-backed sync approach (primary sources)
- `AudioBufferSourceNode.start(when, offset)` supports precise scheduling on the AudioContext clock.
- `AudioContext.getOutputTimestamp()` exposes the context time that is actually being rendered by output hardware.
- `AudioContext.outputLatency` / `baseLatency` can be used as fallback latency estimates.
- `HTMLMediaElement.currentTime` can be precision-reduced in some browsers (not ideal for exact beat timing).

Implication:
For near sample-accurate beat visualization, use Web Audio playback clock (not `<audio>` element time) and derive current heard position from output timestamp.

## Feature Goals
1. Saving major beats must also persist the associated uploaded song file.
2. Add a new saved-session view that loads stored JSON + audio and plays with real-time major-beat progression.
3. Use a precision sync engine based on Web Audio API timing.

## Backend changes
1. Extend save payload to include audio bytes from the uploaded file:
- `audioFileName`, `audioMimeType`, `audioBase64` (frontend-generated)
- increase JSON body limit safely via env config.

2. Storage layout:
- `beat-storage/json/*.json` for saved major-beat JSON.
- `beat-storage/audio/*` for saved song files.

3. Save endpoint updates (`POST /api/beats/save`):
- validate beat payload + audio metadata
- decode base64 and write audio file
- write JSON with reference to audio file path/name

4. New retrieval endpoints:
- `GET /api/beats/list` -> list saved entries (id, name, duration, counts, created time)
- `GET /api/beats/:id` -> full saved JSON (major beats etc.)
- `GET /api/beats/:id/audio` -> stream associated song file

## Frontend changes
1. Save flow updates in `App.tsx`:
- keep original uploaded `File` in state
- on save: include major beats + audio base64 payload
- show save status

2. New saved-beats section/UI:
- list saved entries from backend
- select entry and load its JSON + audio
- display major beat timeline chart (dots + progression line)

3. Precision playback module:
- new modular engine `src/lib/audio/precisePlaybackEngine.ts`
- playback via `AudioContext` + `AudioBufferSourceNode`
- compute heard time from:
  - preferred: `getOutputTimestamp().contextTime`
  - fallback: `currentTime - (outputLatency || baseLatency || 0)`
- support play/pause/seek/restart with source-node recreation
- expose `currentTime` updates to UI via animation frame loop

4. Realtime beat highlighting:
- as current heard time moves, highlight major beat dots at exact timestamps (small activation window)
- maintain moving playhead synced to same timing source

## Sync constraints and acceptance
- Absolute perfection across all hardware/OS stacks cannot be mathematically guaranteed in browser environments.
- This plan implements best-available browser timing model from Web Audio API and hardware output timestamps.

Acceptance checks:
- No start/pause drift noticeable vs heard audio.
- Major beat markers trigger at scheduled timestamps while playing saved tracks.
- Seek preserves alignment.

## Env/runtime additions
- `BEAT_API_MAX_BODY_BYTES` for large audio JSON payloads.
- optional tuning window for beat activation visualization.

## Validation
- existing tests/build pass
- add unit tests for precise playback time math helpers where practical
- manual sync tests on saved tracks.
