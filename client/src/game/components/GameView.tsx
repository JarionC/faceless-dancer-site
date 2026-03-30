import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CSSProperties } from "preact/compat";
import { runtimeConfig } from "../config/runtime";
import { createPrecisePlaybackEngine, type PrecisePlaybackEngine } from "../lib/audio/precisePlaybackEngine";
import { buildMelodyNotesFromMajorBeats, type GameLane, type MelodyNote } from "../lib/game/melodyChartService";
import type { SavedBeatEntry } from "../types/beat";

interface GameViewProps {
  apiBaseUrl: string;
  canSubmitHolderScore: boolean;
  holderPublicKey?: string;
  homeHref?: string;
  onModeChange?: (mode: ViewMode) => void;
}

interface HybridAnalysisResult {
  majorBeats?: Array<{ timeSeconds: number; strength: number }>;
}

interface EnabledSongSummary {
  beatEntryId: string;
  title: string;
  majorBeatCount: number;
  gameBeatCount: number;
  coverImageUrl: string | null;
}

interface SongLeaderboardRow {
  displayName: string;
  publicKey: string;
  score: number;
}

interface OverallLeaderboardRow {
  displayName: string;
  publicKey: string;
  totalScore: number;
  songsCount: number;
}

type ViewMode = "menu" | "play" | "scores";
type PlayPhase = "idle" | "countdown" | "running" | "finished";
type Judgement = "perfect" | "great" | "good" | "poor" | "miss";

interface GameNoteState extends MelodyNote {
  judged: boolean;
  holdStarted: boolean;
  holding: boolean;
  lastHeldSeconds: number;
}

interface ScoreState {
  combo: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  poor: number;
  miss: number;
}

const laneOrder: GameLane[] = ["left", "down", "up", "right"];
const controlArrowImages: Record<GameLane, string> = {
  left: "/game-graphics/controls/left.png",
  down: "/game-graphics/controls/down.png",
  up: "/game-graphics/controls/up.png",
  right: "/game-graphics/controls/right.png"
};
const beatArrowImages: Record<GameLane, string> = {
  left: "/game-graphics/beats/left.png",
  down: "/game-graphics/beats/down.png",
  up: "/game-graphics/beats/up.png",
  right: "/game-graphics/beats/right.png"
};
const HOLD_MIN_SECONDS = 0.14;
const HOLD_BONUS_POINTS = 120;
const HOLD_BONUS_EASY_RELEASE_SECONDS = 0.5;

function createInitialScore(): ScoreState {
  return { combo: 0, maxCombo: 0, perfect: 0, great: 0, good: 0, poor: 0, miss: 0 };
}

function holderName(publicKey: string | undefined): string {
  const key = String(publicKey ?? "").trim();
  return key.length >= 10 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "Holder";
}

function estimateBeatSeconds(notes: GameNoteState[]): number {
  if (notes.length < 2) return 0.5;
  const sorted = [...notes].sort((a, b) => a.timeSeconds - b.timeSeconds);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const d = sorted[i].timeSeconds - sorted[i - 1].timeSeconds;
    if (Number.isFinite(d) && d >= 0.08 && d <= 1.2) diffs.push(d);
    if (diffs.length >= 24) break;
  }
  if (diffs.length === 0) return 0.5;
  diffs.sort((a, b) => a - b);
  return Math.max(0.35, Math.min(0.85, diffs[Math.floor(diffs.length / 2)]));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...(init ?? {}) });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
}

function classifyJudgement(deltaSeconds: number, windows: { perfect: number; great: number; good: number; poor: number }): Judgement {
  const absDelta = Math.abs(deltaSeconds);
  if (absDelta <= windows.perfect) return "perfect";
  if (absDelta <= windows.great) return "great";
  if (absDelta <= windows.good) return "good";
  if (absDelta <= windows.poor) return "poor";
  return "miss";
}

