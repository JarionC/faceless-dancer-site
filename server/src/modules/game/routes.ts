import { Router } from "express";
import multer from "multer";
import { env } from "../../config/env.js";
import { requireAdmin, requireAuth, requireHolder } from "../../middleware/auth.js";
import {
  createPreviewReadStream,
  createAudioReadStream,
  createSongCoverReadStream,
  createSeparatedSourceReadStream,
  hasPreviewForEntry,
  listSavedBeatEntries,
  materializeLegacyNormalGameBeats,
  listSeparatedSources,
  readSavedBeatEntry,
  readSeparatedLogTail,
  saveSongCoverImage,
  saveGameBeatsForEntry,
  saveMajorBeatsBundle,
  saveSeparatedSources,
} from "./storage.js";
import {
  getAvailableDifficulties,
  getAvailableGameModes,
  getDifficultyBeatCounts,
  getModeDifficultyBeatCounts,
  normalizeGameDifficulty,
  normalizeGameMode,
} from "./difficultyCharts.js";
import {
  createScore,
  findSongByEntryId,
  getGameControlDefaults,
  isEntryEnabled,
  listAllSongs,
  listEnabledSongs,
  listOverallLeaderboard,
  listSongLeaderboard,
  saveGameControlDefaults,
  setSongCoverImageForEntry,
  upsertSongForEntry,
} from "./service.js";
import {
  validateGameBeatsPayload,
  validateSavePayload,
  validateSaveScorePayload,
} from "./validation.js";

const router = Router();
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadSizeBytes },
  fileFilter: (_req, file, callback) => {
    const mime = String(file.mimetype || "").toLowerCase();
    if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
      callback(null, true);
      return;
    }
    callback(new Error("Cover image must be PNG, JPEG, or WEBP."));
  }
});

async function readJsonBody(req: any): Promise<any> {
  return req.body ?? {};
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWorker(path: string, init?: RequestInit): Promise<any> {
  const url = `${env.BEAT_SEPARATION_WORKER_URL}${path}`;
  const maxAttempts = 3;
  let lastNetworkError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...(init ?? {}), signal: controller.signal });
      clearTimeout(timeout);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : `Worker request failed (${response.status}).`);
      }
      return body;
    } catch (error) {
      clearTimeout(timeout);
      lastNetworkError = error;
      if (attempt < maxAttempts) {
        await sleep(350 * attempt);
        continue;
      }
    }
  }

  const baseMessage = lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError);
  const causeMessage =
    lastNetworkError instanceof Error && (lastNetworkError as any).cause
      ? String((lastNetworkError as any).cause?.message ?? (lastNetworkError as any).cause)
      : "";
  throw new Error(causeMessage ? `${baseMessage} | ${causeMessage}` : baseMessage || "Worker network request failed.");
}

function formatError(error: unknown): { message: string; stack?: string; cause?: string } {
  if (error instanceof Error) {
    const cause = (error as any).cause;
    return {
      message: error.message,
      stack: error.stack,
      cause: cause ? String(cause?.message ?? cause) : undefined,
    };
  }
  return { message: String(error) };
}

function logGameError(context: string, meta: Record<string, unknown>, error: unknown): void {
  const details = formatError(error);
  console.error(
    `[game-api] ${context} failed`,
    JSON.stringify({
      ...meta,
      workerUrl: env.BEAT_SEPARATION_WORKER_URL,
      errorMessage: details.message,
      errorStack: details.stack ?? null,
      errorCause: details.cause ?? null,
    })
  );
}

function ensureAdminAccess(req: any, res: any): boolean {
  if (!req.session?.isAdmin) {
    res.status(403).json({ error: "Admin role required" });
    return false;
  }
  return true;
}

router.post("/api/beats/save", requireAuth, requireAdmin, async (req, res) => {
  const payload = await readJsonBody(req);
  const validationError = validateSavePayload(payload);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const result = await saveMajorBeatsBundle(env.beatStorageDir, payload);
    return res.json({ ok: true, ...result });
  } catch (error) {
    logGameError("save-major-beats", { route: "POST /api/game/api/beats/save" }, error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save major beats." });
  }
});

