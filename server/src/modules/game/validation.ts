function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidSource(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_-]{2,40}$/i.test(value);
}

export interface SaveMajorBeatsPayload {
  entry: {
    id?: string;
    name: string;
    fileName: string;
    durationSeconds: number;
  };
  majorBeats: Array<{ timeSeconds: number; strength: number }>;
  sourceEvents?: Array<{
    source: string;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
    strength: number;
  }>;
  audioFileName: string;
  audioMimeType: string;
  audioBase64: string;
}

export interface SaveGameBeatsPayload {
  gameBeats: Array<{ timeSeconds: number; strength: number }>;
  gameBeatSelections?: Array<{
    source: string;
    startSeconds: number;
    endSeconds: number;
    minStrength?: number;
  }>;
  gameNotes?: Array<{
    timeSeconds: number;
    endSeconds: number;
    strength: number;
    source?: string;
  }>;
  gameBeatConfig?: Record<string, unknown>;
}

export interface SaveScorePayload {
  displayName: string;
  score: number;
  maxCombo?: number;
  perfect?: number;
  great?: number;
  good?: number;
  poor?: number;
  miss?: number;
}

export function validateSavePayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return "Body must be a JSON object.";
  }

  const body = payload as Record<string, unknown>;
  const entry = body.entry as Record<string, unknown> | undefined;
  if (!entry || typeof entry !== "object") {
    return "Missing entry object.";
  }
  if (typeof entry.name !== "string" || !entry.name.trim()) {
    return "entry.name is required.";
  }
  if (typeof entry.fileName !== "string" || !entry.fileName.trim()) {
    return "entry.fileName is required.";
  }
  if (!isFiniteNumber(entry.durationSeconds) || entry.durationSeconds < 0) {
    return "entry.durationSeconds must be a non-negative number.";
  }

  const majorBeats = body.majorBeats;
  if (!Array.isArray(majorBeats)) {
    return "majorBeats must be an array.";
  }
  for (const beat of majorBeats) {
    if (!beat || typeof beat !== "object") {
      return "Each major beat must be an object.";
    }
    const value = beat as Record<string, unknown>;
    if (!isFiniteNumber(value.timeSeconds) || value.timeSeconds < 0) {
      return "Each major beat timeSeconds must be a non-negative number.";
    }
    if (!isFiniteNumber(value.strength) || value.strength < 0 || value.strength > 1) {
      return "Each major beat strength must be between 0 and 1.";
    }
  }

  if (typeof body.audioFileName !== "string" || !body.audioFileName.trim()) {
    return "audioFileName is required.";
  }
  if (typeof body.audioMimeType !== "string" || !body.audioMimeType.trim()) {
    return "audioMimeType is required.";
  }
  if (typeof body.audioBase64 !== "string" || !body.audioBase64.trim()) {
    return "audioBase64 is required.";
  }

  const sourceEvents = body.sourceEvents;
  if (sourceEvents !== undefined) {
    if (!Array.isArray(sourceEvents)) {
      return "sourceEvents must be an array if provided.";
    }
    for (const event of sourceEvents) {
      if (!event || typeof event !== "object") {
        return "Each source event must be an object.";
      }
      const value = event as Record<string, unknown>;
      if (!isValidSource(value.source)) {
        return "Each source event source must be an alphanumeric label.";
      }
      if (!isFiniteNumber(value.startSeconds) || value.startSeconds < 0) {
        return "Each source event startSeconds must be non-negative.";
      }
      if (!isFiniteNumber(value.endSeconds) || value.endSeconds < value.startSeconds) {
        return "Each source event endSeconds must be >= startSeconds.";
      }
      if (!isFiniteNumber(value.durationSeconds) || value.durationSeconds < 0) {
        return "Each source event durationSeconds must be non-negative.";
      }
      if (!isFiniteNumber(value.strength) || value.strength < 0 || value.strength > 1) {
        return "Each source event strength must be between 0 and 1.";
      }
    }
  }

  return null;
}

export function validateGameBeatsPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return "Body must be a JSON object.";
  }

  const body = payload as Record<string, unknown>;
  const gameBeats = body.gameBeats;
  if (!Array.isArray(gameBeats)) {
    return "gameBeats must be an array.";
  }
  for (const beat of gameBeats) {
    if (!beat || typeof beat !== "object") {
      return "Each game beat must be an object.";
    }
    const value = beat as Record<string, unknown>;
    if (!isFiniteNumber(value.timeSeconds) || value.timeSeconds < 0) {
      return "Each game beat timeSeconds must be non-negative.";
    }
    if (!isFiniteNumber(value.strength) || value.strength < 0 || value.strength > 1) {
      return "Each game beat strength must be between 0 and 1.";
    }
  }

  const selections = body.gameBeatSelections;
  if (selections !== undefined) {
    if (!Array.isArray(selections)) {
      return "gameBeatSelections must be an array if provided.";
    }
    for (const selection of selections) {
      if (!selection || typeof selection !== "object") {
        return "Each game beat selection must be an object.";
      }
      const value = selection as Record<string, unknown>;
      if (!isValidSource(value.source)) {
        return "Each game beat selection source must be an alphanumeric label.";
      }
      if (!isFiniteNumber(value.startSeconds) || value.startSeconds < 0) {
        return "Each game beat selection startSeconds must be non-negative.";
      }
      if (!isFiniteNumber(value.endSeconds) || value.endSeconds < value.startSeconds) {
        return "Each game beat selection endSeconds must be >= startSeconds.";
      }
    }
  }

  return null;
}

export function validateSaveScorePayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return "Body must be a JSON object.";
  }

  const body = payload as Record<string, unknown>;
  if (typeof body.displayName !== "string" || !body.displayName.trim()) {
    return "displayName is required.";
  }
  if (body.displayName.trim().length > 24) {
    return "displayName must be 24 characters or fewer.";
  }
  if (!isFiniteNumber(body.score) || body.score < 0) {
    return "score must be a non-negative number.";
  }
  const statFields = ["maxCombo", "perfect", "great", "good", "poor", "miss"] as const;
  for (const field of statFields) {
    const value = body[field];
    if (value !== undefined && (!isFiniteNumber(value) || value < 0)) {
      return `${field} must be a non-negative number when provided.`;
    }
  }

  return null;
}
