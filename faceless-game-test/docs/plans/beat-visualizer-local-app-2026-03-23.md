# Beat Visualizer Local App Plan (2026-03-23)

## Goal
Build a local web app where a user can:
1. Upload an audio file and provide an entry name.
2. Extract beat-strength-over-time data from the uploaded audio.
3. View a time vs beat-strength graph.
4. Play the song and watch a real-time playhead/progression synced against the graph.

## Proposed Stack
- Frontend: React + TypeScript + Vite
- Graphing: Recharts (line chart + moving playhead)
- Audio analysis + playback: Web Audio API (`AudioContext`, `OfflineAudioContext`, `AnalyserNode`)
- Local run mode: Vite dev server (`npm run dev`)

Reasoning: This keeps everything local and avoids needing a backend service for file upload/processing.

## Architecture
- `src/config/runtime.ts`
  - Reads runtime config injected from env variables.
- `src/types/beat.ts`
  - Shared types for entries and beat points.
- `src/lib/audio/decodeAudio.ts`
  - File -> AudioBuffer utilities.
- `src/lib/audio/extractBeatData.ts`
  - Beat strength extraction algorithm (windowed energy + smoothing + normalization).
- `src/lib/audio/playbackClock.ts`
  - Playback position tracking helpers.
- `src/components/UploadForm.tsx`
  - Entry name + file picker + submit.
- `src/components/BeatChart.tsx`
  - Time vs beat strength chart + moving current-time indicator.
- `src/components/AudioPlayer.tsx`
  - Play/pause/seek and emits current playback time.
- `src/App.tsx`
  - Coordinates upload, processing, chart, and playback sync.

## Config + Env
- Create `.env` (actual app env file) with:
  - `VITE_APP_NAME=Beat Visualizer`
  - `VITE_BEAT_WINDOW_SIZE=1024`
  - `VITE_BEAT_HOP_SIZE=512`
  - `VITE_BEAT_SMOOTHING_ALPHA=0.35`
- Runtime config module validates and defaults missing values safely.

## UX Flow
1. User enters entry name and chooses an audio file.
2. App decodes file and extracts beat data.
3. App renders line chart for the selected entry.
4. User plays audio; chart playhead moves in real time.
5. Seeking updates playhead to matching chart time.

## Validation
- Accept common audio formats supported by browser.
- Prevent empty name upload.
- Show processing/loading state and errors.
- Clamp and normalize beat strength to 0..1.

## Testing
- Unit tests for beat extraction utility:
  - empty/invalid buffers
  - normalization output bounds
  - monotonic timestamp generation
- Manual checks:
  - upload, process, play, seek, and playhead sync

## Delivery Steps
1. Scaffold Vite React TypeScript app structure.
2. Add modular audio analysis and config modules.
3. Build UI components (upload, chart, player).
4. Wire real-time synchronization.
5. Add tests for extraction core logic.
6. Run build/test and provide local run commands.
