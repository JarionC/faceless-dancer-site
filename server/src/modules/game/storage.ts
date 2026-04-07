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

async function createUniqueId(baseId: string) {
  let candidate = baseId || `entry-${Date.now()}`;
  let counter = 1;
  while (await bunnyObjectExists(bunnyObjectPath(`json/${candidate}.json`))) {
    candidate = `${baseId}-${counter}`;
    counter += 1;
  }
  return candidate;
}

async function readEntryJsonBySafeId(safeId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await downloadFromBunny(bunnyObjectPath(`json/${safeId}.json`));
    return JSON.parse(raw.buffer.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeEntryJsonBySafeId(safeId: string, payload: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(payload, null, 2);
  await uploadTextToBunny({
    text,
    objectPath: bunnyObjectPath(`json/${safeId}.json`),
    contentType: "application/json"
  });
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

export async function saveMajorBeatsBundle(payload: {
  entry: { id?: string; name: string; fileName: string; durationSeconds: number };
  majorBeats: Array<{ timeSeconds: number; strength: number }>;
  sourceEvents?: unknown[];
  audioFileName: string;
  audioMimeType: string;
  audioBase64: string;
}) {
  const preferredId =
    sanitizeId(payload.entry.id) ||
    sanitizeId(payload.entry.name) ||
    sanitizeFileNamePart(payload.entry.fileName) ||
    `entry-${Date.now()}`;
  const id = await createUniqueId(preferredId);

  const audioExtension = normalizeExtension(payload.audioFileName);
  const audioFileName = `${id}${audioExtension}`;
  const audioBytes = Buffer.from(payload.audioBase64, "base64");

  await uploadBufferToBunny({
    buffer: audioBytes,
    contentType: payload.audioMimeType || "application/octet-stream",
    objectPath: bunnyObjectPath(`audio/${audioFileName}`),
  });

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
  await writeEntryJsonBySafeId(id, serializable);

  return {
    id,
    fileName: jsonFileName,
    filePath: bunnyObjectPath(`json/${jsonFileName}`),
    audioFilePath: bunnyObjectPath(`audio/${audioFileName}`)
  };
}

export async function listSavedBeatEntries(): Promise<SavedBeatSummary[]> {
  const summaries: SavedBeatSummary[] = [];
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
    const parsed = await readEntryJsonBySafeId(safeId);
    if (!parsed) {
      continue;
    }
    summaries.push(parseSavedEntry(parsed));
  }

  summaries.sort((a, b) => (a.savedAtIso < b.savedAtIso ? 1 : -1));
  return summaries;
}

export async function readSavedBeatEntry(id: string): Promise<Record<string, unknown> | null> {
  const safeId = sanitizeId(id);
  if (!safeId) {
    return null;
  }

  const parsed = await readEntryJsonBySafeId(safeId);
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
  entry: Record<string, unknown>
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string } | null> {
  const audio = entry.audio as { storedFileName?: string; mimeType?: string } | undefined;
  const storedFileName = audio?.storedFileName;
  if (!storedFileName) {
    return null;
  }

  const object = await readBunnyObjectIfExists(bunnyObjectPath(`audio/${storedFileName}`));
  if (!object) {
    return null;
  }
  return {
    stream: Readable.from(object.buffer),
    mimeType: audio?.mimeType || object.contentType || "application/octet-stream"
  };
}

export async function hasPreviewForEntry(id: string): Promise<boolean> {
  const safeId = sanitizeId(id);
  if (!safeId) {
    return false;
  }

  return bunnyObjectExists(bunnyObjectPath(`previews/${safeId}.wav`));
}

export async function createPreviewReadStream(
  id: string
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string } | null> {
  const safeId = sanitizeId(id);
  if (!safeId) {
    return null;
  }

  const object = await readBunnyObjectIfExists(bunnyObjectPath(`previews/${safeId}.wav`));
  if (!object) {
    return null;
  }
  return {
    stream: Readable.from(object.buffer),
    mimeType: "audio/wav"
  };
}

export async function saveSeparatedSources(
  id: string,
  separatedSources: Array<{ label: string; fileName: string }>
): Promise<Record<string, unknown> | null> {
  const entry = await readSavedBeatEntry(id);
  if (!entry) {
    return null;
  }

  const safeId = sanitizeId(id);
  const updated = {
    ...entry,
    separatedSources,
    separationCompletedAtIso: new Date().toISOString()
  };

  await writeEntryJsonBySafeId(safeId, updated);
  return updated;
}

export async function listSeparatedSources(id: string): Promise<Array<{ label: string; fileName: string }> | null> {
  const entry = await readSavedBeatEntry(id);
  if (!entry) {
    return null;
  }
  return Array.isArray(entry.separatedSources)
    ? (entry.separatedSources as Array<{ label: string; fileName: string }>)
    : [];
}

export async function createSeparatedSourceReadStream(
  id: string,
  sourceLabel: string
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string } | null> {
  const safeId = sanitizeId(id);
  const safeSource = sanitizeSourceLabel(sourceLabel);
  if (!safeId || !safeSource) {
    return null;
  }

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

export async function readSeparatedLogTail(
  id: string,
  maxLines = 300
): Promise<{ logFilePath: string; tailLines: string[] } | null> {
  const safeId = sanitizeId(id);
  if (!safeId) {
    return null;
  }

  const safeLineCount = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : 300;
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

export async function saveGameBeatsForEntry(
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
  const entry = await readSavedBeatEntry(id);
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

  await writeEntryJsonBySafeId(safeId, updated);
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
  id: string
): Promise<Record<string, unknown> | null> {
  const entry = await readSavedBeatEntry(id);
  if (!entry) {
    return null;
  }

  const updated = materializeLegacyNormalChart(entry);
  const safeId = sanitizeId(id);
  await writeEntryJsonBySafeId(safeId, updated);
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
  entryId: string,
  file: { originalName: string; mimeType: string; bytes: Buffer }
): Promise<{ storedFileName: string }> {
  const safeId = sanitizeId(entryId);
  if (!safeId) {
    throw new Error("Invalid entry id.");
  }

  const extension = imageExtensionFromMimeType(file.mimeType, file.originalName);
  const storedFileName = `${safeId}${extension}`;

  await uploadBufferToBunny({
    buffer: file.bytes,
    objectPath: bunnyObjectPath(`covers/${storedFileName}`),
    contentType: file.mimeType || "application/octet-stream",
  });

  return { storedFileName };
}

export async function createSongCoverReadStream(
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

  const object = await readBunnyObjectIfExists(bunnyObjectPath(`covers/${safeFileName}`));
  if (!object) {
    return null;
  }
  return {
    stream: Readable.from(object.buffer),
    mimeType
  };
}
