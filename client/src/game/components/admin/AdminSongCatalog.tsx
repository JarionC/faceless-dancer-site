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

  return (
    <section className="card game-admin-card">
      <div className="game-admin-card__header">
        <h3>Game Song Catalog</h3>
        <button type="button" onClick={() => load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <p className="small">Enable songs for players and set rolodex titles.</p>
      {status ? <p className="small">{status}</p> : null}
      <div className="game-song-list">
        {entries.map((entry) => (
          <SongRow key={entry.id} entry={entry} onSave={saveSong} />
        ))}
      </div>
    </section>
  );
}

function SongRow({
  entry,
  onSave
}: {
  entry: EntryRow;
  onSave: (entryId: string, title: string, isEnabled: boolean) => Promise<void>;
}): JSX.Element {
  const [title, setTitle] = useState(entry.songTitle || entry.entryName);
  const [enabled, setEnabled] = useState(Boolean(entry.enabled));
  const [saving, setSaving] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
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
    </div>
  );
}
