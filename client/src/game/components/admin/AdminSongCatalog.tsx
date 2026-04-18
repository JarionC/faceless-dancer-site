import { useEffect, useState } from "preact/hooks";
import { runtimeConfig } from "../../config/runtime";

interface EntryRow {
  id: string;
  entryName: string;
  enabled?: boolean;
  songTitle?: string;
  songCoverImageFileName?: string | null;
  gameBeatCount?: number;
  majorBeatCount?: number;
  availableGameModes?: Array<"step_arrows" | "orb_beat">;
  availableDifficulties?: Array<"easy" | "normal" | "hard">;
  difficultyBeatCounts?: Partial<Record<"easy" | "normal" | "hard", number>>;
  modeDifficultyBeatCounts?: Partial<
    Record<"step_arrows" | "orb_beat", Partial<Record<"easy" | "normal" | "hard", number>>>
  >;
  hasLegacyNormalChartOnly?: boolean;
  lyricsSegmentCount?: number;
  lyricsWordCount?: number;
  lyricsEnabled?: boolean;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...(init ?? {}) });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed.");
  }
  return body;
}

export function AdminSongCatalog(): JSX.Element {
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lyricsRunningByEntryId, setLyricsRunningByEntryId] = useState<Record<string, boolean>>({});
  const [lyricsStatusByEntryId, setLyricsStatusByEntryId] = useState<Record<string, string>>({});
  const [lyricsStatusIsErrorByEntryId, setLyricsStatusIsErrorByEntryId] = useState<Record<string, boolean>>({});

  const load = async (): Promise<void> => {
    setLoading(true);
    setStatus(null);
    try {
      const result = await fetchJson<{ entries: EntryRow[] }>(`${runtimeConfig.beatApiBaseUrl}/api/beats/list`);
      setEntries(result.entries ?? []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load entries.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const saveSong = async (entryId: string, title: string, isEnabled: boolean): Promise<void> => {
    setStatus(null);
    try {
      await fetchJson(`${runtimeConfig.beatApiBaseUrl}/api/catalog/songs/${encodeURIComponent(entryId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, isEnabled })
      });
      setStatus("Song catalog updated.");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update song catalog.");
    }
  };

  const materializeNormalDifficulty = async (entryId: string): Promise<void> => {
    setStatus(null);
    try {
      await fetchJson(
        `${runtimeConfig.beatApiBaseUrl}/api/catalog/songs/${encodeURIComponent(entryId)}/materialize-normal-difficulty`,
        {
          method: "POST"
        }
      );
      setStatus("Legacy chart materialized as normal difficulty.");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to materialize normal difficulty.");
    }
  };

  const generateMissingPreviews = async (): Promise<void> => {
    setStatus(null);
    setLoading(true);
    try {
      const result = await fetchJson<{
        total: number;
        generated: number;
        skippedExisting: number;
        failedCount: number;
      }>(`${runtimeConfig.beatApiBaseUrl}/api/catalog/previews/generate-missing`, {
        method: "POST"
      });
      setStatus(
        `Preview generation complete. Generated ${result.generated}/${result.total}, skipped ${result.skippedExisting}, failed ${result.failedCount}.`
      );
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to generate previews.");
      setLoading(false);
    }
  };

  const runLyricsExtraction = async (entryId: string): Promise<void> => {
    if (lyricsRunningByEntryId[entryId]) {
      return;
    }
    setStatus(null);
    setLyricsRunningByEntryId((previous) => ({ ...previous, [entryId]: true }));
    setLyricsStatusIsErrorByEntryId((previous) => ({ ...previous, [entryId]: false }));
    setLyricsStatusByEntryId((previous) => ({ ...previous, [entryId]: "Starting lyrics extraction..." }));
    try {
      await fetchJson(`${runtimeConfig.beatApiBaseUrl}/api/lyrics/${encodeURIComponent(entryId)}/start`, {
        method: "POST"
      });
      setLyricsStatusByEntryId((previous) => ({ ...previous, [entryId]: "Queued lyrics extraction." }));
      const maxPollAttempts = 240;
      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        try {
          const result = await fetchJson<{
            status: string;
            message?: string;
            errorCode?: string;
          }>(`${runtimeConfig.beatApiBaseUrl}/api/lyrics/${encodeURIComponent(entryId)}/status`);
          const details = [result.status, result.message, result.errorCode].filter((part) => Boolean(part)).join(" | ");
          setLyricsStatusByEntryId((previous) => ({
            ...previous,
            [entryId]: details || result.status || "running",
          }));
          setLyricsStatusIsErrorByEntryId((previous) => ({
            ...previous,
            [entryId]: result.status === "failed",
          }));
          if (result.status === "completed") {
            setLyricsStatusByEntryId((previous) => ({ ...previous, [entryId]: "Lyrics extraction completed." }));
            setStatus(`Lyrics extraction completed for ${entryId}.`);
            await load();
            return;
          }
          if (result.status === "failed") {
            setStatus(`Lyrics extraction failed for ${entryId}.`);
            return;
          }
        } catch (pollError) {
          const message = pollError instanceof Error ? pollError.message : "Lyrics status polling failed.";
          setLyricsStatusByEntryId((previous) => ({
            ...previous,
            [entryId]: `Status check issue: ${message}. Retrying...`,
          }));
        }
      }
      setLyricsStatusByEntryId((previous) => ({ ...previous, [entryId]: "Timed out waiting for lyrics status." }));
      setLyricsStatusIsErrorByEntryId((previous) => ({ ...previous, [entryId]: true }));
      setStatus(`Lyrics extraction timed out for ${entryId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to extract lyrics.";
      setLyricsStatusByEntryId((previous) => ({ ...previous, [entryId]: message }));
      setLyricsStatusIsErrorByEntryId((previous) => ({ ...previous, [entryId]: true }));
      setStatus(message);
    } finally {
      setLyricsRunningByEntryId((previous) => ({ ...previous, [entryId]: false }));
    }
  };

  return (
    <section className="card game-admin-card">
      <div className="game-admin-card__header">
        <h3>Game Song Catalog</h3>
        <div>
          <button type="button" className="secondary" onClick={() => generateMissingPreviews()} disabled={loading}>
            {loading ? "Working..." : "Generate Missing Previews"}
          </button>
          <button type="button" onClick={() => load()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      <p className="small">Enable songs for players and set rolodex titles.</p>
      {status ? <p className="small">{status}</p> : null}
      <div className="game-song-list">
        {entries.map((entry) => (
          <SongRow
            key={entry.id}
            entry={entry}
            onSave={saveSong}
            onMaterializeNormal={materializeNormalDifficulty}
            onRunLyrics={runLyricsExtraction}
            lyricsRunning={Boolean(lyricsRunningByEntryId[entry.id])}
            lyricsStatus={lyricsStatusByEntryId[entry.id] ?? null}
            lyricsStatusIsError={Boolean(lyricsStatusIsErrorByEntryId[entry.id])}
          />
        ))}
      </div>
    </section>
  );
}

function SongRow({
  entry,
  onSave,
  onMaterializeNormal,
  onRunLyrics,
  lyricsRunning,
  lyricsStatus,
  lyricsStatusIsError
}: {
  entry: EntryRow;
  onSave: (entryId: string, title: string, isEnabled: boolean) => Promise<void>;
  onMaterializeNormal: (entryId: string) => Promise<void>;
  onRunLyrics: (entryId: string) => Promise<void>;
  lyricsRunning: boolean;
  lyricsStatus: string | null;
  lyricsStatusIsError: boolean;
}): JSX.Element {
  const [title, setTitle] = useState(entry.songTitle || entry.entryName);
  const [enabled, setEnabled] = useState(Boolean(entry.enabled));
  const [saving, setSaving] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [materializingNormal, setMaterializingNormal] = useState(false);
  const [coverStatus, setCoverStatus] = useState<string | null>(null);
  const coverUrl = entry.songCoverImageFileName
    ? `${runtimeConfig.beatApiBaseUrl}/api/catalog/songs/${encodeURIComponent(entry.id)}/cover`
    : null;

  useEffect(() => {
    setTitle(entry.songTitle || entry.entryName);
    setEnabled(Boolean(entry.enabled));
    setCoverFile(null);
    setCoverStatus(null);
  }, [entry.songTitle, entry.entryName, entry.enabled]);

  const uploadCover = async (): Promise<void> => {
    if (!coverFile) {
      setCoverStatus("Select an image first.");
      return;
    }
    setUploadingCover(true);
    setCoverStatus(null);
    try {
      const formData = new FormData();
      formData.set("cover", coverFile);
      const response = await fetch(
        `${runtimeConfig.beatApiBaseUrl}/api/catalog/songs/${encodeURIComponent(entry.id)}/cover`,
        {
          method: "POST",
          credentials: "include",
          body: formData
        }
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to upload cover image.");
      }
      setCoverStatus("Cover image uploaded.");
      setCoverFile(null);
      await onSave(entry.id, title.trim() || entry.entryName, enabled);
    } catch (error) {
      setCoverStatus(error instanceof Error ? error.message : "Failed to upload cover image.");
    } finally {
      setUploadingCover(false);
    }
  };

  return (
    <div className="game-song-row">
      <div>
        <strong>{entry.entryName}</strong>
        <p className="small">{entry.gameBeatCount ?? entry.majorBeatCount ?? 0} beats</p>
        <p className="small">
          Modes: {entry.availableGameModes?.length ? entry.availableGameModes.join(", ") : "none"}
        </p>
        <p className="small">
          Difficulties: {entry.availableDifficulties?.length ? entry.availableDifficulties.join(", ") : "none"}
        </p>
        {entry.difficultyBeatCounts ? (
          <p className="small">
            Easy {entry.difficultyBeatCounts.easy ?? 0} | Normal {entry.difficultyBeatCounts.normal ?? 0} | Hard {entry.difficultyBeatCounts.hard ?? 0}
          </p>
        ) : null}
      </div>
      <input
        type="text"
        value={title}
        onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
        maxLength={120}
      />
      <label className="game-song-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled((event.target as HTMLInputElement).checked)}
        />
        Enabled
      </label>
      <div className="game-song-cover-admin">
        {coverUrl ? (
          <img className="game-song-cover-thumb" src={coverUrl} alt={`${entry.entryName} cover`} />
        ) : (
          <div className="game-song-cover-thumb placeholder">No Cover</div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => setCoverFile((event.target as HTMLInputElement).files?.[0] ?? null)}
        />
        <button type="button" className="secondary" disabled={uploadingCover || !coverFile} onClick={() => uploadCover()}>
          {uploadingCover ? "Uploading..." : "Upload Cover"}
        </button>
        {coverStatus ? <p className="small">{coverStatus}</p> : null}
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(entry.id, title.trim() || entry.entryName, enabled);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving..." : "Save"}
      </button>
      {entry.hasLegacyNormalChartOnly ? (
        <button
          type="button"
          className="secondary"
          disabled={materializingNormal}
          onClick={async () => {
            setMaterializingNormal(true);
            try {
              await onMaterializeNormal(entry.id);
            } finally {
              setMaterializingNormal(false);
            }
          }}
        >
          {materializingNormal ? "Applying..." : "Mark Legacy As Normal"}
        </button>
      ) : null}
      <button
        type="button"
        className="secondary"
        disabled={lyricsRunning || !((entry.majorBeatCount ?? 0) > 0)}
        onClick={() => {
          onRunLyrics(entry.id).catch(() => undefined);
        }}
      >
        {lyricsRunning ? "Extracting Lyrics..." : "Run Lyrics Extraction"}
      </button>
      {lyricsStatus ? <p className={lyricsStatusIsError ? "error" : "small"}>{lyricsStatus}</p> : null}
      <p className="small">
        Lyrics: {entry.lyricsSegmentCount ?? 0} segments, {entry.lyricsWordCount ?? 0} words
        {entry.lyricsEnabled ? " | enabled" : ""}
      </p>
    </div>
  );
}
