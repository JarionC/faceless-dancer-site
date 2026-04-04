import { useState } from "preact/hooks";
import { UploadForm } from "../game/components/UploadForm";
import { runtimeConfig } from "../game/config/runtime";
import { decodeAudioFile } from "../game/lib/audio/decodeAudio";
import { fileToBase64 } from "../game/lib/file/fileToBase64";
import { SavedMajorBeatsView } from "../game/components/SavedMajorBeatsView";
import { AdminSongCatalog } from "../game/components/admin/AdminSongCatalog";
import type { SessionState } from "../hooks/useSession";
import { WalletAuthCard } from "../components/WalletAuthCard";
import { api } from "../lib/api";

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
  refreshSession: () => Promise<void>;
}

function createEntryId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function AdminGamePage({ session, setSession, refreshSession }: Props): JSX.Element {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveStatusIsError, setSaveStatusIsError] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string>("");

  if (!session.authenticated || !session.isAdmin) {
    return (
      <main className="page">
        <section className="card">
          <h1>Admin Game Builder</h1>
          <p className="small">Connect and verify the admin wallet to access this page.</p>
          <p className="small">
            {session.authenticated ? `Connected: ${session.publicKey}` : "Not authenticated."}
          </p>
          <div className="row">
            <button type="button" className="secondary" onClick={() => refreshSession().catch(() => null)}>
              Refresh Session
            </button>
            {session.authenticated ? (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  api.logout().then(() =>
                    setSession({
                      loading: false,
                      authenticated: false,
                      publicKey: "",
                      isHolder: false,
                      isAdmin: false
                    })
                  )
                }
              >
                Logout
              </button>
            ) : null}
          </div>
        </section>
        <WalletAuthCard onVerified={(next) => setSession({ loading: false, ...next })} />
        <section className="card">
          <p className="small">Current role: {session.isAdmin ? "Admin" : "Not admin"}</p>
          <a className="ghost-link" href="/">Back Home</a>
        </section>
      </main>
    );
  }

  const handleUpload = async (payload: { name: string; file: File }): Promise<void> => {
    setError(null);
    setSaveStatus(null);
    setSaveStatusIsError(false);
    setIsProcessing(true);

    try {
      const audioBuffer = await decodeAudioFile(payload.file);
      const response = await fetch(`${runtimeConfig.beatApiBaseUrl}/api/beats/save`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entry: {
            id: createEntryId(),
            name: payload.name,
            fileName: payload.file.name,
            durationSeconds: audioBuffer.duration
          },
          majorBeats: [],
          sourceEvents: [],
          audioFileName: payload.file.name,
          audioMimeType: payload.file.type || "application/octet-stream",
          audioBase64: await fileToBase64(payload.file)
        })
      });

      const responseBody = (await response.json()) as {
        ok?: boolean;
        error?: string;
        id?: string;
        fileName?: string;
      };

      if (!response.ok || !responseBody.ok) {
        throw new Error(responseBody.error ?? "Save failed.");
      }

      if (responseBody.id) {
        setSelectedEntryId(responseBody.id);
      }
      setSaveStatus(
        responseBody.fileName
          ? `Saved audio entry as ${responseBody.fileName} (id: ${responseBody.id ?? "n/a"}). It is now selected in the hybrid editor below.`
          : "Saved audio entry."
      );
      setSaveStatusIsError(false);
    } catch (uploadError) {
      setSaveStatus(
        `Save failed: ${uploadError instanceof Error ? uploadError.message : "Unknown error."}`
      );
      setSaveStatusIsError(true);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="page">
      <section className="card">
        <h1>Admin Game Builder</h1>
        <p className="small">Upload songs, split beats, tune hybrid controls, and save game lanes.</p>
        <p className="small">Wallet: {session.publicKey}</p>
        <div className="row">
          <button type="button" className="secondary" onClick={() => refreshSession().catch(() => null)}>
            Refresh Session
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              api.logout().then(() =>
                setSession({
                  loading: false,
                  authenticated: false,
                  publicKey: "",
                  isHolder: false,
                  isAdmin: false
                })
              )
            }
          >
            Logout
          </button>
        </div>
        <a className="ghost-link" href="/">Back Home</a>
      </section>
      <WalletAuthCard onVerified={(next) => setSession({ loading: false, ...next })} />

      <UploadForm disabled={isProcessing} onSubmit={handleUpload} />
      {error && <p className="error app-error">{error}</p>}
      {saveStatus ? <p className={saveStatusIsError ? "error" : "small"}>{saveStatus}</p> : null}

      <SavedMajorBeatsView
        apiBaseUrl={runtimeConfig.beatApiBaseUrl}
        activeWindowSeconds={runtimeConfig.majorBeatActiveWindowSeconds}
        autoSelectEntryId={selectedEntryId}
      />

      <AdminSongCatalog />
    </main>
  );
}
