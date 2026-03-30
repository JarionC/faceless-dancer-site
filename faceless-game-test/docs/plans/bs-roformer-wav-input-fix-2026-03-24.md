# BS-RoFormer WAV Input Fix Plan (2026-03-24)

## Problem
- `bs-roformer-infer` expects `.wav` files in `--input_folder`.
- Worker currently copies source file extension as-is, so non-wav uploads cause:
  - `FileNotFoundError: No .wav files found ...`

## Fix
1. Add preprocessing conversion in worker
- Convert stored source audio to `input.wav` via ffmpeg before inference.
- Place resulting wav in job input folder.

2. Harden error handling
- If ffmpeg conversion fails, return clear failure:
  - `errorCode: input_to_wav_conversion_failed`
- Include concise message in status; full ffmpeg output remains in log.

3. Keep existing inference flow
- No API changes.
- BS-RoFormer inference command remains the same.

## Validation
- `python -m py_compile worker/server.py`
- run separation with a non-wav source (e.g. mp3) and verify no `.wav not found` error.
