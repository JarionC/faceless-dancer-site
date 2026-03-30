# Plan: BS-RoFormer Max Detail + Per-Run Stem Archiving

Date: 2026-03-24

## Goal
1. Maximize BS-RoFormer inference detail by overriding effective inference config at runtime.
2. Save each run's produced stems in a separate archive location, with env toggle to disable.

## Changes
- Worker runtime config override:
  - Read model YAML.
  - Override and persist per-job effective config with:
    - `inference.num_overlap`
    - `audio.chunk_size`
    - `inference.normalize`
  - Run `bs-roformer-infer` using effective config.
  - Log effective settings per run.

- Per-run stem archiving:
  - Add env toggle `BS_ROFORMER_SAVE_STEMS_PER_RUN`.
  - Add env base directory `BS_ROFORMER_STEM_RUNS_DIR`.
  - Copy resulting stem wav files to unique run folder `<base>/<entryId>/<timestamp>/`.

- Config wiring:
  - Update `.env` and `docker-compose.yml` with new variables.

## Validation
- `python -m py_compile worker/server.py`
- Rebuild/restart worker container.
- Run a separation and verify logs include effective overlap/chunk/normalize and archive path.

## Risk
- Higher overlap/chunk can increase runtime and GPU memory usage.
