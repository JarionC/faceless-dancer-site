import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "../../config/env.js";
import {
  buildObjectPath,
  bunnyObjectExists,
  downloadFromBunny,
  listBunnyObjects,
  uploadBufferToBunny,
  uploadTextToBunny,
} from "../storage/bunnyStorage.js";
import {
  countDifficultyChartBeats,
  getAvailableGameModes,
  getAvailableDifficulties,
  getModeDifficultyBeatCounts,
  getDifficultyBeatCounts,
  getModeDifficultyChart,
  hasLegacyNormalChartOnly,
  materializeLegacyNormalChart,
  normalizeGameDifficulty,
  normalizeGameMode,
  writeModeDifficultyChart,
} from "./difficultyCharts.js";

export interface SavedBeatSummary {
  id: string;
  savedAtIso: string;
  entryName: string;
  fileName: string;
  durationSeconds: number;
  majorBeatCount: number;
  gameBeatCount?: number;
  sourceEventCount?: number;
  separatedSourceCount?: number;
  enabled?: boolean;
  songTitle?: string;
  availableGameModes?: Array<"step_arrows" | "orb_beat">;
  availableDifficulties?: Array<"easy" | "normal" | "hard">;
  difficultyBeatCounts?: Partial<Record<"easy" | "normal" | "hard", number>>;
  modeDifficultyBeatCounts?: Partial<
    Record<"step_arrows" | "orb_beat", Partial<Record<"easy" | "normal" | "hard", number>>>
  >;
  hasLegacyNormalChartOnly?: boolean;
}

function isBunnyProvider(): boolean {
  return env.BEAT_STORAGE_PROVIDER === "bunny";
}

function bunnyObjectPath(relativePath: string): string {
  return buildObjectPath([env.BEAT_BUNNY_PREFIX, relativePath]);
}

function sanitizeFileNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function sanitizeId(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sanitizeSourceLabel(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 60);
}

function normalizeExtension(fileName: string): string {
  const raw = path.extname(fileName || "").toLowerCase();
  if (!raw) {
    return ".bin";
  }
  return raw.replace(/[^a-z0-9.]/g, "") || ".bin";
}

function imageExtensionFromMimeType(mimeType: string, originalName: string): string {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized === "image/png") return ".png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpg";
  if (normalized === "image/webp") return ".webp";
  const ext = normalizeExtension(originalName);
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") {
    return ext === ".jpeg" ? ".jpg" : ext;
  }
  return ".bin";
}

function getStoragePaths(storageDir: string) {
  return {
    jsonDir: path.join(storageDir, "json"),
    audioDir: path.join(storageDir, "audio"),
    previewsDir: path.join(storageDir, "previews"),
    separatedDir: path.join(storageDir, "separated"),
    coversDir: path.join(storageDir, "covers")
  };
}

async function ensureStorageDirs(storageDir: string) {
  if (isBunnyProvider()) {
    return getStoragePaths(storageDir);
  }
  const { jsonDir, audioDir, previewsDir, separatedDir, coversDir } = getStoragePaths(storageDir);
  await fsp.mkdir(jsonDir, { recursive: true });
  await fsp.mkdir(audioDir, { recursive: true });
  await fsp.mkdir(previewsDir, { recursive: true });
  await fsp.mkdir(separatedDir, { recursive: true });
  await fsp.mkdir(coversDir, { recursive: true });
  return { jsonDir, audioDir, previewsDir, separatedDir, coversDir };
}

async function createUniqueId(jsonDir: string, baseId: string) {
  let candidate = baseId || `entry-${Date.now()}`;
  let counter = 1;
  while (true) {
    if (isBunnyProvider()) {
      const exists = await bunnyObjectExists(bunnyObjectPath(`json/${candidate}.json`));
      if (!exists) {
        return candidate;
      }
    } else {
      const jsonPath = path.join(jsonDir, `${candidate}.json`);
      if (!fs.existsSync(jsonPath)) {
        return candidate;
      }
    }
    candidate = `${baseId}-${counter}`;
    counter += 1;
  }
}