router.get("/api/beats/list", requireAuth, async (req, res) => {
  if (!ensureAdminAccess(req, res)) {
    return;
  }

  try {
    const entries = await listSavedBeatEntries(env.beatStorageDir);
    const songMap = new Map(listAllSongs().map((song) => [song.beat_entry_id, song]));
    const enriched = entries.map((entry) => {
      const song = songMap.get(entry.id);
      return {
        ...entry,
        enabled: song?.is_enabled === 1,
        songTitle: song?.title ?? entry.entryName,
        songCoverImageFileName: song?.cover_image_file_name ?? null,
      };
    });
    return res.json({ ok: true, entries: enriched });
  } catch (error) {
    logGameError("list-beats", { route: "GET /api/game/api/beats/list" }, error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list saved beats." });
  }
});

router.get("/api/beats/:id", requireAuth, async (req, res) => {
  if (!ensureAdminAccess(req, res)) {
    return;
  }

  const entry = await readSavedBeatEntry(env.beatStorageDir, req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Saved entry not found." });
  }
  return res.json({ ok: true, entry });
});

router.get("/api/beats/:id/audio", requireAuth, async (req, res) => {
  if (!ensureAdminAccess(req, res)) {
    return;
  }

  const entry = await readSavedBeatEntry(env.beatStorageDir, req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Saved entry not found." });
  }
  const streamInfo = createAudioReadStream(env.beatStorageDir, entry);
  if (!streamInfo) {
    return res.status(404).json({ error: "Saved audio not found." });
  }

  res.setHeader("Content-Type", streamInfo.mimeType);
  res.setHeader("Cache-Control", "no-store");
  streamInfo.stream.pipe(res);
});

router.get("/api/beats/:id/preview", requireAuth, async (req, res) => {
  if (!ensureAdminAccess(req, res)) {
    return;
  }
  const preview = createPreviewReadStream(env.beatStorageDir, req.params.id);
  if (!preview) {
    return res.status(404).json({ error: "Preview audio not found." });
  }
  res.setHeader("Content-Type", preview.mimeType);
  res.setHeader("Cache-Control", "no-store");
  preview.stream.pipe(res);
});

router.post("/api/beats/:id/game-beats", requireAuth, requireAdmin, async (req, res) => {
  const payload = await readJsonBody(req);
  const validationError = validateGameBeatsPayload(payload);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const updated = await saveGameBeatsForEntry(env.beatStorageDir, req.params.id, payload);
  if (!updated) {
    return res.status(404).json({ error: "Saved entry not found." });
  }

  return res.json({
    ok: true,
    id: req.params.id,
    gameMode: normalizeGameMode(payload?.gameMode),
    difficulty: normalizeGameDifficulty(payload?.difficulty),
    gameBeatCount:
      getDifficultyBeatCounts(updated, normalizeGameMode(payload?.gameMode))[
        normalizeGameDifficulty(payload?.difficulty)
      ] ?? 0,
    availableGameModes: updated.availableGameModes ?? [],
    availableDifficulties: updated.availableDifficulties ?? [],
    difficultyBeatCounts: updated.difficultyBeatCounts ?? {},
    modeDifficultyBeatCounts: updated.modeDifficultyBeatCounts ?? {},
  });
});

router.post("/api/separate/:id/start", requireAuth, requireAdmin, async (req, res) => {
  const entry = await readSavedBeatEntry(env.beatStorageDir, req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Saved entry not found." });
  }

  try {
    const worker = await callWorker("/separate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId: req.params.id, storageDir: env.beatStorageDir }),
    });
    return res.json({ ok: true, worker });
  } catch (error) {
    logGameError("separation-start", { route: "POST /api/game/api/separate/:id/start", entryId: req.params.id }, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Failed to contact separation worker." });
  }
});

router.get("/api/separate/:id/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const worker = await callWorker(`/status/${encodeURIComponent(req.params.id)}`);
    if (worker?.status === "completed" && Array.isArray(worker?.sources)) {
      await saveSeparatedSources(env.beatStorageDir, req.params.id, worker.sources);
    }
    return res.json({ ok: true, ...worker });
  } catch (error) {
    logGameError("separation-status", { route: "GET /api/game/api/separate/:id/status", entryId: req.params.id }, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Failed to fetch separation status." });
  }
});

router.get("/api/separate/:id/sources", requireAuth, requireAdmin, async (req, res) => {
  const sources = await listSeparatedSources(env.beatStorageDir, req.params.id);
  if (sources === null) {
    return res.status(404).json({ error: "Saved entry not found." });
  }
  return res.json({ ok: true, sources });
});

router.get("/api/separate/:id/source/:source/audio", requireAuth, requireAdmin, (req, res) => {
  const streamInfo = createSeparatedSourceReadStream(env.beatStorageDir, req.params.id, req.params.source);
  if (!streamInfo) {
    return res.status(404).json({ error: "Separated source audio not found." });
  }
  res.setHeader("Content-Type", streamInfo.mimeType);
  res.setHeader("Cache-Control", "no-store");
  streamInfo.stream.pipe(res);
});

