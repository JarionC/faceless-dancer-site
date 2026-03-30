# Plan: Maximize BS-RoFormer Stem Detail

Date: 2026-03-24

## Goal
Force BS-RoFormer inference to use the highest practical detail settings so stems capture as much source detail as possible.

## Findings
- `bs-roformer-infer` CLI has limited quality knobs (`--device`, `--device_ids`), so quality/detail is primarily controlled by YAML config values consumed by `demix_track`.
- Effective inference knobs for detail are:
  - `inference.num_overlap` (higher = better boundary blending/detail, slower)
  - `audio.chunk_size` (larger = more context, more VRAM, slower)
  - `inference.normalize` (stability for level variance)

## Changes
1. Add worker runtime config override module in `worker/server.py`:
- load model YAML
- apply env-driven high-detail overrides
- write effective per-job config YAML
- run inference with this effective config path
- log effective values

2. Add env/runtime settings in `.env` and `docker-compose.yml`:
- `BS_ROFORMER_INFER_NUM_OVERLAP=8`
- `BS_ROFORMER_INFER_CHUNK_SIZE=882000`
- `BS_ROFORMER_INFER_NORMALIZE=1`

3. Keep defaults conservative in code only if env missing, but prefer explicit env values.

4. Validate:
- `python -m py_compile worker/server.py`
- rebuild/restart worker
- run one separation job and confirm logs show applied values.

## Risks
- Higher overlap/chunk increases runtime and VRAM pressure; OOM possible on lower-memory GPUs.
- If OOM happens, fallback profile should be:
  - overlap: 6 then 4
  - chunk: 705600 then 588800

## Success Criteria
- Separation logs explicitly show effective YAML values in use.
- Job completes with 6 stems under new settings.
