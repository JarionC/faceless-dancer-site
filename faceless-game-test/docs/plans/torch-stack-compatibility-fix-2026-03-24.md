# Torch Stack Compatibility Fix Plan (2026-03-24)

## Problem
- Separation inference completes, then stem export fails in Demucs save path.
- Current container has an incompatible combo:
  - `torch` (2.11.0+cu130 in logs)
  - `torchaudio` save path requiring `torchcodec`
  - `torchcodec` shared library load failures against available ffmpeg/system libs.
- Result: no stems written.

## Fix
1. Pin a stable CPU-only PyTorch stack for Demucs
- Explicitly install:
  - `torch==2.2.2`
  - `torchaudio==2.2.2`
  - `demucs==4.0.1`
- Remove `torchcodec` dependency from worker requirements.
- Use PyTorch CPU wheel index during image build.

2. Docker worker build hardening
- Update `Dockerfile.worker` pip install commands to use the CPU index for torch/torchaudio.
- Keep ffmpeg apt install.

3. Error classification cleanup
- Detect `libtorchcodec` / `save_with_torchcodec` failures as `torch_stack_incompatible_error`.
- Avoid misclassifying as ffmpeg decode errors.

## Validation
- `docker compose build separation-worker`
- `docker compose up -d separation-worker backend frontend`
- Trigger real separation and verify:
  - status becomes `completed`
  - stem files exist in `beat-storage/separated/<entryId>/`
  - no torchcodec/libtorchcodec errors in worker logs.
