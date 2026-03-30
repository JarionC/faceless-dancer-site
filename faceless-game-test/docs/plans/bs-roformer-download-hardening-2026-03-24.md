# BS-RoFormer Download Hardening Plan (2026-03-24)

## Problem
- Large checkpoint download intermittently fails with `IncompleteRead` and the current `bs-roformer-download` retry limit is exhausted.
- Download currently runs inline with separation job lifecycle, so user jobs fail when network hiccups occur.

## Fixes
1. Persistent model cache volume
- Add dedicated Docker volume for `/app/worker-models` so once-downloaded checkpoints persist across container restarts/recreates.

2. Preflight model bootstrap + health check
- Add worker startup bootstrap path (optional via env) that attempts to pre-download/validate model assets before user-triggered jobs.

3. Hardened asset validation
- Require both config and checkpoint files to exist.
- Add minimum checkpoint size guard (`BS_ROFORMER_MIN_CKPT_BYTES`) to reject partial files.

4. Hardened download retries
- Wrap `bs-roformer-download` with worker-managed outer retries (`BS_ROFORMER_DOWNLOAD_ATTEMPTS`) and validation between attempts.
- If assets already valid, skip download during separation jobs.

5. Faster transfer env defaults
- Keep:
  - `HF_HUB_ENABLE_HF_TRANSFER=1`
  - `HF_HUB_DISABLE_TELEMETRY=1`
- Add:
  - `HF_XET_HIGH_PERFORMANCE=1`

## Validation
- `docker compose build separation-worker`
- `docker compose up -d separation-worker backend frontend`
- Verify warm bootstrap logs indicate model assets ready.
- Trigger separation and verify no re-download when cached model exists.
