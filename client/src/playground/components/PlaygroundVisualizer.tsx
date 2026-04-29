import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { runtimeConfig } from "../../game/config/runtime";
import {
  buildPublicAudioUrl,
  fetchEnabledSongs,
  fetchPublicBeatEntry,
  resolveAccentBeats,
} from "../lib/publicSongApi";
import { useMeydaFeatures } from "../hooks/useMeydaFeatures";
import type { PlaygroundSongSummary, PlaygroundTrackData, VisualizerMode } from "../types";
import { renderVisualizer } from "../visualizers/renderers";

interface PlaygroundVisualizerProps {
  homeHref: string;
}

const VISUALIZER_MODES: Array<{ id: VisualizerMode; label: string }> = [
  { id: "prism_bloom", label: "Prism Bloom" },
  { id: "nebula_ribbons", label: "Nebula Ribbons" },
  { id: "pulse_tunnel", label: "Pulse Tunnel" },
  { id: "lattice_dream", label: "Lattice Dream" },
  { id: "fractal_atlas", label: "Fractal Atlas" },
  { id: "celestial_gyroscope", label: "Celestial Gyroscope" },
  { id: "chaos_bloom", label: "Chaos Bloom" },
  { id: "quantum_veil", label: "Quantum Veil" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatTimeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function findNextBeatIndex(
  beats: Array<{ timeSeconds: number; strength: number }>,
  timeSeconds: number
): number {
  let low = 0;
  let high = beats.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (beats[mid].timeSeconds < timeSeconds) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function PlaygroundVisualizer({ homeHref }: PlaygroundVisualizerProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef(0);
  const beatIndexRef = useRef(0);
  const beatPulseRef = useRef(0);
  const currentTimeStateRef = useRef(0);
  const durationStateRef = useRef(0);
  const renderSizeRef = useRef({ width: window.innerWidth, height: window.innerHeight });
  const pixelRatioRef = useRef(window.devicePixelRatio || 1);

  const [songs, setSongs] = useState<PlaygroundSongSummary[]>([]);
  const [selectedSongId, setSelectedSongId] = useState("");
  const [trackData, setTrackData] = useState<PlaygroundTrackData | null>(null);
  const [mode, setMode] = useState<VisualizerMode>(runtimeConfig.playgroundDefaultMode);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [songsPanelOpen, setSongsPanelOpen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const bindAudioElement = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    setAudioElement(node);
  }, []);

  const audioUrl = useMemo(() => {
    if (!selectedSongId) return "";
    return buildPublicAudioUrl(runtimeConfig.beatApiBaseUrl, selectedSongId);
  }, [selectedSongId]);

  const selectedSong = useMemo(
    () => songs.find((song) => song.beatEntryId === selectedSongId) ?? null,
    [songs, selectedSongId]
  );

  const { featuresRef, resumeAudio, startAnalyzing, stopAnalyzing } = useMeydaFeatures(
    audioElement,
    {
      bufferSize: runtimeConfig.playgroundMeydaBufferSize,
      smoothing: runtimeConfig.playgroundFeatureSmoothing,
    }
  );

  useEffect(() => {
    let cancelled = false;
    const loadSongs = async () => {
      setLoadingSongs(true);
      setLoadError(null);
      try {
        const nextSongs = await fetchEnabledSongs(runtimeConfig.beatApiBaseUrl);
        if (cancelled) return;
        setSongs(nextSongs);
        setSelectedSongId((prev) => prev || nextSongs[0]?.beatEntryId || "");
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load songs.");
      } finally {
        if (!cancelled) setLoadingSongs(false);
      }
    };

    void loadSongs();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSongId) {
      setTrackData(null);
      return;
    }
    const song = songs.find((row) => row.beatEntryId === selectedSongId);
    if (!song) {
      setTrackData(null);
      return;
    }

    let cancelled = false;
    const loadTrack = async () => {
      setLoadingTrack(true);
      setLoadError(null);
      try {
        const entry = await fetchPublicBeatEntry(runtimeConfig.beatApiBaseUrl, selectedSongId);
        if (cancelled) return;
        setTrackData({
          song,
          entry,
          accentBeats: resolveAccentBeats(entry).sort((a, b) => a.timeSeconds - b.timeSeconds),
        });
        beatIndexRef.current = 0;
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load song beats.");
      } finally {
        if (!cancelled) setLoadingTrack(false);
      }
    };

    void loadTrack();
    return () => {
      cancelled = true;
    };
  }, [selectedSongId, songs]);

  useEffect(() => {
    const handleResize = () => {
      renderSizeRef.current = { width: window.innerWidth, height: window.innerHeight };
      pixelRatioRef.current = window.devicePixelRatio || 1;
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tick = (nowMs: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const { width, height } = renderSizeRef.current;
      const pixelRatio = pixelRatioRef.current;
      const displayWidth = Math.max(1, Math.floor(width));
      const displayHeight = Math.max(1, Math.floor(height));
      const bufferWidth = Math.max(1, Math.floor(displayWidth * pixelRatio));
      const bufferHeight = Math.max(1, Math.floor(displayHeight * pixelRatio));

      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth;
        canvas.height = bufferHeight;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }

      const audio = audioRef.current;
      const currentTime = audio?.currentTime ?? 0;
      const duration = Number.isFinite(audio?.duration) ? audio?.duration ?? 0 : 0;
      const beats = trackData?.accentBeats ?? [];

      if (duration > 0 && Math.abs(duration - durationStateRef.current) > 0.04) {
        durationStateRef.current = duration;
        setDurationSeconds(duration);
      }
      if (Math.abs(currentTime - currentTimeStateRef.current) > 0.05) {
        currentTimeStateRef.current = currentTime;
        setCurrentTimeSeconds(currentTime);
      }

      if (beats.length > 0) {
        const lastTickTime = lastTickTimeRef.current;
        if (currentTime + 0.05 < lastTickTime) {
          beatIndexRef.current = findNextBeatIndex(
            beats,
            Math.max(0, currentTime - runtimeConfig.playgroundBeatLookbackSeconds)
          );
        }
        while (
          beatIndexRef.current < beats.length &&
          beats[beatIndexRef.current].timeSeconds <=
            currentTime + runtimeConfig.playgroundBeatLookaheadSeconds
        ) {
          const beat = beats[beatIndexRef.current];
          const beatStrength = clamp(beat.strength, 0, 1);
          beatPulseRef.current = Math.max(
            beatPulseRef.current,
            0.5 + beatStrength * runtimeConfig.playgroundBeatStrengthBoost
          );
          beatIndexRef.current += 1;
        }
      }

      beatPulseRef.current = Math.max(
        0,
        beatPulseRef.current * runtimeConfig.playgroundBeatPulseDecay
      );
      lastTickTimeRef.current = currentTime;

      renderVisualizer(mode, {
        ctx,
        width: displayWidth,
        height: displayHeight,
        timeSeconds: nowMs / 1000,
        frame: featuresRef.current,
        beatPulse: beatPulseRef.current,
        songProgress: duration > 0 ? clamp(currentTime / duration, 0, 1) : 0,
      });

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [featuresRef, mode, trackData]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
      setSongsPanelOpen(false);
      startAnalyzing();
    };
    const onPause = () => {
      setIsPlaying(false);
      stopAnalyzing();
    };
    const onEnded = () => {
      setIsPlaying(false);
      stopAnalyzing();
      const endedDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      currentTimeStateRef.current = endedDuration;
      setCurrentTimeSeconds(endedDuration);
    };
    const syncFromElement = () => {
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const nextTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      durationStateRef.current = nextDuration;
      currentTimeStateRef.current = nextTime;
      setDurationSeconds(nextDuration);
      setCurrentTimeSeconds(nextTime);
    };
    const onLoadedMetadata = () => {
      syncFromElement();
      beatIndexRef.current = findNextBeatIndex(trackData?.accentBeats ?? [], audio.currentTime || 0);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", syncFromElement);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", syncFromElement);
    audio.addEventListener("canplay", syncFromElement);
    audio.addEventListener("seeked", syncFromElement);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", syncFromElement);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", syncFromElement);
      audio.removeEventListener("canplay", syncFromElement);
      audio.removeEventListener("seeked", syncFromElement);
    };
  }, [trackData, startAnalyzing, stopAnalyzing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    stopAnalyzing();
    setIsPlaying(false);
    audio.currentTime = 0;
    audio.load();
    setCurrentTimeSeconds(0);
    setDurationSeconds(0);
    currentTimeStateRef.current = 0;
    durationStateRef.current = 0;
    beatIndexRef.current = 0;
    beatPulseRef.current = 0;
    lastTickTimeRef.current = 0;
  }, [audioUrl, stopAnalyzing]);

  const handleTogglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (audio.paused) {
        await resumeAudio();
        await audio.play();
        startAnalyzing();
      } else {
        audio.pause();
        stopAnalyzing();
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Playback failed to start.");
    }
  };

  const handleStopPlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    stopAnalyzing();
    audio.currentTime = 0;
    currentTimeStateRef.current = 0;
    setCurrentTimeSeconds(0);
    beatIndexRef.current = 0;
    beatPulseRef.current = 0;
    lastTickTimeRef.current = 0;
  };

  const handleSeek = (nextTimeSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const safe = clamp(nextTimeSeconds, 0, durationSeconds || 0);
    audio.currentTime = safe;
    currentTimeStateRef.current = safe;
    setCurrentTimeSeconds(safe);
    beatIndexRef.current = findNextBeatIndex(trackData?.accentBeats ?? [], safe);
    beatPulseRef.current = 0;
    lastTickTimeRef.current = safe;
  };

  return (
    <section className="playground-shell">
      <canvas ref={canvasRef} className="playground-canvas" />
      <audio ref={bindAudioElement} src={audioUrl} preload="metadata" />

      <header className="playground-overlay">
        <div className="playground-topbar">
          <a className="playground-link" href={homeHref}>
            Back Home
          </a>
          <div className="playground-title-block">
            <p className="playground-kicker">Faceless Playground</p>
            <h1>Realtime Audio Visualizer</h1>
            {selectedSong ? (
              <span className="playground-chip playground-active-song-chip">
                {selectedSong.title} · {trackData?.accentBeats.length ?? 0} saved beats
              </span>
            ) : null}
          </div>
          <div className="playground-mode">
            <label htmlFor="playground-mode-select">Visualizer</label>
            <select
              id="playground-mode-select"
              value={mode}
              onChange={(event) => setMode(event.currentTarget.value as VisualizerMode)}
            >
              {VISUALIZER_MODES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="playground-controls">
          <button type="button" onClick={() => void handleTogglePlayback()} disabled={!audioUrl}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleStopPlayback}
            disabled={!audioUrl}
          >
            Stop
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(durationSeconds, 0)}
            step={0.01}
            value={Math.min(currentTimeSeconds, Math.max(durationSeconds, 0))}
            onInput={(event) => handleSeek(Number.parseFloat(event.currentTarget.value))}
            disabled={!audioUrl || durationSeconds <= 0}
          />
          <span className="playground-time">
            {formatTimeLabel(currentTimeSeconds)} / {formatTimeLabel(durationSeconds)}
          </span>
        </div>

        {songsPanelOpen ? (
          <div className="playground-song-panel">
            <div className="playground-song-panel__header">
              <button
                type="button"
                className="secondary playground-songs-toggle"
                onClick={() => setSongsPanelOpen((previous) => !previous)}
              >
                Collapse Songs
              </button>
            </div>

            <div className="playground-song-strip">
              {loadingSongs ? <span className="playground-chip">Loading songs...</span> : null}
              {!loadingSongs && songs.length === 0 ? (
                <span className="playground-chip">
                  No enabled songs available. Enable songs in Admin Game Builder.
                </span>
              ) : null}
              {songs.map((song) => (
                <button
                  key={song.beatEntryId}
                  type="button"
                  className={`playground-song-card${
                    selectedSongId === song.beatEntryId ? " active" : ""
                  }`}
                  onClick={() => setSelectedSongId(song.beatEntryId)}
                >
                  {song.coverImageUrl ? (
                    <img src={song.coverImageUrl} alt="" aria-hidden="true" />
                  ) : (
                    <div className="playground-song-card__placeholder" />
                  )}
                  <strong>{song.title}</strong>
                  <span>{song.gameBeatCount || song.majorBeatCount} beats</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="secondary playground-songs-toggle"
            onClick={() => setSongsPanelOpen(true)}
          >
            Expand Songs
          </button>
        )}

        <div className="playground-status">
          {loadingTrack ? <span className="playground-chip">Loading song data...</span> : null}
          {loadError ? <span className="playground-chip error">{loadError}</span> : null}
        </div>
      </header>
    </section>
  );
}
