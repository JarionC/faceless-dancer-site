# BS-RoFormer 6-Stem Migration Plan (2026-03-24)

## Objective
- Disable Demucs-based separation path.
- Replace worker separation with BS-RoFormer 6-stem inference.
- Add high-speed model download setup (HF transfer/Xet path where supported).
- Verify install/runtime in container after changes.

## Research-backed target setup
- Use `openmirlab/bs-roformer-infer` (official package/repo) with recommended 6-stem model:
  - `roformer-model-bs-roformer-sw-by-jarredou`
  - Outputs: `vocals, drums, bass, guitar, piano, other` (+ instrumental).
- Inference flow from project docs:
  1. `bs-roformer-download --model <slug> --output-dir <models_dir>`
  2. `bs-roformer-infer --config_path ... --model_path ... --input_folder ... --store_dir ...`

## Code changes
1. Worker runtime dependency migration
- Update `worker/requirements.txt`:
  - remove Demucs dependency from separation path requirements
  - add `bs-roformer-infer`
  - add `huggingface_hub[hf_transfer]`
  - add `hf_xet`

2. Worker separation logic migration
- Update `worker/server.py`:
  - replace `python -m demucs.separate` flow with:
    - model bootstrap/download command
    - bs-roformer inference command
  - map generated stem files to labels: `vocals, drums, bass, guitar, piano, other`
  - preserve existing logging/status/error structure
  - add env-driven settings:
    - `SEPARATION_ENGINE=bs_roformer`
    - `BS_ROFORMER_MODEL_SLUG=roformer-model-bs-roformer-sw-by-jarredou`
    - `BS_ROFORMER_MODELS_DIR`
    - `BS_ROFORMER_OUTPUT_DIR`

3. Compose/env updates
- Update `.env` and `docker-compose.yml`:
  - disable Demucs-specific vars for active flow
  - add BS-RoFormer vars above
  - add HF acceleration env:
    - `HF_HUB_ENABLE_HF_TRANSFER=1`
    - `HF_HUB_DISABLE_TELEMETRY=1`
  - keep GPU access for faster inference

4. Keep backend/frontend API unchanged
- Existing `/api/separate/...` contracts remain intact.
- Saved playback should continue to load separated sources without frontend API changes.

## Validation
1. Build worker image:
- `docker compose build separation-worker`
2. Start services:
- `docker compose up -d separation-worker backend frontend`
3. Verify tool install in container:
- `bs-roformer-download --help`
- `bs-roformer-infer --help`
4. Verify model download and run command path:
- test `bs-roformer-download --model roformer-model-bs-roformer-sw-by-jarredou ...`
5. Run one real separation and verify saved stems exist for core 6 labels.

## Key similarities from successful setups we are adopting
- fixed known-good 6-stem model slug (not ad-hoc configs)
- explicit pre-download/bootstrap of model assets
- inference-only runtime package for stable execution
- GPU-enabled inference runtime
- transfer acceleration flags/tooling for large model artifacts