async function readEntryJsonBySafeId(storageDir: string, safeId: string): Promise<Record<string, unknown> | null> {
  if (isBunnyProvider()) {
    try {
      const raw = await downloadFromBunny(bunnyObjectPath(`json/${safeId}.json`));
      return JSON.parse(raw.buffer.toString("utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const { jsonDir } = await ensureStorageDirs(storageDir);
  const jsonPath = path.join(jsonDir, `${safeId}.json`);
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  const raw = await fsp.readFile(jsonPath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function writeEntryJsonBySafeId(storageDir: string, safeId: string, payload: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(payload, null, 2);
  if (isBunnyProvider()) {
    await uploadTextToBunny({
      text,
      objectPath: bunnyObjectPath(`json/${safeId}.json`),
      contentType: "application/json"
    });
    return;
  }

  const { jsonDir } = await ensureStorageDirs(storageDir);
  const jsonPath = path.join(jsonDir, `${safeId}.json`);
  await fsp.writeFile(jsonPath, text, "utf8");
}

function parseSavedEntry(parsed: Record<string, unknown>): SavedBeatSummary {
  const modeDifficultyBeatCounts = getModeDifficultyBeatCounts(parsed);
  const difficultyBeatCounts = getDifficultyBeatCounts(parsed, "step_arrows");
  const normalChart = getModeDifficultyChart(parsed, "step_arrows", "normal");
  const gameBeatCount = countDifficultyChartBeats(normalChart);

  return {
    id: String(parsed.id ?? ""),
    savedAtIso: String(parsed.savedAtIso ?? ""),
    entryName: String((parsed.entry as { name?: string } | undefined)?.name ?? "Untitled"),
    fileName: String((parsed.entry as { fileName?: string } | undefined)?.fileName ?? ""),
    durationSeconds: Number((parsed.entry as { durationSeconds?: number } | undefined)?.durationSeconds ?? 0),
    majorBeatCount: Array.isArray(parsed.majorBeats) ? parsed.majorBeats.length : 0,
    gameBeatCount,
    availableGameModes: getAvailableGameModes(parsed),
    difficultyBeatCounts,
    modeDifficultyBeatCounts,
    availableDifficulties: getAvailableDifficulties(parsed),
    hasLegacyNormalChartOnly: hasLegacyNormalChartOnly(parsed),
    sourceEventCount: Array.isArray(parsed.sourceEvents) ? parsed.sourceEvents.length : 0,
    separatedSourceCount: Array.isArray(parsed.separatedSources) ? parsed.separatedSources.length : 0
  };
}

async function readBunnyObjectIfExists(objectPath: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    return await downloadFromBunny(objectPath);
  } catch {
    return null;
  }
}

export async function saveMajorBeatsBundle(
  storageDir: string,
  payload: {
    entry: { id?: string; name: string; fileName: string; durationSeconds: number };
    majorBeats: Array<{ timeSeconds: number; strength: number }>;
    sourceEvents?: unknown[];
    audioFileName: string;
    audioMimeType: string;
    audioBase64: string;
  }
) {
  const { jsonDir, audioDir } = await ensureStorageDirs(storageDir);
  const preferredId =
    sanitizeId(payload.entry.id) ||
    sanitizeId(payload.entry.name) ||
    sanitizeFileNamePart(payload.entry.fileName) ||
    `entry-${Date.now()}`;
  const id = await createUniqueId(jsonDir, preferredId);

  const audioExtension = normalizeExtension(payload.audioFileName);
  const audioFileName = `${id}${audioExtension}`;
  const audioPath = path.join(audioDir, audioFileName);
  const audioBytes = Buffer.from(payload.audioBase64, "base64");

  if (isBunnyProvider()) {
    await uploadBufferToBunny({
      buffer: audioBytes,
      contentType: payload.audioMimeType || "application/octet-stream",
      objectPath: bunnyObjectPath(`audio/${audioFileName}`),
    });
  } else {
    await fsp.writeFile(audioPath, audioBytes);
  }

  const serializable = {
    id,
    savedAtIso: new Date().toISOString(),
    entry: payload.entry,
    audio: {
      fileName: payload.audioFileName,
      mimeType: payload.audioMimeType,
      storedFileName: audioFileName
    },
    majorBeats: payload.majorBeats,
    sourceEvents: Array.isArray(payload.sourceEvents) ? payload.sourceEvents : []
  };

  const jsonFileName = `${id}.json`;
  await writeEntryJsonBySafeId(storageDir, id, serializable);

  return {
    id,
    fileName: jsonFileName,
    filePath: isBunnyProvider() ? bunnyObjectPath(`json/${jsonFileName}`) : path.join(jsonDir, jsonFileName),
    audioFilePath: isBunnyProvider() ? bunnyObjectPath(`audio/${audioFileName}`) : audioPath
  };
}

export async function listSavedBeatEntries(storageDir: string): Promise<SavedBeatSummary[]> {
  const summaries: SavedBeatSummary[] = [];

  if (isBunnyProvider()) {
    const objects = await listBunnyObjects(bunnyObjectPath("json"));
    for (const object of objects) {
      if (object.isDirectory) {
        continue;
      }
      const fileName = path.basename(object.objectName);
      if (!fileName.endsWith(".json")) {
        continue;
      }
      const safeId = sanitizeId(fileName.replace(/\.json$/i, ""));
      if (!safeId) {
        continue;
      }
      const parsed = await readEntryJsonBySafeId(storageDir, safeId);
      if (!parsed) {
        continue;
      }
      summaries.push(parseSavedEntry(parsed));
    }
  } else {
    const { jsonDir } = await ensureStorageDirs(storageDir);
    const files = await fsp.readdir(jsonDir);
    for (const fileName of files) {
      if (!fileName.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(jsonDir, fileName);
      const raw = await fsp.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      summaries.push(parseSavedEntry(parsed));
    }
  }

  summaries.sort((a, b) => (a.savedAtIso < b.savedAtIso ? 1 : -1));
  return summaries;
}

export async function readSavedBeatEntry(storageDir: string, id: string): Promise<Record<string, unknown> | null> {
  const safeId = sanitizeId(id);
  if (!safeId) {
    return null;
  }

  const parsed = await readEntryJsonBySafeId(storageDir, safeId);
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    availableGameModes: getAvailableGameModes(parsed),
    difficultyBeatCounts: getDifficultyBeatCounts(parsed),
    modeDifficultyBeatCounts: getModeDifficultyBeatCounts(parsed),
    availableDifficulties: getAvailableDifficulties(parsed),
    hasLegacyNormalChartOnly: hasLegacyNormalChartOnly(parsed)
  };
}

export async function createAudioReadStream(
  storageDir: string,
  entry: Record<string, unknown>
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string } | null> {
  const { audioDir } = getStoragePaths(storageDir);
  const audio = entry.audio as { storedFileName?: string; mimeType?: string } | undefined;
  const storedFileName = audio?.storedFileName;
  if (!storedFileName) {
    return null;
  }

  if (isBunnyProvider()) {
    const object = await readBunnyObjectIfExists(bunnyObjectPath(`audio/${storedFileName}`));
    if (!object) {
      return null;
    }
    return {
      stream: Readable.from(object.buffer),
      mimeType: audio?.mimeType || object.contentType || "application/octet-stream"
    };
  }

  const audioPath = path.join(audioDir, storedFileName);
  if (!fs.existsSync(audioPath)) {
    return null;
  }

  return {
    stream: fs.createReadStream(audioPath),
    mimeType: audio?.mimeType || "application/octet-stream"
  };
}

export async function hasPreviewForEntry(storageDir: string, id: string): Promise<boolean> {
  const safeId = sanitizeId(id);
  if (!safeId) {
    return false;
  }

  if (isBunnyProvider()) {
    return bunnyObjectExists(bunnyObjectPath(`previews/${safeId}.wav`));
  }

  const { previewsDir } = getStoragePaths(storageDir);
  const previewPath = path.join(previewsDir, `${safeId}.wav`);
  return fs.existsSync(previewPath);
}

export async function createPreviewReadStream(
  storageDir: string,
  id: string
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string } | null> {
  const safeId = sanitizeId(id);
  if (!safeId) {
    return null;
  }

  if (isBunnyProvider()) {
    const object = await readBunnyObjectIfExists(bunnyObjectPath(`previews/${safeId}.wav`));
    if (!object) {
      return null;
    }
    return {
      stream: Readable.from(object.buffer),
      mimeType: "audio/wav"
    };
  }

  const { previewsDir } = getStoragePaths(storageDir);
  const previewPath = path.join(previewsDir, `${safeId}.wav`);
  if (!fs.existsSync(previewPath)) {
    return null;
  }
  return {
    stream: fs.createReadStream(previewPath),
    mimeType: "audio/wav"
  };
}

export async function saveSeparatedSources(
  storageDir: string,
  id: string,
  separatedSources: Array<{ label: string; fileName: string }>
): Promise<Record<string, unknown> | null> {
  const entry = await readSavedBeatEntry(storageDir, id);
  if (!entry) {
    return null;
  }

  const safeId = sanitizeId(id);
  const updated = {
    ...entry,
    separatedSources,
    separationCompletedAtIso: new Date().toISOString()
  };

  await writeEntryJsonBySafeId(storageDir, safeId, updated);
  return updated;
}

export async function listSeparatedSources(storageDir: string, id: string): Promise<Array<{ label: string; fileName: string }> | null> {
  const entry = await readSavedBeatEntry(storageDir, id);
  if (!entry) {
    return null;
  }
  return Array.isArray(entry.separatedSources)
    ? (entry.separatedSources as Array<{ label: string; fileName: string }>)
    : [];
}

export async function createSeparatedSourceReadStream(
  storageDir: string,
  id: string,
  sourceLabel: string
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string } | null> {
  const safeId = sanitizeId(id);
  const safeSource = sanitizeSourceLabel(sourceLabel);
  if (!safeId || !safeSource) {
    return null;
  }

  if (isBunnyProvider()) {
    const primary = await readBunnyObjectIfExists(bunnyObjectPath(`separated/${safeId}/${safeSource}.wav`));
    const fallback = primary ?? (await readBunnyObjectIfExists(bunnyObjectPath(`separated/${safeId}/${safeSource}`)));
    if (!fallback) {
      return null;
    }
    return {
      stream: Readable.from(fallback.buffer),
      mimeType: "audio/wav"
    };
  }

  const { separatedDir } = getStoragePaths(storageDir);
  const sourceDir = path.join(separatedDir, safeId);
  const candidates = [path.join(sourceDir, `${safeSource}.wav`), path.join(sourceDir, safeSource)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        stream: fs.createReadStream(candidate),
        mimeType: "audio/wav"
      };
    }
  }

  return null;
}

export async function readSeparatedLogTail(
  storageDir: string,
  id: string,
  maxLines = 300
): Promise<{ logFilePath: string; tailLines: string[] } | null> {
  const safeId = sanitizeId(id);
  if (!safeId) {
    return null;
  }

  const safeLineCount = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : 300;

  if (isBunnyProvider()) {
    const logObjectPath = bunnyObjectPath(`separated/${safeId}/separation.log`);
    const logObject = await readBunnyObjectIfExists(logObjectPath);
    if (!logObject) {
      return {
        logFilePath: logObjectPath,
        tailLines: []
      };
    }
    const lines = logObject.buffer.toString("utf8").split(/\r?\n/).filter((line) => line.length > 0);
    return {
      logFilePath: logObjectPath,
      tailLines: lines.slice(-safeLineCount)
    };
  }

  const { separatedDir } = getStoragePaths(storageDir);
  const logPath = path.join(separatedDir, safeId, "separation.log");
  if (!fs.existsSync(logPath)) {
    return {
      logFilePath: logPath,
      tailLines: []
    };
  }

  const raw = await fsp.readFile(logPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  return {
    logFilePath: logPath,
    tailLines: lines.slice(-safeLineCount)
  };
}

export async function saveGameBeatsForEntry(
  storageDir: string,
  id: string,
  payload: {
    gameMode?: "step_arrows" | "orb_beat";
    difficulty?: "easy" | "normal" | "hard";
    gameBeats: unknown[];
    gameNotes?: unknown[];
    gameBeatSelections?: unknown[];
    gameBeatConfig?: Record<string, unknown>;
  }
): Promise<Record<string, unknown> | null> {
  const entry = await readSavedBeatEntry(storageDir, id);
  if (!entry) {
    return null;
  }

  const safeId = sanitizeId(id);
  const gameMode = normalizeGameMode(payload.gameMode);
  const difficulty = normalizeGameDifficulty(payload.difficulty);
  const updated = writeModeDifficultyChart(entry, gameMode, difficulty, {
    gameBeats: Array.isArray(payload.gameBeats) ? payload.gameBeats : [],
    gameNotes: Array.isArray(payload.gameNotes) ? payload.gameNotes : [],
    gameBeatSelections: Array.isArray(payload.gameBeatSelections) ? payload.gameBeatSelections : [],
    gameBeatConfig:
      payload.gameBeatConfig && typeof payload.gameBeatConfig === "object"
        ? { ...payload.gameBeatConfig, gameMode }
        : {},
    gameBeatsUpdatedAtIso: new Date().toISOString()
  });

  await writeEntryJsonBySafeId(storageDir, safeId, updated);
  return {
    ...updated,
    availableGameModes: getAvailableGameModes(updated),
    difficultyBeatCounts: getDifficultyBeatCounts(updated),
    modeDifficultyBeatCounts: getModeDifficultyBeatCounts(updated),
    availableDifficulties: getAvailableDifficulties(updated),
    hasLegacyNormalChartOnly: hasLegacyNormalChartOnly(updated)
  };
}

export async function materializeLegacyNormalGameBeats(
  storageDir: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const entry = await readSavedBeatEntry(storageDir, id);
  if (!entry) {
    return null;
  }

  const updated = materializeLegacyNormalChart(entry);
  const safeId = sanitizeId(id);
  await writeEntryJsonBySafeId(storageDir, safeId, updated);
  return {
    ...updated,
    availableGameModes: getAvailableGameModes(updated),
    difficultyBeatCounts: getDifficultyBeatCounts(updated),
    modeDifficultyBeatCounts: getModeDifficultyBeatCounts(updated),
    availableDifficulties: getAvailableDifficulties(updated),
    hasLegacyNormalChartOnly: hasLegacyNormalChartOnly(updated)
  };
}

export async function saveSongCoverImage(
  storageDir: string,
  entryId: string,
  file: { originalName: string; mimeType: string; bytes: Buffer }
): Promise<{ storedFileName: string }> {
  const safeId = sanitizeId(entryId);
  if (!safeId) {
    throw new Error("Invalid entry id.");
  }

  const extension = imageExtensionFromMimeType(file.mimeType, file.originalName);
  const storedFileName = `${safeId}${extension}`;

  if (isBunnyProvider()) {
    await uploadBufferToBunny({
      buffer: file.bytes,
      objectPath: bunnyObjectPath(`covers/${storedFileName}`),
      contentType: file.mimeType || "application/octet-stream",
    });
  } else {
    const { coversDir } = await ensureStorageDirs(storageDir);
    const coverPath = path.join(coversDir, storedFileName);
    await fsp.writeFile(coverPath, file.bytes);
  }

  return { storedFileName };
}

export async function createSongCoverReadStream(
  storageDir: string,
  storedFileName: string
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string } | null> {
  const safeFileName = String(storedFileName || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeFileName) {
    return null;
  }

  const ext = path.extname(safeFileName).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : "application/octet-stream";

  if (isBunnyProvider()) {
    const object = await readBunnyObjectIfExists(bunnyObjectPath(`covers/${safeFileName}`));
    if (!object) {
      return null;
    }
    return {
      stream: Readable.from(object.buffer),
      mimeType
    };
  }

  const { coversDir } = getStoragePaths(storageDir);
  const coverPath = path.join(coversDir, safeFileName);
  if (!fs.existsSync(coverPath)) {
    return null;
  }

  return {
    stream: fs.createReadStream(coverPath),
    mimeType
  };
}