export function GameView({ apiBaseUrl, canSubmitHolderScore, holderPublicKey, homeHref = "/", onModeChange }: GameViewProps): JSX.Element {
  const engineRef = useRef<PrecisePlaybackEngine | null>(null);
  const loopRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const rolodexRef = useRef<HTMLDivElement | null>(null);
  const rolodexRafRef = useRef<number | null>(null);
  const judgementTimeoutRef = useRef<number | null>(null);
  const notesRef = useRef<GameNoteState[]>([]);
  const heldLanesRef = useRef<Record<GameLane, boolean>>({ left: false, down: false, up: false, right: false });
  const finalizedRef = useRef(false);
  const forfeitedRef = useRef(false);
  const runStartedRef = useRef(false);
  const endSignaledRef = useRef(false);
  const previousTimeRef = useRef(0);

  const [mode, setMode] = useState<ViewMode>("menu");
  const [phase, setPhase] = useState<PlayPhase>("idle");
  const [countdownBeats, setCountdownBeats] = useState(0);

  const [songs, setSongs] = useState<EnabledSongSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<SavedBeatEntry | null>(null);
  const [analysisMajorBeats, setAnalysisMajorBeats] = useState<Array<{ timeSeconds: number; strength: number }> | null>(null);

  const [loadingSongs, setLoadingSongs] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [score, setScore] = useState<ScoreState>(createInitialScore);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [songEndedSignal, setSongEndedSignal] = useState(0);
  const [lastJudgement, setLastJudgement] = useState<Judgement | null>(null);
  const [judgementEventId, setJudgementEventId] = useState(0);
  const [pressedLanes, setPressedLanes] = useState<Record<GameLane, boolean>>({ left: false, down: false, up: false, right: false });
  const [heldLanes, setHeldLanes] = useState<Record<GameLane, boolean>>({ left: false, down: false, up: false, right: false });

  const [songLeaderboard, setSongLeaderboard] = useState<SongLeaderboardRow[]>([]);
  const [overallLeaderboard, setOverallLeaderboard] = useState<OverallLeaderboardRow[]>([]);
  const [holdBonusPoints, setHoldBonusPoints] = useState(0);
  const [chartRevision, setChartRevision] = useState(0);
  const [resultsModal, setResultsModal] = useState<{ visible: boolean; score: number; percentage: number; rank: number | null; message: string }>({ visible: false, score: 0, percentage: 0, rank: null, message: "" });
  const windows = useMemo(() => {
    const perfect = runtimeConfig.gamePerfectWindowSeconds;
    const great = Math.max(perfect, runtimeConfig.gameGreatWindowSeconds);
    const good = Math.max(great, runtimeConfig.gameGoodWindowSeconds);
    const poor = Math.max(good, runtimeConfig.gamePoorWindowSeconds);
    return { perfect, great, good, poor };
  }, []);

  const totalScore = useMemo(() => {
    const value = score.perfect * 1000 + score.great * 700 + score.good * 400 + score.poor * 100 - score.miss * 50 + holdBonusPoints;
    return Math.max(0, value);
  }, [score, holdBonusPoints]);

  const lifePercent = useMemo(() => {
    const life = 50 + score.perfect * 2 + score.great * 1 + score.good * 0.35 - score.poor * 1.5 - score.miss * 3;
    return Math.max(0, Math.min(100, life));
  }, [score]);

  const stopLoop = (): void => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
  };

  const stopCountdown = (): void => {
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdownBeats(0);
  };

  const applyJudgement = (judgement: Judgement): void => {
    if (judgementTimeoutRef.current !== null) window.clearTimeout(judgementTimeoutRef.current);
    setLastJudgement(judgement);
    setJudgementEventId((value) => value + 1);
    judgementTimeoutRef.current = window.setTimeout(() => setLastJudgement(null), 1500);
    setScore((prev) => {
      const next = { ...prev };
      if (judgement === "perfect") next.perfect += 1;
      if (judgement === "great") next.great += 1;
      if (judgement === "good") next.good += 1;
      if (judgement === "poor") next.poor += 1;
      if (judgement === "miss") next.miss += 1;
      if (judgement === "miss") next.combo = 0;
      else {
        next.combo += 1;
        next.maxCombo = Math.max(next.maxCombo, next.combo);
      }
      return next;
    });
  };

  const rebuildChart = (entryOverride?: SavedBeatEntry | null, analysisOverride?: Array<{ timeSeconds: number; strength: number }> | null): void => {
    const entry = entryOverride ?? selectedEntry;
    const analysis = analysisOverride ?? analysisMajorBeats;
    if (!entry) {
      notesRef.current = [];
      return;
    }
    const baseEntry: SavedBeatEntry = entry.gameBeats && entry.gameBeats.length > 0 ? { ...entry, majorBeats: entry.gameBeats } : analysis && analysis.length > 0 ? { ...entry, majorBeats: analysis } : entry;
    notesRef.current = buildMelodyNotesFromMajorBeats(baseEntry).map((note) => ({ ...note, judged: false, holdStarted: false, holding: false, lastHeldSeconds: note.timeSeconds }));
    setScore(createInitialScore());
    setHoldBonusPoints(0);
    setChartRevision((value) => value + 1);
  };

  const tick = (): void => {
    const engine = engineRef.current;
    if (!engine) return;
    const heard = engine.getCurrentHeardTime();
    for (const note of notesRef.current) {
      if (note.judged) continue;
      const isHold = note.type === "hold" && note.endSeconds - note.timeSeconds >= HOLD_MIN_SECONDS;
      if (!isHold && heard - note.timeSeconds > windows.poor) {
        note.judged = true;
        applyJudgement("miss");
        continue;
      }
      if (isHold && !note.holdStarted && heard - note.timeSeconds > windows.poor) {
        note.judged = true;
        applyJudgement("miss");
        continue;
      }
      if (!isHold || !note.holdStarted) continue;
      if (heldLanesRef.current[note.lane]) note.lastHeldSeconds = heard;
      if (heard >= note.endSeconds) {
        note.judged = true;
        const releaseLead = Math.max(0, note.endSeconds - note.lastHeldSeconds);
        if (releaseLead <= HOLD_BONUS_EASY_RELEASE_SECONDS) setHoldBonusPoints((v) => v + HOLD_BONUS_POINTS);
      }
    }
    setCurrentTimeSeconds(heard);
    if (!endSignaledRef.current) {
      const finalNoteSeconds = notesRef.current.reduce((maxSeconds, note) => Math.max(maxSeconds, note.endSeconds), 0);
      if (finalNoteSeconds > 0 && heard >= finalNoteSeconds + 1.5) {
        endSignaledRef.current = true;
        setSongEndedSignal((value) => value + 1);
      }
    }
    if (!engine.isPlaying()) {
      setPlaying(false);
      stopLoop();
    }
  };

  const loadSongs = async (): Promise<void> => {
    setLoadingSongs(true);
    setError(null);
    try {
      const result = await fetchJson<{ songs: EnabledSongSummary[] }>(`${apiBaseUrl}/api/public/songs/enabled`);
      const next = result.songs ?? [];
      setSongs(next);
      if (next.length > 0) setSelectedId((prev) => prev || next[0].beatEntryId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load songs.");
    } finally {
      setLoadingSongs(false);
    }
  };

  const updateSelectedSongFromRolodex = (): void => {
    const container = rolodexRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>(".game-song-card[data-song-id]"));
    if (cards.length === 0) return;
    const centerX = container.scrollLeft + container.clientWidth * 0.5;
    let bestId = selectedId;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const card of cards) {
      const cardCenter = card.offsetLeft + card.offsetWidth * 0.5;
      const distance = Math.abs(cardCenter - centerX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = card.dataset.songId || bestId;
      }
    }
    if (bestId && bestId !== selectedId) {
      setSelectedId(bestId);
    }
  };

  const handleRolodexScroll = (): void => {
    if (rolodexRafRef.current !== null) {
      window.cancelAnimationFrame(rolodexRafRef.current);
    }
    rolodexRafRef.current = window.requestAnimationFrame(() => {
      rolodexRafRef.current = null;
      updateSelectedSongFromRolodex();
    });
  };

  const loadLeaderboards = async (entryId: string): Promise<void> => {
    try {
      const [songData, overallData] = await Promise.all([
        fetchJson<{ leaderboard: SongLeaderboardRow[] }>(`${apiBaseUrl}/api/scores/song/${encodeURIComponent(entryId)}`),
        fetchJson<{ leaderboard: OverallLeaderboardRow[] }>(`${apiBaseUrl}/api/scores/overall`)
      ]);
      setSongLeaderboard(songData.leaderboard ?? []);
      setOverallLeaderboard(overallData.leaderboard ?? []);
    } catch {
      setSongLeaderboard([]);
      setOverallLeaderboard([]);
    }
  };

  const loadSelectedEntry = async (entryId: string): Promise<{ entry: SavedBeatEntry; analysisMajorBeats: Array<{ timeSeconds: number; strength: number }> | null } | null> => {
    const engine = engineRef.current;
    if (!engine) return null;
    setLoadingEntry(true);
    setError(null);
    setPlaying(false);
    stopLoop();
    stopCountdown();
    engine.pause();
    engine.seek(0);
    setCurrentTimeSeconds(0);
    try {
      const detail = await fetchJson<{ ok: boolean; entry: SavedBeatEntry }>(`${apiBaseUrl}/api/public/beats/${encodeURIComponent(entryId)}`);
      const audioResponse = await fetch(`${apiBaseUrl}/api/public/beats/${encodeURIComponent(entryId)}/audio`, { credentials: "include" });
      if (!audioResponse.ok) throw new Error("Failed to load song audio.");
      const audioBytes = await audioResponse.arrayBuffer();
      await engine.loadFromArrayBuffer(audioBytes);
      setDurationSeconds(engine.getDurationSeconds() || detail.entry.entry.durationSeconds);
      setSelectedEntry(detail.entry);
      let loadedAnalysis: Array<{ timeSeconds: number; strength: number }> | null = null;
      try {
        const analysis = await fetchJson<{ ok: boolean; result: HybridAnalysisResult }>(`${apiBaseUrl}/api/public/analyze/${encodeURIComponent(entryId)}/result`);
        const beats = Array.isArray(analysis.result?.majorBeats) ? analysis.result.majorBeats : [];
        loadedAnalysis = beats.length > 0 ? beats : null;
        setAnalysisMajorBeats(loadedAnalysis);
      } catch {
        loadedAnalysis = null;
        setAnalysisMajorBeats(null);
      }
      await loadLeaderboards(entryId);
      return { entry: detail.entry, analysisMajorBeats: loadedAnalysis };
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load selected song.");
      setSelectedEntry(null);
      setAnalysisMajorBeats(null);
      notesRef.current = [];
      return null;
    } finally {
      setLoadingEntry(false);
    }
  };
  const finalizeRun = async (): Promise<void> => {
    if (!selectedEntry || forfeitedRef.current) return;
    const totalNotes = Math.max(1, notesRef.current.length);
    const weighted = score.perfect + score.great * 0.75 + score.good * 0.5 + score.poor * 0.25;
    const percentage = Math.max(0, Math.min(100, (weighted / totalNotes) * 100));
    let rank: number | null = null;
    let message = "";

    if (canSubmitHolderScore) {
      try {
        await fetchJson<{ saved: boolean }>(`${apiBaseUrl}/api/scores/song/${encodeURIComponent(selectedEntry.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: holderName(holderPublicKey),
            score: totalScore,
            maxCombo: score.maxCombo,
            perfect: score.perfect,
            great: score.great,
            good: score.good,
            poor: score.poor,
            miss: score.miss
          })
        });
        const latestSong = await fetchJson<{ leaderboard: SongLeaderboardRow[] }>(`${apiBaseUrl}/api/scores/song/${encodeURIComponent(selectedEntry.id)}`);
        setSongLeaderboard(latestSong.leaderboard ?? []);
        rank = (latestSong.leaderboard ?? []).filter((row) => row.score > totalScore).length + 1;
        message = `Holder rank: #${rank}`;
      } catch {
        message = "Could not submit or rank this run.";
      }
    } else {
      message = "Connect your wallet that holds the Faceless Dancer token so you can rank in the high scores.";
    }

    setPhase("finished");
    setResultsModal({ visible: true, score: totalScore, percentage, rank, message });
  };

  const startAfterCountdown = async (): Promise<void> => {
    const engine = engineRef.current;
    if (!engine || forfeitedRef.current) {
      setPhase("idle");
      return;
    }
    setPhase("running");
    try {
      engine.seek(0);
      await engine.play();
      setPlaying(true);
      runStartedRef.current = true;
      if (loopRef.current === null) loopRef.current = window.setInterval(tick, 16);
    } catch {
      setPlaying(false);
      setPhase("idle");
      setError("Audio start was blocked. Click Start Game again.");
    }
  };

  const startGame = async (): Promise<void> => {
    if (!selectedId) return;
    try {
      await engineRef.current?.unlock();
    } catch {
      // Ignore unlock failures; playback attempt below will surface any issues.
    }
    const loaded = await loadSelectedEntry(selectedId);
    if (!loaded) return;
    forfeitedRef.current = false;
    finalizedRef.current = false;
    runStartedRef.current = false;
    endSignaledRef.current = false;
    previousTimeRef.current = 0;
    setSongEndedSignal(0);
    setResultsModal({ visible: false, score: 0, percentage: 0, rank: null, message: "" });
    rebuildChart(loaded.entry, loaded.analysisMajorBeats);
    let beatsLeft = 3;
    const beatSeconds = estimateBeatSeconds(notesRef.current);
    stopCountdown();
    setCountdownBeats(beatsLeft);
    setPhase("countdown");
    setMode("play");
    countdownRef.current = window.setInterval(() => {
      beatsLeft -= 1;
      if (beatsLeft <= 0) {
        stopCountdown();
        void startAfterCountdown().catch(() => {
          setError("Tap Start Game again to begin playback.");
          setPhase("idle");
        });
        return;
      }
      setCountdownBeats(beatsLeft);
    }, Math.round(beatSeconds * 1000));
  };

  const goToMenu = (): void => {
    forfeitedRef.current = true;
    finalizedRef.current = true;
    runStartedRef.current = false;
    endSignaledRef.current = false;
    const engine = engineRef.current;
    if (engine) {
      engine.pause();
      engine.seek(0);
    }
    stopLoop();
    stopCountdown();
    setPlaying(false);
    setCurrentTimeSeconds(0);
    previousTimeRef.current = 0;
    setSongEndedSignal(0);
    setPhase("idle");
    setResultsModal({ visible: false, score: 0, percentage: 0, rank: null, message: "" });
    setMode("menu");
  };

  const handleLaneInput = (lane: GameLane): void => {
    if (phase !== "running") return;
    heldLanesRef.current = { ...heldLanesRef.current, [lane]: true };
    setHeldLanes((prev) => ({ ...prev, [lane]: true }));
    setPressedLanes((prev) => ({ ...prev, [lane]: true }));
    window.setTimeout(() => setPressedLanes((prev) => ({ ...prev, [lane]: false })), 70);

    const engine = engineRef.current;
    const heardTime = engine ? engine.getCurrentHeardTime() : currentTimeSeconds;
    let candidate: GameNoteState | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const note of notesRef.current) {
      if (note.judged || note.lane !== lane || note.holdStarted) continue;
      const absDelta = Math.abs(heardTime - note.timeSeconds);
      if (absDelta > windows.poor) continue;
      if (absDelta < bestDelta) {
        candidate = note;
        bestDelta = absDelta;
      }
    }
    if (!candidate) {
      applyJudgement("miss");
      return;
    }
    const judgement = classifyJudgement(heardTime - candidate.timeSeconds, windows);
    const isHold = candidate.type === "hold" && candidate.endSeconds - candidate.timeSeconds >= HOLD_MIN_SECONDS;
    if (judgement === "miss") {
      candidate.judged = true;
      applyJudgement("miss");
      return;
    }
    applyJudgement(judgement);
    if (!isHold) {
      candidate.judged = true;
      return;
    }
    candidate.holdStarted = true;
    candidate.holding = true;
    candidate.lastHeldSeconds = heardTime;
  };

  useEffect(() => {
    const engine = createPrecisePlaybackEngine();
    engine.setOnEnded(() => {
      setPlaying(false);
      setCurrentTimeSeconds(engine.getDurationSeconds());
      stopLoop();
      if (!endSignaledRef.current && runStartedRef.current && !finalizedRef.current && !forfeitedRef.current) {
        endSignaledRef.current = true;
        setSongEndedSignal((value) => value + 1);
      }
    });
    engineRef.current = engine;
    return () => {
      stopLoop();
      stopCountdown();
      if (judgementTimeoutRef.current !== null) window.clearTimeout(judgementTimeoutRef.current);
      engine.dispose().catch(() => undefined);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    loadSongs().catch(() => undefined);
  }, []);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  useEffect(() => {
    return () => {
      if (rolodexRafRef.current !== null) {
        window.cancelAnimationFrame(rolodexRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedId || mode !== "scores") return;
    loadLeaderboards(selectedId).catch(() => undefined);
  }, [mode, selectedId]);

  useEffect(() => {
    rebuildChart();
  }, [selectedEntry?.id, analysisMajorBeats?.length]);

  useEffect(() => {
    if (mode !== "play" || phase !== "running") return;
    if (!runStartedRef.current) return;
    if (songEndedSignal === 0) return;
    if (finalizedRef.current || forfeitedRef.current) return;
    finalizedRef.current = true;
    setPlaying(false);
    stopLoop();
    void finalizeRun();
  }, [mode, phase, songEndedSignal]);

  useEffect(() => {
    if (mode !== "play" || phase !== "running" || !runStartedRef.current) {
      previousTimeRef.current = currentTimeSeconds;
      return;
    }
    const previousTime = previousTimeRef.current;
    if (
      !endSignaledRef.current &&
      !finalizedRef.current &&
      !forfeitedRef.current &&
      previousTime >= 0.75 &&
      currentTimeSeconds <= 0.05
    ) {
      endSignaledRef.current = true;
      setSongEndedSignal((value) => value + 1);
    }
    previousTimeRef.current = currentTimeSeconds;
  }, [mode, phase, currentTimeSeconds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (mode !== "play" || phase !== "running" || event.repeat) return;
      if (event.key === "ArrowLeft") { handleLaneInput("left"); event.preventDefault(); }
      if (event.key === "ArrowDown") { handleLaneInput("down"); event.preventDefault(); }
      if (event.key === "ArrowUp") { handleLaneInput("up"); event.preventDefault(); }
      if (event.key === "ArrowRight") { handleLaneInput("right"); event.preventDefault(); }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft") {
        heldLanesRef.current = { ...heldLanesRef.current, left: false };
        setHeldLanes((prev) => ({ ...prev, left: false }));
      }
      if (event.key === "ArrowDown") {
        heldLanesRef.current = { ...heldLanesRef.current, down: false };
        setHeldLanes((prev) => ({ ...prev, down: false }));
      }
      if (event.key === "ArrowUp") {
        heldLanesRef.current = { ...heldLanesRef.current, up: false };
        setHeldLanes((prev) => ({ ...prev, up: false }));
      }
      if (event.key === "ArrowRight") {
        heldLanesRef.current = { ...heldLanesRef.current, right: false };
        setHeldLanes((prev) => ({ ...prev, right: false }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [mode, phase]);

  const visibleNotes = useMemo(() => {
    const startWindow = currentTimeSeconds - windows.poor - 0.05;
    const endWindow = currentTimeSeconds + runtimeConfig.gameApproachSeconds + 0.25;
    return notesRef.current.filter((note) => note.timeSeconds <= endWindow && Math.max(note.timeSeconds, note.endSeconds) >= startWindow);
  }, [chartRevision, currentTimeSeconds, windows.poor]);

  const selectedSongIndex = useMemo(
    () => songs.findIndex((song) => song.beatEntryId === selectedId),
    [songs, selectedId]
  );

  if (mode === "menu") {
    return (
      <section className="game-view-shell">
        <header className="game-ui-header">
          <a className="game-ui-link" href={homeHref}>Back Home</a>
          <h2>Faceless Dance Stage</h2>
          <button type="button" onClick={() => loadSongs()} disabled={loadingSongs}>{loadingSongs ? "Refreshing..." : "Refresh Songs"}</button>
        </header>

        <div className="game-menu-screen">
          <h3>Select Track</h3>
          <div className="game-song-rolodex" ref={rolodexRef} onScroll={handleRolodexScroll}>
            {songs.map((song, index) => {
              const offset = selectedSongIndex < 0 ? 0 : Math.max(-3, Math.min(3, index - selectedSongIndex));
              const distance = Math.abs(offset);
              const cardScale = Math.max(0.78, 1 - distance * 0.06);
              const cardOpacity = Math.max(0.55, 1 - distance * 0.15);
              const cardTilt = offset * -8;
              const cardDepth = Math.max(2, 16 - distance * 5);
              return (
              <button
                key={song.beatEntryId}
                type="button"
                data-song-id={song.beatEntryId}
                className={`game-song-card${selectedId === song.beatEntryId ? " selected" : ""}`}
                style={{
                  "--card-tilt": `${cardTilt}deg`,
                  "--card-scale": String(cardScale),
                  "--card-opacity": String(cardOpacity),
                  "--card-z": `${cardDepth}px`
                } as CSSProperties}
                onClick={() => setSelectedId(song.beatEntryId)}
              >
                {song.coverImageUrl ? (
                  <img className="game-song-card-bg" src={song.coverImageUrl} alt="" draggable={false} />
                ) : null}
                <div className="game-song-card-overlay" />
                <strong>{song.title}</strong>
                <span>{song.gameBeatCount || song.majorBeatCount} notes</span>
              </button>
              );
            })}
          </div>
          {error ? <p className="error">{error}</p> : null}
          {songs.length === 0 && !loadingSongs ? <p>No enabled songs available yet.</p> : null}
          <div className="game-menu-actions">
            <button type="button" disabled={!selectedId || loadingEntry} onClick={() => startGame()}>{loadingEntry ? "Loading Song..." : "Start Game"}</button>
            <button type="button" className="secondary" disabled={!selectedId} onClick={() => setMode("scores")}>View High Scores</button>
          </div>
        </div>
      </section>
    );
  }

  if (mode === "scores") {
    return (
      <section className="game-view-shell">
        <header className="game-ui-header">
          <a className="game-ui-link" href={homeHref}>Back Home</a>
          <h2>High Scores</h2>
          <button type="button" className="secondary" onClick={() => setMode("menu")}>Back To Game Menu</button>
        </header>
        <div className="game-scores-screen">
          <section className="game-score-panel">
            <h3>Song High Scores</h3>
            {songLeaderboard.length === 0 ? <p>No scores yet for this track.</p> : (
              <ol>
                {songLeaderboard.slice(0, 20).map((row) => (
                  <li key={`${row.publicKey}-${row.displayName}`}><span>{row.displayName}</span><strong>{row.score}</strong></li>
                ))}
              </ol>
            )}
          </section>
          <section className="game-score-panel">
            <h3>Overall High Scores</h3>
            {overallLeaderboard.length === 0 ? <p>No overall scores yet.</p> : (
              <ol>
                {overallLeaderboard.slice(0, 20).map((row) => (
                  <li key={`${row.publicKey}-${row.displayName}`}><span>{row.displayName}</span><strong>{row.totalScore}</strong></li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="game-view-shell game-mode-active">
      <header className="game-ui-header">
        <button type="button" className="secondary" onClick={() => goToMenu()}>Exit To Menu</button>
        <h2>{songs.find((song) => song.beatEntryId === selectedId)?.title ?? "Gameplay"}</h2>
        <div className="game-top-status">{phase === "finished" ? "Song Complete" : phase === "running" ? "Running" : ""}</div>
      </header>

      <div className="ddr-hud">
        <div className="ddr-life"><span>LIFE</span><div className="ddr-life-bar"><div className="ddr-life-fill" style={{ width: `${lifePercent}%` }} /></div></div>
        <div className="ddr-score-stack"><span className="ddr-score-label">SCORE</span><strong>{totalScore}</strong></div>
        <div className="ddr-score-stack"><span className="ddr-score-label">COMBO</span><strong>{score.combo}</strong></div>
        <div className="ddr-score-stack"><span className="ddr-score-label">HOLD BONUS</span><strong>{holdBonusPoints}</strong></div>
        <div className="ddr-progress"><div className="ddr-progress-fill" style={{ width: `${durationSeconds > 0 ? (currentTimeSeconds / durationSeconds) * 100 : 0}%` }} /><span>{currentTimeSeconds.toFixed(1)} / {durationSeconds.toFixed(1)}</span></div>
      </div>

      <div className="ddr-field">
        <div className="ddr-lanes">
          {laneOrder.map((lane) => (
            <div key={lane} className={`ddr-lane lane-${lane}`}>
              {visibleNotes.filter((note) => note.lane === lane).map((note) => {
                const timeUntilHit = note.timeSeconds - currentTimeSeconds;
                const progress = 1 - timeUntilHit / Math.max(0.05, runtimeConfig.gameApproachSeconds);
                const topPercent = 92 - progress * 87;
                const isHold = note.type === "hold" && note.endSeconds - note.timeSeconds >= HOLD_MIN_SECONDS;
                const tailSeconds = Math.max(0, note.endSeconds - note.timeSeconds);
                const holdHeightPx = Math.max(58, (tailSeconds / Math.max(0.05, runtimeConfig.gameApproachSeconds)) * 240);
                return (
                  <div key={note.id} className={`ddr-note lane-${note.lane}${note.judged ? " judged" : ""}${note.holdStarted && !note.judged ? " holding" : ""}${isHold ? " hold-note" : ""}`} style={{ top: `${topPercent}%`, ...(isHold ? { height: `${holdHeightPx}px` } : null) } as CSSProperties}>
                    <img className={`ddr-arrow-graphic beat ${isHold ? "top-cap" : "single"}`} src={beatArrowImages[note.lane]} alt="" draggable={false} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="ddr-step-zone">
          {laneOrder.map((lane) => (
            <button key={lane} type="button" disabled={phase !== "running"} className={`ddr-receptor lane-${lane}${pressedLanes[lane] ? " pressed" : ""}${heldLanes[lane] ? " held" : ""}`} onMouseDown={() => handleLaneInput(lane)} onTouchStart={() => handleLaneInput(lane)}>
              <img className="ddr-arrow-graphic control" src={controlArrowImages[lane]} alt="" draggable={false} />
            </button>
          ))}
        </div>

        {lastJudgement ? (
          <div key={`${lastJudgement}-${judgementEventId}`} className={`ddr-judge-popup ${lastJudgement}`}>
            {lastJudgement.toUpperCase()}
          </div>
        ) : null}
        {score.combo > 1 ? <div className="ddr-combo-popup">{score.combo} COMBO</div> : null}
        {phase === "countdown" && countdownBeats > 0 ? <div className="game-countdown-overlay">{countdownBeats}</div> : null}

        {resultsModal.visible ? (
          <div className="game-results-modal" role="dialog" aria-modal="true">
            <h3>Song Complete</h3>
            <p className="result-line">Score: <strong>{resultsModal.score}</strong></p>
            <p className="result-line">Accuracy: <strong>{resultsModal.percentage.toFixed(2)}%</strong></p>
            {canSubmitHolderScore && resultsModal.rank ? <p className="result-line">Rank: <strong>#{resultsModal.rank}</strong></p> : null}
            <p className="small">{resultsModal.message}</p>
            <button type="button" onClick={() => goToMenu()}>Back To Menu</button>
          </div>
        ) : null}
      </div>

      <section className="ddr-footer">
        <div className="ddr-footer-judgement">
          <span>Perfect {score.perfect}</span>
          <span>Great {score.great}</span>
          <span>Good {score.good}</span>
          <span>Poor {score.poor}</span>
          <span>Miss {score.miss}</span>
        </div>
      </section>
    </section>
  );
}