router.get("/api/separate/:id/log", requireAuth, requireAdmin, async (req, res) => {
  const tail = parsePositiveInt(req.query.tail, env.BEAT_SEPARATION_LOG_TAIL_LINES);
  try {
    const worker = await callWorker(`/log/${encodeURIComponent(req.params.id)}?tail=${tail}`);
    return res.json({ ok: true, ...worker });
  } catch (error) {
    logGameError("separation-log-worker", { route: "GET /api/game/api/separate/:id/log", entryId: req.params.id, tail }, error);
    const localLog = await readSeparatedLogTail(env.beatStorageDir, req.params.id, tail);
    if (!localLog) {
      return res.status(400).json({ error: "Invalid entry id." });
    }
    return res.json({ ok: true, entryId: req.params.id, ...localLog });
  }
});

router.post("/api/analyze/:id/start", requireAuth, requireAdmin, async (req, res) => {
  const entry = await readSavedBeatEntry(env.beatStorageDir, req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Saved entry not found." });
  }

  const body = await readJsonBody(req);
  const analysisOverrides =
    body?.analysisOverrides && typeof body.analysisOverrides === "object"
      ? body.analysisOverrides
      : undefined;
  const laneStrengthThresholds =
    body?.laneStrengthThresholds && typeof body.laneStrengthThresholds === "object"
      ? body.laneStrengthThresholds
      : undefined;

  if (analysisOverrides || laneStrengthThresholds) {
    saveGameControlDefaults({
      analysisOverrides: analysisOverrides ?? null,
      laneStrengthThresholds: laneStrengthThresholds ?? null,
    });
  }

  try {
    const worker = await callWorker("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryId: req.params.id,
        storageDir: env.beatStorageDir,
        analysisOverrides,
      }),
    });
    return res.json({ ok: true, worker });
  } catch (error) {
    logGameError("analysis-start", { route: "POST /api/game/api/analyze/:id/start", entryId: req.params.id }, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Failed to contact analysis worker." });
  }
});

router.get("/api/analyze/:id/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const worker = await callWorker(`/analyze-status/${encodeURIComponent(req.params.id)}`);
    return res.json({ ok: true, ...worker });
  } catch (error) {
    logGameError("analysis-status", { route: "GET /api/game/api/analyze/:id/status", entryId: req.params.id }, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Failed to fetch analysis status." });
  }
});

