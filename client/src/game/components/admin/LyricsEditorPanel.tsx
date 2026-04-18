import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LyricsSubtitle } from "../LyricsSubtitle";
import type { EntryLyrics, LyricSegment, LyricWord, SavedBeatEntry } from "../../types/beat";

interface LyricsEditorPanelProps {
  apiBaseUrl: string;
  entryId: string;
  initialLyrics?: EntryLyrics | null;
  currentTimeSeconds: number;
  onLyricsUpdated: (lyrics: EntryLyrics) => void;
}

function createEmptyLyrics(): EntryLyrics {
  return {
    enabled: true,
    source: "edited",
    provider: "faster-whisper",
    model: "small",
    language: null,
    languageProbability: null,
    updatedAtIso: new Date().toISOString(),
    segments: [],
  };
}

function cloneLyrics(lyrics: EntryLyrics | null | undefined): EntryLyrics {
  const source = lyrics ?? createEmptyLyrics();
  return {
    ...source,
    segments: (source.segments ?? []).map((segment) => ({
      ...segment,
      words: (segment.words ?? []).map((word) => ({ ...word })),
    })),
  };
}

function parseTime(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
}

function normalizeWord(word: LyricWord, fallbackStart: number, fallbackEnd: number): LyricWord {
  const startSeconds = Math.max(0, Number.isFinite(word.startSeconds) ? word.startSeconds : fallbackStart);
  const endSecondsRaw = Number.isFinite(word.endSeconds) ? word.endSeconds : fallbackEnd;
  const endSeconds = Math.max(startSeconds, endSecondsRaw);
  return {
    text: String(word.text ?? "").replace(/\s+/g, " ").trim(),
    startSeconds,
    endSeconds,
  };
}

