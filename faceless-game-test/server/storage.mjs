import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

function sanitizeFileNamePart(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function sanitizeId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sanitizeSourceLabel(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 60);
}

function normalizeExtension(fileName) {
  const raw = path.extname(fileName || "").toLowerCase();
  if (!raw) {
    return ".bin";
  }
  return raw.replace(/[^a-z0-9.]/g, "") || ".bin";
}

function getStoragePaths(storageDir) {
  return {
    jsonDir: path.join(storageDir, "json"),
    audioDir: path.join(storageDir, "audio"),
    separatedDir: path.join(storageDir, "separated")
  };
}

async function ensureStorageDirs(storageDir) {
  const { jsonDir, audioDir, separatedDir } = getStoragePaths(storageDir);
  await fs.mkdir(jsonDir, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });
  await fs.mkdir(separatedDir, { recursive: true });
  return { jsonDir, audioDir, separatedDir };
}

async function createUniqueId(jsonDir, baseId) {
  let candidate = baseId || `entry-${Date.now()}`;
  let counter = 1;
  while (true) {
    const jsonPath = path.join(jsonDir, `${candidate}.json`);
    if (!fsSync.existsSync(jsonPath)) {
      return candidate;
    }
    candidate = `${baseId}-${counter}`;
    counter += 1;
  }
}

export async function saveMajorBeatsBundle(storageDir, payload) {
  const { jsonDir, audioDir } = await ensureStorageDirs(storageDir);
  const preferredId =
    sanitizeId(payload.entry.id) || sanitizeId(payload.entry.name) || `entry-${Date.now()}`;
  const id = await createUniqueId(jsonDir, preferredId);
  const audioExtension = normalizeExtension(payload.audioFileName);
  const audioFileName = `${id}${audioExtension}`;
  const audioPath = path.join(audioDir, audioFileName);
  const audioBytes = Buffer.from(payload.audioBase64, "base64");
  await fs.writeFile(audioPath, audioBytes);

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
  const jsonPath = path.join(jsonDir, jsonFileName);
  await fs.writeFile(jsonPath, JSON.stringify(serializable, null, 2), "utf8");

  return {
    id,
    fileName: jsonFileName,
    filePath: jsonPath,
    audioFilePath: audioPath
  };
}

export async function listSavedBeatEntries(storageDir) {
  const { jsonDir } = await ensureStorageDirs(storageDir);
  const files = await fs.readdir(jsonDir);
  const summaries = [];

  for (const fileName of files) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(jsonDir, fileName);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const gameBeatCount = Array.isArray(parsed.gameBeats)
      ? parsed.gameBeats.length
      : Array.isArray(parsed.gameNotes)
        ? parsed.gameNotes.length
        : 0;
    summaries.push({
      id: parsed.id,
      savedAtIso: parsed.savedAtIso,
      entryName: parsed.entry?.name ?? "Untitled",
      fileName: parsed.entry?.fileName ?? "",
      durationSeconds: parsed.entry?.durationSeconds ?? 0,
      majorBeatCount: Array.isArray(parsed.majorBeats) ? parsed.majorBeats.length : 0,
      gameBeatCount,
      sourceEventCount: Array.isArray(parsed.sourceEvents) ? parsed.sourceEvents.length : 0,
      separatedSourceCount: Array.isArray(parsed.separatedSources)
        ? parsed.separatedSources.length
        : 0
    });
  }

  summaries.sort((a, b) => (a.savedAtIso < b.savedAtIso ? 1 : -1));
  return summaries;
}

export async function readSavedBeatEntry(storageDir, id) {
  const { jsonDir } = await ensureStorageDirs(storageDir);
  const safeId = sanitizeId(id);
  if (!safeId) {
    return null;
  }
  const jsonPath = path.join(jsonDir, `${safeId}.json`);
  if (!fsSync.existsSync(jsonPath)) {
    return null;
  }
  const raw = await fs.readFile(jsonPath, "utf8");
  return JSON.parse(raw);
}

export function createAudioReadStream(storageDir, entry) {
  const { audioDir } = getStoragePaths(storageDir);
  const storedFileName = entry?.audio?.storedFileName;
  if (!storedFileName) {
    return null;
  }
  const audioPath = path.join(audioDir, storedFileName);
  if (!fsSync.existsSync(audioPath)) {
    return null;
  }
  return {
    stream: fsSync.createReadStream(audioPath),
    mimeType: entry?.audio?.mimeType || "application/octet-stream"
  };
}

export async function saveSeparatedSources(storageDir, id, separatedSources) {
  const entry = await readSavedBeatEntry(storageDir, id);
  if (!entry) {
    return null;
  }
  const { jsonDir } = await ensureStorageDirs(storageDir);
  const safeId = sanitizeId(id);
  const jsonPath = path.join(jsonDir, `${safeId}.json`);
  const updated = {
    ...entry,
    separatedSources,
    separationCompletedAtIso: new Date().toISOString()
  };
  await fs.writeFile(jsonPath, JSON.stringify(updated, null, 2), "utf8");
  return updated;
}

export async function listSeparatedSources(storageDir, id) {
  const entry = await readSavedBeatEntry(storageDir, id);
  if (!entry) {
    return null;
  }
  return Array.isArray(entry.separatedSources) ? entry.separatedSources : [];
}

export function createSeparatedSourceReadStream(storageDir, id, sourceLabel) {
  const safeId = sanitizeId(id);
  const safeSource = sanitizeSourceLabel(sourceLabel);
  if (!safeId || !safeSource) {
    return null;
  }
  const { separatedDir } = getStoragePaths(storageDir);
  const sourceDir = path.join(separatedDir, safeId);
  const candidates = [path.join(sourceDir, `${safeSource}.wav`), path.join(sourceDir, safeSource)];
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return {
        stream: fsSync.createReadStream(candidate),
        mimeType: "audio/wav"
      };
    }
  }
  return null;
}

export async function readSeparatedLogTail(storageDir, id, maxLines = 200) {
  const safeId = sanitizeId(id);
  if (!safeId) {
    return null;
  }
  const { separatedDir } = getStoragePaths(storageDir);
  const logPath = path.join(separatedDir, safeId, "separation.log");
  if (!fsSync.existsSync(logPath)) {
    return {
      logFilePath: logPath,
      tailLines: []
    };
  }
  const raw = await fs.readFile(logPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  const safeLineCount = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : 200;
  return {
    logFilePath: logPath,
    tailLines: lines.slice(-safeLineCount)
  };
}

export async function saveGameBeatsForEntry(storageDir, id, payload) {
  const entry = await readSavedBeatEntry(storageDir, id);
  if (!entry) {
    return null;
  }
  const { jsonDir } = await ensureStorageDirs(storageDir);
  const safeId = sanitizeId(id);
  const jsonPath = path.join(jsonDir, `${safeId}.json`);
  const updated = {
    ...entry,
    gameBeats: Array.isArray(payload.gameBeats) ? payload.gameBeats : [],
    gameNotes: Array.isArray(payload.gameNotes) ? payload.gameNotes : [],
    gameBeatSelections: Array.isArray(payload.gameBeatSelections) ? payload.gameBeatSelections : [],
    gameBeatConfig:
      payload.gameBeatConfig && typeof payload.gameBeatConfig === "object"
        ? payload.gameBeatConfig
        : {},
    gameBeatsUpdatedAtIso: new Date().toISOString()
  };
  await fs.writeFile(jsonPath, JSON.stringify(updated, null, 2), "utf8");
  return updated;
}
