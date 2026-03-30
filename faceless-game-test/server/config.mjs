import path from "node:path";

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBytes(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getServerConfig(rootDir) {
  const port = parsePort(process.env.BEAT_API_PORT, 8787);
  const storageDirName = process.env.BEAT_STORAGE_DIR || "beat-storage";
  const storageDir = path.isAbsolute(storageDirName)
    ? storageDirName
    : path.join(rootDir, storageDirName);
  const maxBodyBytes = parseBytes(process.env.BEAT_API_MAX_BODY_BYTES, 50 * 1024 * 1024);
  const separationWorkerUrl =
    process.env.BEAT_SEPARATION_WORKER_URL || "http://separation-worker:8792";
  const separationLogTailLines = parseBytes(process.env.BEAT_SEPARATION_LOG_TAIL_LINES, 200);

  return {
    port,
    storageDir,
    maxBodyBytes,
    separationWorkerUrl,
    separationLogTailLines
  };
}