function normalizeSegment(segment: LyricSegment, index: number): LyricSegment | null {
  const startSeconds = Math.max(0, Number.isFinite(segment.startSeconds) ? segment.startSeconds : 0);
  const endSeconds = Math.max(startSeconds, Number.isFinite(segment.endSeconds) ? segment.endSeconds : startSeconds);
  const words = (segment.words ?? [])
    .map((word) => normalizeWord(word, startSeconds, endSeconds))
    .filter((word) => word.text.length > 0)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const textFromWords = words.map((word) => word.text).join(" ").trim();
  const text = String(segment.text ?? "").replace(/\s+/g, " ").trim() || textFromWords;
  if (!text) {
    return null;
  }
  return {
    id:
      String(segment.id ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || `segment-${index + 1}`,
    text,
    startSeconds,
    endSeconds,
    words,
  };
}

function normalizeLyrics(lyrics: EntryLyrics): EntryLyrics {
  const segments = (lyrics.segments ?? [])
    .map((segment, index) => normalizeSegment(segment, index))
    .filter((segment): segment is LyricSegment => segment !== null)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  return {
    enabled: Boolean(lyrics.enabled),
    source: "edited",
    provider: String(lyrics.provider ?? "faster-whisper").trim() || "faster-whisper",
    model: String(lyrics.model ?? "small").trim() || "small",
    language: lyrics.language ? String(lyrics.language).trim() || null : null,
    languageProbability:
      lyrics.languageProbability === null || lyrics.languageProbability === undefined
        ? null
        : Math.max(0, Math.min(1, Number(lyrics.languageProbability) || 0)),
    updatedAtIso: new Date().toISOString(),
    segments,
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...(init ?? {}),
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed.");
  }
  return body;
}

export function LyricsEditorPanel({
  apiBaseUrl,
  entryId,
  initialLyrics,
  currentTimeSeconds,
  onLyricsUpdated,
}: LyricsEditorPanelProps): JSX.Element {
  const [draftLyrics, setDraftLyrics] = useState<EntryLyrics>(cloneLyrics(initialLyrics));
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const runTokenRef = useRef(0);

  useEffect(() => {
    setDraftLyrics(cloneLyrics(initialLyrics));
    setStatus(null);
    setStatusIsError(false);
    setExtracting(false);
    runTokenRef.current += 1;
  }, [entryId, initialLyrics]);

  const wordCount = useMemo(
    () => draftLyrics.segments.reduce((total, segment) => total + (segment.words?.length ?? 0), 0),
    [draftLyrics.segments]
  );

  const updateSegment = (segmentIndex: number, updater: (segment: LyricSegment) => LyricSegment): void => {
    setDraftLyrics((previous) => {
      const segments = [...previous.segments];
      const current = segments[segmentIndex];
      if (!current) {
        return previous;
      }
      segments[segmentIndex] = updater(current);
      return { ...previous, segments };
    });
  };

  const updateWord = (
    segmentIndex: number,
    wordIndex: number,
    updater: (word: LyricWord) => LyricWord
  ): void => {
    updateSegment(segmentIndex, (segment) => {
      const words = [...(segment.words ?? [])];
      const currentWord = words[wordIndex];
      if (!currentWord) {
        return segment;
      }
      words[wordIndex] = updater(currentWord);
      return { ...segment, words };
    });
  };

  const addSegment = (): void => {
    setDraftLyrics((previous) => {
      const segments = [...previous.segments];
      const last = segments[segments.length - 1];
      const startSeconds = last ? Math.max(0, last.endSeconds + 0.08) : 0;
      segments.push({
        id: `segment-${segments.length + 1}`,
        text: "",
        startSeconds,
        endSeconds: startSeconds + 1,
        words: [],
      });
      return { ...previous, segments };
    });
  };

  const removeSegment = (segmentIndex: number): void => {
    setDraftLyrics((previous) => ({
      ...previous,
      segments: previous.segments.filter((_, index) => index !== segmentIndex),
    }));
  };

  const addWord = (segmentIndex: number): void => {
    updateSegment(segmentIndex, (segment) => {
      const words = [...(segment.words ?? [])];
      const last = words[words.length - 1];
      const startSeconds = last ? Math.max(segment.startSeconds, last.endSeconds) : segment.startSeconds;
      words.push({
        text: "",
        startSeconds,
        endSeconds: Math.max(startSeconds + 0.24, segment.endSeconds),
      });
      return { ...segment, words };
    });
  };

  const removeWord = (segmentIndex: number, wordIndex: number): void => {
    updateSegment(segmentIndex, (segment) => ({
      ...segment,
      words: (segment.words ?? []).filter((_, index) => index !== wordIndex),
    }));
  };

  const refreshLyricsFromEntry = async (): Promise<void> => {
    const detail = await fetchJson<{ ok: boolean; entry: SavedBeatEntry }>(
      `${apiBaseUrl}/api/beats/${encodeURIComponent(entryId)}`
    );
    const nextLyrics = cloneLyrics(detail.entry.lyrics ?? createEmptyLyrics());
    setDraftLyrics(nextLyrics);
    onLyricsUpdated(nextLyrics);
  };

  const runExtraction = async (): Promise<void> => {
    if (!entryId || extracting) {
      return;
    }

    setStatusIsError(false);
    setStatus("Starting lyrics extraction...");
    setExtracting(true);
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;

    try {
      await fetchJson(`${apiBaseUrl}/api/lyrics/${encodeURIComponent(entryId)}/start`, {
        method: "POST",
      });
    } catch (error) {
      if (runTokenRef.current !== token) {
        return;
      }
      setExtracting(false);
      setStatusIsError(true);
      setStatus(error instanceof Error ? error.message : "Failed to start lyrics extraction.");
      return;
    }

    const maxPollAttempts = 240;
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      if (runTokenRef.current !== token) {
        return;
      }
      try {
        const result = await fetchJson<{
          ok: boolean;
          status: string;
          message?: string;
          errorCode?: string;
        }>(`${apiBaseUrl}/api/lyrics/${encodeURIComponent(entryId)}/status`);
        const statusLabel = [result.status, result.message, result.errorCode]
          .filter((part) => Boolean(part))
          .join(" | ");
        setStatus(statusLabel || "Lyrics extraction running...");

        if (result.status === "completed") {
          await refreshLyricsFromEntry();
          if (runTokenRef.current !== token) {
            return;
          }
          setExtracting(false);
          setStatusIsError(false);
          setStatus("Lyrics extraction completed.");
          return;
        }

        if (result.status === "failed") {
          setExtracting(false);
          setStatusIsError(true);
          setStatus(statusLabel || "Lyrics extraction failed.");
          return;
        }
      } catch (error) {
        setStatus(error instanceof Error ? `Lyrics status check failed: ${error.message}` : "Lyrics status check failed.");
      }
    }

    if (runTokenRef.current === token) {
      setExtracting(false);
      setStatusIsError(true);
      setStatus("Timed out waiting for lyrics extraction status.");
    }
  };

  const saveLyrics = async (): Promise<void> => {
    if (!entryId || saving) {
      return;
    }

    setSaving(true);
    setStatus(null);
    setStatusIsError(false);
    const normalized = normalizeLyrics(draftLyrics);

    try {
      const result = await fetchJson<{ ok: boolean; entryId: string; lyrics: EntryLyrics }>(
        `${apiBaseUrl}/api/beats/${encodeURIComponent(entryId)}/lyrics`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lyrics: normalized }),
        }
      );
      const next = cloneLyrics(result.lyrics ?? normalized);
      setDraftLyrics(next);
      onLyricsUpdated(next);
      setStatus("Lyrics saved.");
      setStatusIsError(false);
    } catch (error) {
      setStatusIsError(true);
      setStatus(error instanceof Error ? error.message : "Failed to save lyrics.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="editor-fieldset lyrics-editor-panel">
      <legend>Lyrics</legend>
      <div className="lyrics-editor-actions">
        <label className="lyrics-enabled-toggle">
          <input
            type="checkbox"
            checked={draftLyrics.enabled}
            onChange={(event) =>
              setDraftLyrics((previous) => ({
                ...previous,
                enabled: event.currentTarget.checked,
              }))
            }
          />
          Enable Lyrics In Game
        </label>
        <button type="button" onClick={() => runExtraction()} disabled={extracting}>
          {extracting ? "Extracting..." : "Run Lyrics Extraction"}
        </button>
        <button type="button" className="secondary" onClick={() => addSegment()}>
          Add Segment
        </button>
        <button type="button" onClick={() => saveLyrics()} disabled={saving}>
          {saving ? "Saving..." : "Save Lyrics Edits"}
        </button>
      </div>

      {status ? <p className={statusIsError ? "error" : "save-status"}>{status}</p> : null}

      <p className="small">
        Segments: {draftLyrics.segments.length} | Words: {wordCount}
      </p>

      <div className="lyrics-preview-shell">
        <p className="small">Game Subtitle Preview</p>
        <LyricsSubtitle lyrics={draftLyrics} currentTimeSeconds={currentTimeSeconds} className="lyrics-subtitle--preview" />
      </div>

      <div className="lyrics-segment-list">
        {draftLyrics.segments.map((segment, segmentIndex) => (
          <div key={segment.id || `segment-${segmentIndex}`} className="lyrics-segment-item">
            <div className="lyrics-segment-grid">
              <label>
                <span className="control-label">Start (s)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={segment.startSeconds}
                  onChange={(event) =>
                    updateSegment(segmentIndex, (current) => ({
                      ...current,
                      startSeconds: parseTime(event.currentTarget.value, current.startSeconds),
                    }))
                  }
                />
              </label>
              <label>
                <span className="control-label">End (s)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={segment.endSeconds}
                  onChange={(event) =>
                    updateSegment(segmentIndex, (current) => ({
                      ...current,
                      endSeconds: parseTime(event.currentTarget.value, current.endSeconds),
                    }))
                  }
                />
              </label>
              <button type="button" className="secondary" onClick={() => addWord(segmentIndex)}>
                Add Word
              </button>
              <button type="button" className="secondary" onClick={() => removeSegment(segmentIndex)}>
                Remove Segment
              </button>
            </div>
            <label>
              <span className="control-label">Phrase</span>
              <textarea
                rows={2}
                value={segment.text}
                onInput={(event) =>
                  updateSegment(segmentIndex, (current) => ({
                    ...current,
                    text: event.currentTarget.value,
                  }))
                }
              />
            </label>

            <div className="lyrics-word-list">
              {(segment.words ?? []).map((word, wordIndex) => (
                <div key={`${segment.id}-word-${wordIndex}`} className="lyrics-word-item">
                  <input
                    type="text"
                    value={word.text}
                    onInput={(event) =>
                      updateWord(segmentIndex, wordIndex, (current) => ({
                        ...current,
                        text: event.currentTarget.value,
                      }))
                    }
                    placeholder="Word"
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={word.startSeconds}
                    onChange={(event) =>
                      updateWord(segmentIndex, wordIndex, (current) => ({
                        ...current,
                        startSeconds: parseTime(event.currentTarget.value, current.startSeconds),
                      }))
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={word.endSeconds}
                    onChange={(event) =>
                      updateWord(segmentIndex, wordIndex, (current) => ({
                        ...current,
                        endSeconds: parseTime(event.currentTarget.value, current.endSeconds),
                      }))
                    }
                  />
                  <button type="button" className="secondary" onClick={() => removeWord(segmentIndex, wordIndex)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
