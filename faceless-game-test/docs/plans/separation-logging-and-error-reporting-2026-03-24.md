# Separation Logging + Error Reporting Plan (2026-03-24)

## Problem
- Frontend is showing raw Demucs progress output as the error string.
- We can’t easily see the real failure reason.

## Fixes
1. Worker structured logging
- Log Demucs command lifecycle to stdout (container logs).
- Stream subprocess stdout/stderr line-by-line with prefixes.
- Write full run log to file:
  - `beat-storage/separated/<entryId>/separation.log`

2. Worker status payload cleanup
- Status should return concise fields:
  - `status`: queued/running/completed/failed
  - `message`: short human-readable summary
  - `errorCode` (optional)
- Do **not** return raw progress bars as `message`.
- Keep full details only in log file.

3. Backend passthrough + log endpoint
- Add endpoint:
  - `GET /api/separate/:id/log`
- Returns recent log tail for UI/debug and CLI checks.

4. Frontend error UX
- Show short failure summary only.
- Add a “View separation log” action for selected session.
- Do not flood UI with worker progress bar text.

5. Timeout/health safeguards
- Add worker-side timeout env (default e.g. 20 min) and explicit timeout error.
- Distinguish common failures:
  - model download issue
  - OOM / process killed
  - ffmpeg/input decode problem

## Validation
- Reproduce failure and verify:
  - `docker logs faceless-beat-separation-worker` shows useful details.
  - `GET /api/separate/:id/log` returns detailed tail.
  - frontend shows concise status, not raw progress spam.
