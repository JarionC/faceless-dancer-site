import { useEffect, useMemo, useState } from "preact/hooks";
import { UploadForm } from "../game/components/UploadForm";
import { BeatChart } from "../game/components/BeatChart";
import { AudioPlayer } from "../game/components/AudioPlayer";
import { runtimeConfig } from "../game/config/runtime";
import { decodeAudioFile } from "../game/lib/audio/decodeAudio";
import { extractBeatDataFromAudioBuffer } from "../game/lib/audio/extractBeatData";
import { findProminentPeakIndices } from "../game/lib/audio/findProminentPeaks";
import { extractSourceEventsFromAudioBuffer } from "../game/lib/audio/extractSourceEvents";
import { fileToBase64 } from "../game/lib/file/fileToBase64";
import type { BeatEntry } from "../game/types/beat";
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
  const [entry, setEntry] = useState<BeatEntry | null>(null);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveStatusIsError, setSaveStatusIsError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const extractionConfig = useMemo(
    () => ({
      windowSize: runtimeConfig.beatWindowSize,
      hopSize: runtimeConfig.beatHopSize,
      smoothingAlpha: runtimeConfig.beatSmoothingAlpha
    }),
    []
  );
  const peakConfig = useMemo(
    () => ({
      minProminence: runtimeConfig.peakMinProminence,
      minStrength: runtimeConfig.peakMinStrength,
      minDistancePoints: runtimeConfig.peakMinDistancePoints
    }),
    []
  );
  const sourceConfig = useMemo(
    () => ({
      windowSize: runtimeConfig.beatWindowSize,
      hopSize: runtimeConfig.beatHopSize,
      drumsThreshold: runtimeConfig.sourceDrumsThreshold,
      bassThreshold: runtimeConfig.sourceBassThreshold,
      otherThreshold: runtimeConfig.sourceOtherThreshold,
      drumsMinDurationSeconds: runtimeConfig.sourceDrumsMinDurationSeconds,
      bassMinDurationSeconds: runtimeConfig.sourceBassMinDurationSeconds,
      otherMinDurationSeconds: runtimeConfig.sourceOtherMinDurationSeconds,
      syntheticSourceCount: runtimeConfig.sourceSyntheticCount,
      transientHopScale: runtimeConfig.sourceTransientHopScale,
      adaptiveThresholdWindow: runtimeConfig.sourceAdaptiveThresholdWindow,
      minInterOnsetSeconds: runtimeConfig.sourceMinInterOnsetSeconds,
      bassDominanceRatio: runtimeConfig.sourceBassDominanceRatio,
      bassMaxSustainSeconds: runtimeConfig.sourceBassMaxSustainSeconds,
      drumTransientGain: runtimeConfig.sourceDrumTransientGain,
      drumTriggerFloor: runtimeConfig.sourceDrumTriggerFloor,
      reassignMargin: runtimeConfig.sourceReassignMargin
    }),
    []
  );

  useEffect(() => {
    return () => {
      if (entry?.audioUrl) {
        URL.revokeObjectURL(entry.audioUrl);
      }
    };
  }, [entry]);

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
      const beatData = extractBeatDataFromAudioBuffer(audioBuffer, extractionConfig);
      const peakIndices = findProminentPeakIndices(beatData, peakConfig);
      const sourceEvents = extractSourceEventsFromAudioBuffer(audioBuffer, sourceConfig);
      const audioUrl = URL.createObjectURL(payload.file);

      setEntry((previous) => {
        if (previous?.audioUrl) {
          URL.revokeObjectURL(previous.audioUrl);
        }
        return {
          id: createEntryId(),
          name: payload.name,
          fileName: payload.file.name,
          audioUrl,
          sourceFile: payload.file,
          durationSeconds: audioBuffer.duration,
          beatData,
          peakIndices,
          sourceEvents
        };
      });
      setDurationSeconds(audioBuffer.duration);
      setCurrentTimeSeconds(0);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to process audio file.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveMajorBeats = async (): Promise<void> => {
    if (!entry) {
      return;
    }

    const majorBeats = entry.peakIndices
      .map((index) => entry.beatData[index])
      .filter((point): point is BeatEntry["beatData"][number] => point !== undefined)
      .map((point) => ({
        timeSeconds: point.timeSeconds,
        strength: point.strength
      }));

    setIsSaving(true);
    setSaveStatus(null);
    setSaveStatusIsError(false);

    try {
      const response = await fetch(`${runtimeConfig.beatApiBaseUrl}/api/beats/save`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entry: {
            id: entry.id,
            name: entry.name,
            fileName: entry.fileName,
            durationSeconds: entry.durationSeconds
          },
          majorBeats,
          sourceEvents: entry.sourceEvents,
          audioFileName: entry.sourceFile.name,
          audioMimeType: entry.sourceFile.type || "application/octet-stream",
          audioBase64: await fileToBase64(entry.sourceFile)
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

      setSaveStatus(
        responseBody.fileName
          ? `Saved major beats and audio as ${responseBody.fileName} (id: ${responseBody.id ?? "n/a"})`
          : "Saved major beats."
      );
      setSaveStatusIsError(false);
    } catch (saveError) {
      setSaveStatus(
        `Save failed: ${saveError instanceof Error ? saveError.message : "Unknown error."}`
      );
      setSaveStatusIsError(true);
    } finally {
      setIsSaving(false);
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

      {entry ? (
        <>
          <section className="card">
            <h3>Current Entry</h3>
            <p><strong>Name:</strong> {entry.name}</p>
            <p><strong>File:</strong> {entry.fileName}</p>
            <p><strong>Duration:</strong> {entry.durationSeconds.toFixed(2)}s</p>
            <p><strong>Beat Points:</strong> {entry.beatData.length}</p>
            <p><strong>Prominent Peaks:</strong> {entry.peakIndices.length}</p>
            <p><strong>Source Events:</strong> {entry.sourceEvents.length}</p>
          </section>

          <AudioPlayer
            audioUrl={entry.audioUrl}
            onTimeUpdate={setCurrentTimeSeconds}
            onDurationAvailable={setDurationSeconds}
          />

          <BeatChart
            points={entry.beatData}
            peakIndices={entry.peakIndices}
            sourceEvents={entry.sourceEvents}
            currentTimeSeconds={currentTimeSeconds}
            durationSeconds={durationSeconds}
          />

          <section className="card">
            <button
              type="button"
              onClick={handleSaveMajorBeats}
              disabled={isSaving || entry.peakIndices.length === 0}
            >
              {isSaving ? "Saving..." : "Save Major Beats"}
            </button>
            <p className="small">Saves major beats and source audio bundle for hybrid analysis.</p>
            {saveStatus ? (
              <p className={saveStatusIsError ? "error" : "small"}>{saveStatus}</p>
            ) : null}
          </section>
        </>
      ) : null}

      <SavedMajorBeatsView
        apiBaseUrl={runtimeConfig.beatApiBaseUrl}
        activeWindowSeconds={runtimeConfig.majorBeatActiveWindowSeconds}
      />

      <AdminSongCatalog />
    </main>
  );
}
