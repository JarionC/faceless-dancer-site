# Stem Harmonic/Transient Max-Split Plan (2026-03-24)

## Goal
- Capture sustained notes that are currently being fragmented/missed.
- Split each separated stem into many distinct sub-sources so more audible parts show up in chart + realtime playback.
- Set Demucs shifts to 10 for higher-quality source separation.

## Changes
1. Set Demucs shifts to 10
- Update `.env` `DEMUX_SHIFTS=10` (compose already maps this env var to worker runtime).

2. Add configurable stem split params in runtime config
- Introduce frontend runtime/env variables for stem post-separation extraction, including:
  - harmonic band count
  - transient band count
  - base threshold
  - transient boost
  - sustain min duration
  - transient min duration
  - sustain release extension
  - gap merge window

3. Replace simple stem-event extractor with sustain-aware multi-source splitter
- Update `src/lib/audio/extractStemEvents.ts` to:
  - compute multi-band envelopes from stem audio
  - derive harmonic/sustain branch and transient branch per band
  - detect events separately for sustain vs transient behavior
  - merge small gaps for sustained events
  - output many unique sub-source labels per stem (e.g. `<stem>_h01`, `<stem>_t03`)

4. Wire config into saved playback extraction
- Update `SavedMajorBeatsView` call site to pass runtime config values into stem extraction.

## Validation
- `npm run build`
- verify saved session view renders increased source lanes from separated stems
- verify long sustained notes appear as elongated events (not fragmented taps only)
