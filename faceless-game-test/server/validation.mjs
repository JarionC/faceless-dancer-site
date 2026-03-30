function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidSource(value) {
  return typeof value === "string" && /^[a-z0-9_-]{2,40}$/i.test(value);
}

export function validateSavePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "Body must be a JSON object.";
  }

  const entry = payload.entry;
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

  const majorBeats = payload.majorBeats;
  if (!Array.isArray(majorBeats)) {
    return "majorBeats must be an array.";
  }

  for (const beat of majorBeats) {
    if (!beat || typeof beat !== "object") {
      return "Each major beat must be an object.";
    }
    if (!isFiniteNumber(beat.timeSeconds) || beat.timeSeconds < 0) {
      return "Each major beat timeSeconds must be a non-negative number.";
    }
    if (!isFiniteNumber(beat.strength) || beat.strength < 0 || beat.strength > 1) {
      return "Each major beat strength must be between 0 and 1.";
    }
  }

  if (typeof payload.audioFileName !== "string" || !payload.audioFileName.trim()) {
    return "audioFileName is required.";
  }

  if (typeof payload.audioMimeType !== "string" || !payload.audioMimeType.trim()) {
    return "audioMimeType is required.";
  }

  if (typeof payload.audioBase64 !== "string" || !payload.audioBase64.trim()) {
    return "audioBase64 is required.";
  }

  if (payload.sourceEvents !== undefined) {
    if (!Array.isArray(payload.sourceEvents)) {
      return "sourceEvents must be an array if provided.";
    }

    for (const event of payload.sourceEvents) {
      if (!event || typeof event !== "object") {
        return "Each source event must be an object.";
      }
      if (!isValidSource(event.source)) {
        return "Each source event source must be an alphanumeric label.";
      }
      if (!isFiniteNumber(event.startSeconds) || event.startSeconds < 0) {
        return "Each source event startSeconds must be a non-negative number.";
      }
      if (!isFiniteNumber(event.endSeconds) || event.endSeconds < event.startSeconds) {
        return "Each source event endSeconds must be >= startSeconds.";
      }
      if (!isFiniteNumber(event.durationSeconds) || event.durationSeconds < 0) {
        return "Each source event durationSeconds must be non-negative.";
      }
      if (!isFiniteNumber(event.strength) || event.strength < 0 || event.strength > 1) {
        return "Each source event strength must be between 0 and 1.";
      }
    }
  }

  return null;
}

export function validateGameBeatsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "Body must be a JSON object.";
  }

  if (!Array.isArray(payload.gameBeats)) {
    return "gameBeats must be an array.";
  }

  for (const beat of payload.gameBeats) {
    if (!beat || typeof beat !== "object") {
      return "Each game beat must be an object.";
    }
    if (!isFiniteNumber(beat.timeSeconds) || beat.timeSeconds < 0) {
      return "Each game beat timeSeconds must be a non-negative number.";
    }
    if (!isFiniteNumber(beat.strength) || beat.strength < 0 || beat.strength > 1) {
      return "Each game beat strength must be between 0 and 1.";
    }
  }

  if (payload.gameBeatSelections !== undefined) {
    if (!Array.isArray(payload.gameBeatSelections)) {
      return "gameBeatSelections must be an array if provided.";
    }
    for (const selection of payload.gameBeatSelections) {
      if (!selection || typeof selection !== "object") {
        return "Each game beat selection must be an object.";
      }
      if (!isValidSource(selection.source)) {
        return "Each game beat selection source must be an alphanumeric label.";
      }
      if (!isFiniteNumber(selection.startSeconds) || selection.startSeconds < 0) {
        return "Each game beat selection startSeconds must be a non-negative number.";
      }
      if (!isFiniteNumber(selection.endSeconds) || selection.endSeconds < selection.startSeconds) {
        return "Each game beat selection endSeconds must be >= startSeconds.";
      }
      if (
        selection.minStrength !== undefined &&
        (!isFiniteNumber(selection.minStrength) || selection.minStrength < 0 || selection.minStrength > 1)
      ) {
        return "Each game beat selection minStrength must be between 0 and 1 when provided.";
      }
    }
  }

  if (payload.gameNotes !== undefined) {
    if (!Array.isArray(payload.gameNotes)) {
      return "gameNotes must be an array if provided.";
    }
    for (const note of payload.gameNotes) {
      if (!note || typeof note !== "object") {
        return "Each game note must be an object.";
      }
      if (!isFiniteNumber(note.timeSeconds) || note.timeSeconds < 0) {
        return "Each game note timeSeconds must be a non-negative number.";
      }
      if (!isFiniteNumber(note.endSeconds) || note.endSeconds < note.timeSeconds) {
        return "Each game note endSeconds must be >= timeSeconds.";
      }
      if (!isFiniteNumber(note.strength) || note.strength < 0 || note.strength > 1) {
        return "Each game note strength must be between 0 and 1.";
      }
      if (note.source !== undefined && !isValidSource(note.source)) {
        return "Each game note source must be an alphanumeric label when provided.";
      }
    }
  }

  if (payload.gameBeatConfig !== undefined) {
    if (!payload.gameBeatConfig || typeof payload.gameBeatConfig !== "object") {
      return "gameBeatConfig must be an object if provided.";
    }
  }

  return null;
}
