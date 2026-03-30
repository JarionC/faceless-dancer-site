# GPU Demucs + Shifts Enablement Plan (2026-03-24)

## Goal
Enable the separation worker container to use NVIDIA GPU so Demucs can run with `--shifts` for higher-quality separation.

## Changes
1. Compose GPU access
- Update `docker-compose.yml` `separation-worker` service to request NVIDIA GPU access.

2. Worker image for CUDA runtime
- Switch `Dockerfile.worker` base image from CPU slim Python image to NVIDIA CUDA runtime image.
- Install Python + pip + ffmpeg + libsndfile in the CUDA image.
- Install compatible CUDA PyTorch + torchaudio versions.
- Keep Demucs/soundfile deps.

3. Runtime config/env
- Add worker env vars to `.env`:
  - `DEMUX_DEVICE` (`auto|cuda|cpu`)
  - `DEMUX_SHIFTS` (integer >= 1)
- Pass them through compose env mapping.

4. Worker command wiring
- Update `worker/server.py` to:
  - resolve device (`auto` => CUDA if available, else CPU)
  - pass `-d <device>` and `--shifts <n>` to Demucs CLI
  - log chosen device/shifts per run

5. Validation
- `docker compose config`
- `python -m py_compile worker/server.py`
- `docker compose build separation-worker`
- `docker compose up -d separation-worker backend frontend`

## Notes
- If host Docker/driver/WSL2 GPU integration is not enabled, `auto` falls back to CPU.
