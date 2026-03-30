# TorchCodec Separation Failure Fix Plan (2026-03-24)

## Problem
- Demucs runs inference, then fails while saving stems:
  - `ImportError: TorchCodec is required for save_with_torchcodec`
- Worker currently misclassifies this as `model_download_error`.

## Proposed Fix
1. Add missing runtime dependency
- Update `worker/requirements.txt` to include `torchcodec` so torchaudio save works in container.

2. Improve failure classification
- Update worker error classifier to detect torchcodec import/save errors and return:
  - `errorCode: torchcodec_missing_error`
  - `message: Stem export failed because TorchCodec is missing or incompatible.`

3. Validate containerized flow
- Rebuild worker image and verify startup:
  - `docker compose build separation-worker`
- Re-run a separation and confirm:
  - status reaches `completed`
  - stems appear under `beat-storage/separated/<entryId>/`
  - no torchcodec import error in worker logs.

## Notes
- This is a packaging/runtime fix; extraction logic is unchanged.