router.get("/api/analyze/:id/result", requireAuth, requireAdmin, async (req, res) => {
  try {
    const worker = await callWorker(`/analyze-result/${encodeURIComponent(req.params.id)}`);
    return res.json({ ok: true, ...worker });
  } catch (error) {
    logGameError("analysis-result", { route: "GET /api/game/api/analyze/:id/result", entryId: req.params.id }, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Failed to fetch analysis result." });
  }
});

router.get("/api/catalog/songs", requireAuth, requireAdmin, (req, res) => {
  return res.json({ songs: listAllSongs() });
});

router.post("/api/catalog/songs/:entryId/cover", requireAuth, requireAdmin, coverUpload.single("cover"), async (req, res) => {
  const entryId = String(req.params.entryId || "").trim();
  if (!entryId) {
    return res.status(400).json({ error: "entryId is required." });
  }
  const entry = await readSavedBeatEntry(env.beatStorageDir, entryId);
  if (!entry) {
    return res.status(404).json({ error: "Saved entry not found." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Cover image file is required." });
  }
  try {
    const saved = await saveSongCoverImage(env.beatStorageDir, entryId, {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      bytes: req.file.buffer
    });
    const song = setSongCoverImageForEntry(entryId, saved.storedFileName);
    return res.json({
      ok: true,
      coverImageFileName: saved.storedFileName,
      coverImageUrl: `${req.baseUrl}/api/catalog/songs/${encodeURIComponent(entryId)}/cover`,
      song
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save cover image." });
  }
});

router.get("/api/catalog/songs/:entryId/cover", requireAuth, requireAdmin, (req, res) => {
  const song = findSongByEntryId(req.params.entryId);
  if (!song || !song.cover_image_file_name) {
    return res.status(404).json({ error: "Cover image not found." });
  }
  const streamInfo = createSongCoverReadStream(env.beatStorageDir, song.cover_image_file_name);
  if (!streamInfo) {
    return res.status(404).json({ error: "Cover image not found." });
  }
  res.setHeader("Content-Type", streamInfo.mimeType);
  res.setHeader("Cache-Control", "no-store");
  streamInfo.stream.pipe(res);
});

router.get("/api/control-defaults", requireAuth, requireAdmin, (_req, res) => {
  return res.json(getGameControlDefaults());
});

router.put("/api/catalog/songs/:entryId", requireAuth, requireAdmin, async (req, res) => {
  const entryId = String(req.params.entryId || "").trim();
  if (!entryId) {
    return res.status(400).json({ error: "entryId is required." });
  }

  const entry = await readSavedBeatEntry(env.beatStorageDir, entryId);
  if (!entry) {
    return res.status(404).json({ error: "Saved entry not found." });
  }

  const titleRaw = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const defaultTitle = String((entry.entry as any)?.name ?? entryId);
  const title = (titleRaw || defaultTitle).slice(0, 120);
  const isEnabled = Boolean(req.body?.isEnabled);

  const song = upsertSongForEntry({
    beatEntryId: entryId,
    title,
    isEnabled,
    createdByUserId: req.session!.userId,
  });

  return res.json({ song });
});

router.post("/api/catalog/songs/:entryId/materialize-normal-difficulty", requireAuth, requireAdmin, async (req, res) => {
  const entryId = String(req.params.entryId || "").trim();
  if (!entryId) {
    return res.status(400).json({ error: "entryId is required." });
  }

  const updated = await materializeLegacyNormalGameBeats(env.beatStorageDir, entryId);
  if (!updated) {
    return res.status(404).json({ error: "Saved entry not found." });
  }

  return res.json({
    ok: true,
    entryId,
    availableGameModes: updated.availableGameModes ?? [],
    availableDifficulties: updated.availableDifficulties ?? [],
    difficultyBeatCounts: updated.difficultyBeatCounts ?? {},
    modeDifficultyBeatCounts: updated.modeDifficultyBeatCounts ?? {},
    hasLegacyNormalChartOnly: updated.hasLegacyNormalChartOnly ?? false
  });
});

router.post("/api/catalog/previews/generate-missing", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const entries = await listSavedBeatEntries(env.beatStorageDir);
    const total = entries.length;
    let generated = 0;
    let skippedExisting = 0;
    const failed: Array<{ entryId: string; error: string }> = [];

    for (const entry of entries) {
      const entryId = String(entry.id || "").trim();
      if (!entryId) {
        continue;
      }
      if (hasPreviewForEntry(env.beatStorageDir, entryId)) {
        skippedExisting += 1;
        continue;
      }
      try {
        await callWorker("/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId,
            storageDir: env.beatStorageDir,
            offsetSeconds: env.BEAT_PREVIEW_OFFSET_SECONDS,
            durationSeconds: env.BEAT_PREVIEW_DURATION_SECONDS
          }),
        });
        generated += 1;
      } catch (error) {
        failed.push({
          entryId,
          error: error instanceof Error ? error.message : "Preview generation failed.",
        });
      }
    }

    return res.json({
      ok: true,
      total,
      generated,
      skippedExisting,
      failedCount: failed.length,
      failed,
      offsetSeconds: env.BEAT_PREVIEW_OFFSET_SECONDS,
      durationSeconds: env.BEAT_PREVIEW_DURATION_SECONDS
    });
  } catch (error) {
    logGameError("generate-missing-previews", { route: "POST /api/game/api/catalog/previews/generate-missing" }, error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate previews." });
  }
});

router.get("/api/public/songs/enabled", async (req, res) => {
  const enabledSongs = listEnabledSongs();
  const songs: Array<{
    beatEntryId: string;
    title: string;
    majorBeatCount: number;
    gameBeatCount: number;
    coverImageUrl: string | null;
    availableGameModes: Array<"step_arrows" | "orb_beat">;
    availableDifficulties: Array<"easy" | "normal" | "hard">;
    difficultyBeatCounts: Partial<Record<"easy" | "normal" | "hard", number>>;
    modeDifficultyBeatCounts: Partial<
      Record<"step_arrows" | "orb_beat", Partial<Record<"easy" | "normal" | "hard", number>>>
    >;
  }> = [];
  for (const song of enabledSongs) {
    const entry = await readSavedBeatEntry(env.beatStorageDir, song.beatEntryId);
    if (!entry) {
      continue;
    }
    songs.push({
      beatEntryId: song.beatEntryId,
      title: song.title,
      majorBeatCount: Array.isArray(entry.majorBeats) ? entry.majorBeats.length : 0,
      gameBeatCount: getDifficultyBeatCounts(entry).normal ?? 0,
      availableGameModes: getAvailableGameModes(entry),
      availableDifficulties: getAvailableDifficulties(entry),
      difficultyBeatCounts: getDifficultyBeatCounts(entry),
      modeDifficultyBeatCounts: getModeDifficultyBeatCounts(entry),
      coverImageUrl: song.coverImageFileName
        ? `${req.baseUrl}/api/public/songs/${encodeURIComponent(song.beatEntryId)}/cover`
        : null,
    });
  }
  return res.json({ songs });
});

router.get("/api/public/songs/:id/cover", async (req, res) => {
  if (!isEntryEnabled(req.params.id)) {
    return res.status(404).json({ error: "Song not found." });
  }
  const song = findSongByEntryId(req.params.id);
  if (!song || !song.cover_image_file_name) {
    return res.status(404).json({ error: "Cover image not found." });
  }
  const streamInfo = createSongCoverReadStream(env.beatStorageDir, song.cover_image_file_name);
  if (!streamInfo) {
    return res.status(404).json({ error: "Cover image not found." });
  }
  res.setHeader("Content-Type", streamInfo.mimeType);
  res.setHeader("Cache-Control", "no-store");
  streamInfo.stream.pipe(res);
});

router.get("/api/public/beats/:id", async (req, res) => {
  if (!isEntryEnabled(req.params.id)) {
    return res.status(404).json({ error: "Song not found." });
  }
  const entry = await readSavedBeatEntry(env.beatStorageDir, req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Saved entry not found." });
  }
  return res.json({ ok: true, entry });
});

router.get("/api/public/beats/:id/audio", async (req, res) => {
  if (!isEntryEnabled(req.params.id)) {
    return res.status(404).json({ error: "Song not found." });
  }
  const entry = await readSavedBeatEntry(env.beatStorageDir, req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Saved entry not found." });
  }
  const streamInfo = createAudioReadStream(env.beatStorageDir, entry);
  if (!streamInfo) {
    return res.status(404).json({ error: "Saved audio not found." });
  }
  res.setHeader("Content-Type", streamInfo.mimeType);
  res.setHeader("Cache-Control", "no-store");
  streamInfo.stream.pipe(res);
});

router.get("/api/public/beats/:id/preview", async (req, res) => {
  if (!isEntryEnabled(req.params.id)) {
    return res.status(404).json({ error: "Song not found." });
  }
  const preview = createPreviewReadStream(env.beatStorageDir, req.params.id);
  if (!preview) {
    return res.status(404).json({ error: "Preview audio not found." });
  }
  res.setHeader("Content-Type", preview.mimeType);
  res.setHeader("Cache-Control", "no-store");
  preview.stream.pipe(res);
});

router.get("/api/public/analyze/:id/result", async (req, res) => {
  if (!isEntryEnabled(req.params.id)) {
    return res.status(404).json({ error: "Song not found." });
  }
  try {
    const worker = await callWorker(`/analyze-result/${encodeURIComponent(req.params.id)}`);
    return res.json({ ok: true, ...worker });
  } catch (error) {
    logGameError("public-analysis-result", { route: "GET /api/game/api/public/analyze/:id/result", entryId: req.params.id }, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Failed to fetch analysis result." });
  }
});

router.get("/api/scores/song/:entryId", (req, res) => {
  const gameMode = normalizeGameMode(req.query.gameMode);
  const difficulty = normalizeGameDifficulty(req.query.difficulty);
  return res.json({
    leaderboard: listSongLeaderboard(req.params.entryId, gameMode, difficulty),
    gameMode,
    difficulty
  });
});

router.get("/api/scores/overall", (_req, res) => {
  return res.json({ leaderboard: listOverallLeaderboard() });
});

router.post("/api/scores/song/:entryId", requireAuth, requireHolder, (req, res) => {
  const validationError = validateSaveScorePayload(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const body = req.body as {
    displayName: string;
    gameMode?: "step_arrows" | "orb_beat";
    difficulty?: "easy" | "normal" | "hard";
    score: number;
    maxCombo?: number;
    perfect?: number;
    great?: number;
    good?: number;
    poor?: number;
    miss?: number;
  };

  const result = createScore({
    beatEntryId: req.params.entryId,
    userId: req.session!.userId,
    gameMode: normalizeGameMode(body.gameMode),
    difficulty: normalizeGameDifficulty(body.difficulty),
    displayName: body.displayName.trim(),
    score: Math.floor(body.score),
    maxCombo: Math.floor(body.maxCombo ?? 0),
    perfect: Math.floor(body.perfect ?? 0),
    great: Math.floor(body.great ?? 0),
    good: Math.floor(body.good ?? 0),
    poor: Math.floor(body.poor ?? 0),
    miss: Math.floor(body.miss ?? 0),
  });

  if (!result.ok) {
    return res.status(400).json({ error: result.reason });
  }

  return res.json({ saved: true });
});

export const gameRouter = router;
