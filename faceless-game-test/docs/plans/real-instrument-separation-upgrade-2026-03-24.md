# Real Instrument Separation Upgrade Plan (2026-03-24)

## Why current results are weak
- Current extractor is heuristic band segmentation, not true source separation.
- It cannot reliably isolate real instruments from mixed audio.
- `source_XX` lanes are spectral activity buckets, not guaranteed instrument stems.

## Target fix
Replace heuristic splitting with model-based stem separation + per-stem event extraction.

## Phase 1 (high impact)
1. Add Python backend separation worker:
- Use Demucs `htdemucs_6s` for named stems: drums, bass, vocals, guitar, piano, other.
- Cache separated stems per track id in backend storage.

2. Add backend endpoints:
- `POST /api/separate` (start separation for saved track)
- `GET /api/separate/:id/status`
- `GET /api/separate/:id/sources` (list stem names + metadata)

3. Update extraction to run on separated stems (not full mix):
- For each stem audio, run sustain/onset extraction separately.
- Keep source labels as actual stem names.
- Only add `source_XX` for residual optional split of `other` if enabled.

4. Frontend updates:
- Add “Run Real Separation” action for selected saved track.
- Show separation progress/status.
- Chart/playback uses separated stem-derived events when available.

## Phase 2 (detail quality)
1. On `other` stem, optional secondary split:
- HPSS + NMF residual decomposition to produce `source_XX` only when meaningful.
- Keep strict quality filters so noisy fake sources are dropped.

2. Add source confidence/energy gates:
- hide sources below audibility threshold by default.

## Runtime requirements
- Python 3.10+
- torch + demucs dependencies
- first run downloads model weights
- CPU is supported but slower; GPU recommended for speed

## Docker integration
- Add worker container with Python + Demucs.
- App/backend talks to worker over internal network.
- Keep `docker compose up --build` as single entrypoint.

## Validation criteria
- Sustained single-instrument sections appear in correct named stem lane.
- Fewer meaningless `source_XX` lanes.
- Distinct instruments are audibly represented by corresponding lanes.

## Deliverable sequence
1. Implement Phase 1 end-to-end first.
2. Validate on your test song.
3. Add Phase 2 only if needed.
