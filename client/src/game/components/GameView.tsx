import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CSSProperties } from "preact/compat";
import { runtimeConfig } from "../config/runtime";
import gameTitleImage from "../../assets/game/game-title.png";
import { createPrecisePlaybackEngine, type PrecisePlaybackEngine } from "../lib/audio/precisePlaybackEngine";
import {
  buildFallbackEntryFromBeats,
  buildGameNotesFromEntry,
  type GameLane,
  type MelodyNote,
  type OrbBeatLane,
  type StepArrowLane,
} from "../lib/game/melodyChartService";
import type { SavedBeatEntry } from "../types/beat";
import {
  GAME_DIFFICULTIES,
  GAME_MODES,
  type GameDifficulty,
  type GameMode,
  getModeDifficultyChart,
} from "../lib/game/difficultyCharts";

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
  availableGameModes: GameMode[];
  availableDifficulties: GameDifficulty[];
  difficultyBeatCounts: Partial<Record<GameDifficulty, number>>;
  modeDifficultyBeatCounts: Partial<Record<GameMode, Partial<Record<GameDifficulty, number>>>>;
}

interface SongLeaderboardRow {
  displayName: string;
  publicKey: string;
  gameMode: GameMode;
  difficulty: GameDifficulty;
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

function createLaneState(): Record<GameLane, boolean> {
  return {
    left: false,
    down: false,
    up: false,
    right: false,
    l1: false,
    l2: false,
    l3: false,
    r1: false,
    r2: false,
    r3: false
  };
}

const stepArrowLaneOrder: StepArrowLane[] = ["left", "down", "up", "right"];
const orbBeatLaneOrder: OrbBeatLane[] = ["l1", "l2", "l3", "r1", "r2", "r3"];
const controlArrowImages: Record<StepArrowLane, string> = {
  left: "/game-graphics/controls/left.png",
  down: "/game-graphics/controls/down.png",
  up: "/game-graphics/controls/up.png",
  right: "/game-graphics/controls/right.png"
};
const beatArrowImages: Record<StepArrowLane, string> = {
  left: "/game-graphics/beats/left.png",
  down: "/game-graphics/beats/down.png",
  up: "/game-graphics/beats/up.png",
  right: "/game-graphics/beats/right.png"
};
const orbControlLabels: Record<OrbBeatLane, string> = {
  l1: "L1",
  l2: "L2",
  l3: "L3",
  r1: "R1",
  r2: "R2",
  r3: "R3"
};

function formatGameModeLabel(gameMode: GameMode): string {
  return gameMode === "orb_beat" ? "Orb Beat" : "Step Arrows";
}
const HOLD_MIN_SECONDS = 0.14;
const HOLD_BONUS_POINTS = 120;
const HOLD_BONUS_EASY_RELEASE_SECONDS = 0.5;
const MENU_PREVIEW_SAMPLE_SECONDS = 15;
const MENU_PREVIEW_FADE_SECONDS = 1.2;
const MENU_PREVIEW_MAX_VOLUME = 0.5;
const MENU_PREVIEW_SWITCH_FADE_OUT_MS = 90;
const MENU_PREVIEW_METADATA_WAIT_MS = 50;

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
  const menuPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const menuPreviewLoopRef = useRef<number | null>(null);
  const menuPreviewTokenRef = useRef(0);
  const menuPreviewEntryIdRef = useRef("");
  const selectedIdRef = useRef("");
  const judgementTimeoutRef = useRef<number | null>(null);
  const notesRef = useRef<GameNoteState[]>([]);
  const heldLanesRef = useRef<Record<GameLane, boolean>>(createLaneState());
  const lastTouchInputAtRef = useRef(0);
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
  const [selectedGameMode, setSelectedGameMode] = useState<GameMode>("step_arrows");
  const [selectedDifficulty, setSelectedDifficulty] = useState<GameDifficulty>("normal");
  const [isLandscape, setIsLandscape] = useState(false);

  const [loadingSongs, setLoadingSongs] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [menuAudioEnabled, setMenuAudioEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [score, setScore] = useState<ScoreState>(createInitialScore);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [songEndedSignal, setSongEndedSignal] = useState(0);
  const [lastJudgement, setLastJudgement] = useState<Judgement | null>(null);
  const [judgementEventId, setJudgementEventId] = useState(0);
  const [pressedLanes, setPressedLanes] = useState<Record<GameLane, boolean>>(createLaneState);
  const [heldLanes, setHeldLanes] = useState<Record<GameLane, boolean>>(createLaneState);

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

  const rebuildChart = (
    entryOverride?: SavedBeatEntry | null,
    analysisOverride?: Array<{ timeSeconds: number; strength: number }> | null,
    gameModeOverride?: GameMode,
    difficultyOverride?: GameDifficulty
  ): void => {
    const entry = entryOverride ?? selectedEntry;
    const analysis = analysisOverride ?? analysisMajorBeats;
    const gameMode = gameModeOverride ?? selectedGameMode;
    const difficulty = difficultyOverride ?? selectedDifficulty;
    if (!entry) {
      notesRef.current = [];
      return;
    }
    const chart = getModeDifficultyChart(entry, gameMode, difficulty);
    const chartedEntry: SavedBeatEntry =
      chart
        ? {
            ...entry,
            gameBeats: chart.gameBeats ?? [],
            gameNotes: chart.gameNotes ?? [],
            gameBeatSelections: chart.gameBeatSelections ?? [],
            gameBeatConfig: { ...(chart.gameBeatConfig ?? {}), gameMode }
          }
        : entry;
    const baseEntry: SavedBeatEntry =
      chart && (chart.gameBeats?.length ?? 0) > 0
        ? buildFallbackEntryFromBeats(chartedEntry, chart.gameBeats ?? [], gameMode)
        : analysis && analysis.length > 0 && gameMode === "step_arrows" && difficulty === "normal"
          ? buildFallbackEntryFromBeats(chartedEntry, analysis, gameMode)
          : chartedEntry;
    notesRef.current = buildGameNotesFromEntry(baseEntry, gameMode).map((note) => ({
      ...note,
      judged: false,
      holdStarted: false,
      holding: false,
      lastHeldSeconds: note.timeSeconds
    }));
    setScore(createInitialScore());
    setHoldBonusPoints(0);
    setChartRevision((value) => value + 1);
    heldLanesRef.current = createLaneState();
    setHeldLanes(createLaneState());
    setPressedLanes(createLaneState());
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

  const clearMenuPreviewLoop = (): void => {
    if (menuPreviewLoopRef.current !== null) {
      window.clearInterval(menuPreviewLoopRef.current);
      menuPreviewLoopRef.current = null;
    }
  };

  const previewLog = (_action: string, _details?: Record<string, unknown>): void => {};

  const fadeAudioVolume = async (audio: HTMLAudioElement, target: number, durationMs: number): Promise<void> =>
    new Promise((resolve) => {
      const startVolume = Number.isFinite(audio.volume) ? audio.volume : 0;
      const clampedTarget = Math.max(0, Math.min(1, target));
      const startAt = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - startAt) / Math.max(1, durationMs));
        audio.volume = startVolume + (clampedTarget - startVolume) * progress;
        if (progress < 1) {
          window.requestAnimationFrame(step);
          return;
        }
        resolve();
      };
      window.requestAnimationFrame(step);
    });

  const stopMenuPreview = async (): Promise<void> => {
    previewLog("stop-begin");
    clearMenuPreviewLoop();
    const audio = menuPreviewAudioRef.current;
    if (!audio) return;
    const token = ++menuPreviewTokenRef.current;
    previewLog("stop-token", { token, paused: audio.paused, currentTime: audio.currentTime, volume: audio.volume });
    if (!audio.paused) {
      await fadeAudioVolume(audio, 0, 180).catch(() => undefined);
      previewLog("stop-fade-complete", { token, currentTime: audio.currentTime, volume: audio.volume });
    }
    if (token !== menuPreviewTokenRef.current) return;
    audio.pause();
    audio.currentTime = 0;
    menuPreviewEntryIdRef.current = "";
    previewLog("stop-complete", { token });
  };

  const startMenuPreview = async (entryId: string): Promise<void> => {
    previewLog("start-request", { entryId });
    if (!entryId) return;
    if (!menuAudioEnabled) {
      previewLog("start-skipped-audio-disabled", { entryId });
      return;
    }
    const token = ++menuPreviewTokenRef.current;
    previewLog("start-token", { token, entryId });
    clearMenuPreviewLoop();
    let audio = menuPreviewAudioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "metadata";
      audio.playsInline = true;
      audio.loop = true;
      const events: Array<keyof HTMLMediaElementEventMap> = [
        "loadstart",
        "loadedmetadata",
        "loadeddata",
        "canplay",
        "canplaythrough",
        "play",
        "playing",
        "pause",
        "waiting",
        "stalled",
        "suspend",
        "seeking",
        "seeked",
        "timeupdate",
        "progress",
        "durationchange",
        "ended",
        "emptied",
        "abort",
        "error"
      ];
      for (const eventName of events) {
        audio.addEventListener(eventName, () => {
          previewLog(`audio-event:${eventName}`, {
            token: menuPreviewTokenRef.current,
            src: audio?.src,
            readyState: audio?.readyState,
            networkState: audio?.networkState,
            currentTime: audio?.currentTime,
            duration: audio?.duration,
            paused: audio?.paused,
            volume: audio?.volume,
            muted: audio?.muted,
            errorCode: audio?.error?.code ?? null
          });
        });
      }
      menuPreviewAudioRef.current = audio;
      previewLog("audio-created");
    }

    if (menuPreviewEntryIdRef.current === entryId && !audio.paused) {
      previewLog("start-skip-already-playing", { token, entryId, currentTime: audio.currentTime });
      return;
    }

    if (!audio.paused) {
      previewLog("start-fade-out-current", { token, currentEntry: menuPreviewEntryIdRef.current, currentTime: audio.currentTime });
      await fadeAudioVolume(audio, 0, MENU_PREVIEW_SWITCH_FADE_OUT_MS).catch(() => undefined);
      if (token !== menuPreviewTokenRef.current) return;
      audio.pause();
      previewLog("start-fade-out-complete", { token, currentTime: audio.currentTime });
    }

    const previewSrc = `${apiBaseUrl}/api/public/beats/${encodeURIComponent(entryId)}/preview`;
    const fallbackSrc = `${apiBaseUrl}/api/public/beats/${encodeURIComponent(entryId)}/audio`;
    const nextSrc = previewSrc;
    const isNewSource = menuPreviewEntryIdRef.current !== entryId || audio.src !== nextSrc;
    previewLog("start-source-check", {
      token,
      entryId,
      nextSrc,
      currentSrc: audio.src,
      currentEntry: menuPreviewEntryIdRef.current,
      isNewSource
    });
    if (isNewSource) {
      audio.src = nextSrc;
      audio.currentTime = 0;
      audio.volume = 0;
      audio.loop = true;
      menuPreviewEntryIdRef.current = entryId;
      audio.load();
      previewLog("start-source-loaded", { token, entryId, src: nextSrc });
    }
    if (token !== menuPreviewTokenRef.current || mode !== "menu" || selectedIdRef.current !== entryId) {
      previewLog("start-abort-after-source", {
        token,
        activeToken: menuPreviewTokenRef.current,
        selectedRef: selectedIdRef.current,
        entryId,
        mode
      });
      return;
    }

    audio.muted = true;
    previewLog("start-play-attempt", {
      token,
      entryId,
      currentTime: audio.currentTime,
      readyState: audio.readyState,
      networkState: audio.networkState
    });
    try {
      await audio.play();
    } catch {
      if (audio.src === previewSrc) {
        previewLog("start-preview-fallback-audio", { token, entryId, previewSrc, fallbackSrc });
        audio.src = fallbackSrc;
        audio.currentTime = 0;
        audio.volume = 0;
        audio.load();
        try {
          await audio.play();
        } catch {
          previewLog("start-fallback-play-failed", {
            token,
            entryId,
            readyState: audio.readyState,
            networkState: audio.networkState,
            errorCode: audio.error?.code ?? null
          });
          return;
        }
      } else {
      previewLog("start-play-failed", {
        token,
        entryId,
        readyState: audio.readyState,
        networkState: audio.networkState,
        errorCode: audio.error?.code ?? null
      });
      return;
      }
    }
    if (token !== menuPreviewTokenRef.current || mode !== "menu" || selectedIdRef.current !== entryId) {
      previewLog("start-abort-after-play", {
        token,
        activeToken: menuPreviewTokenRef.current,
        selectedRef: selectedIdRef.current,
        entryId,
        mode
      });
      return;
    }
    audio.muted = false;
    previewLog("start-play-success", {
      token,
      entryId,
      currentTime: audio.currentTime,
      readyState: audio.readyState,
      networkState: audio.networkState
    });

    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      previewLog("start-wait-metadata", { token, entryId, duration: audio.duration });
      await Promise.race([
        new Promise<void>((resolve) => {
          const complete = () => {
            audio?.removeEventListener("loadedmetadata", complete);
            resolve();
          };
          audio.addEventListener("loadedmetadata", complete, { once: true });
        }),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, MENU_PREVIEW_METADATA_WAIT_MS);
        })
      ]);
      previewLog("start-wait-metadata-complete", { token, entryId, duration: audio.duration });
    }
    if (token !== menuPreviewTokenRef.current || mode !== "menu" || selectedIdRef.current !== entryId) {
      previewLog("start-abort-after-metadata", {
        token,
        activeToken: menuPreviewTokenRef.current,
        selectedRef: selectedIdRef.current,
        entryId,
        mode
      });
      return;
    }

    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const segmentLength = Math.max(4, Math.min(MENU_PREVIEW_SAMPLE_SECONDS, duration > 0 ? duration : MENU_PREVIEW_SAMPLE_SECONDS));
    const segmentStart =
      duration > segmentLength
        ? Math.min(runtimeConfig.menuPreviewStartSeconds, Math.max(0, duration - segmentLength))
        : 0;
    const segmentEnd = duration > 0 ? Math.max(segmentStart + 0.5, Math.min(duration, segmentStart + segmentLength)) : segmentStart + segmentLength;
    previewLog("start-segment-computed", { token, duration, segmentLength, segmentStart, segmentEnd });
    try {
      if (segmentStart > 0 && audio.readyState >= 2) {
        audio.currentTime = segmentStart;
        previewLog("start-seek-applied", { token, segmentStart, currentTime: audio.currentTime });
      } else if (segmentStart <= 0) {
        audio.currentTime = 0;
        previewLog("start-seek-zero", { token, currentTime: audio.currentTime });
      }
    } catch {
      previewLog("start-seek-failed", { token, readyState: audio.readyState, currentTime: audio.currentTime });
    }

    menuPreviewLoopRef.current = window.setInterval(() => {
      const currentAudio = menuPreviewAudioRef.current;
      if (!currentAudio) return;
      if (menuPreviewTokenRef.current !== token || mode !== "menu" || selectedIdRef.current !== entryId) {
        previewLog("loop-skip-token-or-selection", {
          token,
          activeToken: menuPreviewTokenRef.current,
          selectedRef: selectedIdRef.current,
          entryId,
          mode
        });
        return;
      }
      let current = currentAudio.currentTime;
      const segmentDuration = Math.max(0.001, segmentEnd - segmentStart);
      const fadeSeconds = Math.min(MENU_PREVIEW_FADE_SECONDS, segmentDuration * 0.35);
      if (segmentStart > 0 && current < segmentStart - 0.1) {
        const previous = current;
        try {
          currentAudio.currentTime = segmentStart;
          current = currentAudio.currentTime;
          previewLog("loop-correct-prestart", { token, from: previous, to: segmentStart });
        } catch {
          previewLog("loop-correct-prestart-failed", { token, from: previous, to: segmentStart });
        }
      }
      const segmentPosition = Math.max(0, Math.min(segmentDuration, current - segmentStart));
      const fadeInEnd = fadeSeconds;
      const fadeOutStart = segmentDuration - fadeSeconds;
      let volume = MENU_PREVIEW_MAX_VOLUME;
      if (current >= segmentStart) {
        if (segmentPosition <= fadeInEnd) {
          volume = MENU_PREVIEW_MAX_VOLUME * Math.max(0, segmentPosition / Math.max(0.001, fadeSeconds));
        } else if (segmentPosition >= fadeOutStart) {
          volume =
            MENU_PREVIEW_MAX_VOLUME *
            Math.max(0, (segmentDuration - segmentPosition) / Math.max(0.001, fadeSeconds));
        }
      }
      currentAudio.volume = Math.max(0, Math.min(MENU_PREVIEW_MAX_VOLUME, volume));
      previewLog("loop-tick", {
        token,
        current,
        segmentPosition,
        segmentStart,
        segmentEnd,
        fadeInEnd,
        fadeOutStart,
        volume: currentAudio.volume,
        paused: currentAudio.paused,
        readyState: currentAudio.readyState,
        networkState: currentAudio.networkState
      });
    }, 60);
    previewLog("loop-started", { token, intervalMs: 60 });
  };

  const updateSelectedSongFromRolodex = (): void => {
    const container = rolodexRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>(".game-song-card[data-song-id]"));
    if (cards.length === 0) return;
    const centerY = container.scrollTop + container.clientHeight * 0.5;
    let bestId = selectedId;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const card of cards) {
      const cardCenter = card.offsetTop + card.offsetHeight * 0.5;
      const distance = Math.abs(cardCenter - centerY);
      const normalized = Math.max(-1.25, Math.min(1.25, (cardCenter - centerY) / (container.clientHeight * 0.5)));
      const distanceNorm = Math.min(1, Math.abs(normalized));
      const rotateX = normalized * -48;
      const rotateY = normalized * -10;
      const depth = 72 - distanceNorm * 112;
      const lift = normalized * 24;
      const scale = 1 - distanceNorm * 0.18;
      const opacity = 1 - distanceNorm * 0.58;
      const saturation = 1.18 - distanceNorm * 0.34;
      const brightness = 1.08 - distanceNorm * 0.26;
      card.style.setProperty("--card-rotate-x", `${rotateX.toFixed(2)}deg`);
      card.style.setProperty("--card-rotate-y", `${rotateY.toFixed(2)}deg`);
      card.style.setProperty("--card-z", `${depth.toFixed(2)}px`);
      card.style.setProperty("--card-shift-y", `${lift.toFixed(2)}px`);
      card.style.setProperty("--card-scale", scale.toFixed(3));
      card.style.setProperty("--card-opacity", opacity.toFixed(3));
      card.style.setProperty("--card-saturation", saturation.toFixed(3));
      card.style.setProperty("--card-brightness", brightness.toFixed(3));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = card.dataset.songId || bestId;
      }
    }
    if (bestId && bestId !== selectedId) {
      previewLog("selection-from-scroll", { previousSelectedId: selectedId, nextSelectedId: bestId });
      setSelectedId(bestId);
      if (mode === "menu") {
        void startMenuPreview(bestId);
      }
    }
  };

  const handleRolodexScroll = (): void => {
    updateSelectedSongFromRolodex();
    if (rolodexRafRef.current !== null) {
      window.cancelAnimationFrame(rolodexRafRef.current);
    }
    rolodexRafRef.current = window.requestAnimationFrame(() => {
      rolodexRafRef.current = null;
      updateSelectedSongFromRolodex();
    });
  };

  const focusSongCard = (songId: string, smooth = false): void => {
    setSelectedId(songId);
    const container = rolodexRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>(".game-song-card[data-song-id]"));
    const card = cards.find((item) => item.dataset.songId === songId);
    if (!card) return;
    const targetScrollTop = card.offsetTop - (container.clientHeight - card.offsetHeight) * 0.5;
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: smooth ? "smooth" : "auto"
    });
    handleRolodexScroll();
  };

  const loadLeaderboards = async (
    entryId: string,
    gameMode: GameMode,
    difficulty: GameDifficulty
  ): Promise<void> => {
    try {
      const [songData, overallData] = await Promise.all([
        fetchJson<{ leaderboard: SongLeaderboardRow[] }>(
          `${apiBaseUrl}/api/scores/song/${encodeURIComponent(entryId)}?gameMode=${encodeURIComponent(gameMode)}&difficulty=${encodeURIComponent(difficulty)}`
        ),
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
      await loadLeaderboards(entryId, selectedGameMode, selectedDifficulty);
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
            gameMode: selectedGameMode,
            difficulty: selectedDifficulty,
            score: totalScore,
            maxCombo: score.maxCombo,
            perfect: score.perfect,
            great: score.great,
            good: score.good,
            poor: score.poor,
            miss: score.miss
          })
        });
        const latestSong = await fetchJson<{ leaderboard: SongLeaderboardRow[] }>(
          `${apiBaseUrl}/api/scores/song/${encodeURIComponent(selectedEntry.id)}?gameMode=${encodeURIComponent(selectedGameMode)}&difficulty=${encodeURIComponent(selectedDifficulty)}`
        );
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
    rebuildChart(loaded.entry, loaded.analysisMajorBeats, selectedGameMode, selectedDifficulty);
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

  const releaseLane = (lane: GameLane): void => {
    heldLanesRef.current = { ...heldLanesRef.current, [lane]: false };
    setHeldLanes((prev) => ({ ...prev, [lane]: false }));
  };

  const handleLaneTouchStart = (event: Event, lane: GameLane): void => {
    event.preventDefault();
    lastTouchInputAtRef.current = performance.now();
    handleLaneInput(lane);
  };

  const handleLaneMouseDown = (lane: GameLane): void => {
    // Mobile browsers can emit a synthetic mouse event after touch.
    // Ignore that duplicate so a single tap cannot score then immediately miss.
    if (performance.now() - lastTouchInputAtRef.current < 700) {
      return;
    }
    handleLaneInput(lane);
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
    const syncOrientation = (): void => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    syncOrientation();
    window.addEventListener("resize", syncOrientation);
    window.addEventListener("orientationchange", syncOrientation);
    return () => {
      window.removeEventListener("resize", syncOrientation);
      window.removeEventListener("orientationchange", syncOrientation);
    };
  }, []);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    return () => {
      if (rolodexRafRef.current !== null) {
        window.cancelAnimationFrame(rolodexRafRef.current);
      }
      clearMenuPreviewLoop();
      const audio = menuPreviewAudioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      menuPreviewEntryIdRef.current = "";
    };
  }, []);

  useEffect(() => {
    if (mode !== "menu" || songs.length === 0) return;
    const rafId = window.requestAnimationFrame(() => {
      const focusId = selectedId && songs.some((song) => song.beatEntryId === selectedId)
        ? selectedId
        : songs[0].beatEntryId;
      focusSongCard(focusId, false);
    });
    const onResize = () => handleRolodexScroll();
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, [mode, songs.length]);

  useEffect(() => {
    if (!selectedId || mode !== "scores") return;
    loadLeaderboards(selectedId, selectedGameMode, selectedDifficulty).catch(() => undefined);
  }, [mode, selectedDifficulty, selectedGameMode, selectedId]);

  useEffect(() => {
    if (mode !== "menu") {
      previewLog("effect-mode-not-menu-stop");
      void stopMenuPreview();
      return;
    }
    const entryId = selectedId || songs[0]?.beatEntryId || "";
    previewLog("effect-menu-selection", { entryId, selectedId, songsCount: songs.length });
    if (!entryId) return;
    if (!selectedId) {
      previewLog("effect-auto-select-first-song", { entryId });
      setSelectedId(entryId);
    }
    if (menuAudioEnabled) {
      previewLog("effect-start-preview", { entryId });
      void startMenuPreview(entryId);
    } else {
      previewLog("effect-preview-skipped-audio-disabled", { entryId });
    }
  }, [mode, selectedId, songs, menuAudioEnabled]);

  useEffect(() => {
    rebuildChart();
  }, [selectedDifficulty, selectedGameMode, selectedEntry?.id, analysisMajorBeats?.length]);

  const selectedSongSummary = useMemo(
    () => songs.find((song) => song.beatEntryId === selectedId) ?? null,
    [selectedId, songs]
  );

  useEffect(() => {
    if (!selectedSongSummary) {
      return;
    }
    const availableModes = selectedSongSummary.availableGameModes ?? [];
    if (availableModes.length === 0) {
      setSelectedGameMode("step_arrows");
      setSelectedDifficulty("normal");
      return;
    }
    if (!availableModes.includes(selectedGameMode)) {
      setSelectedGameMode(availableModes.includes("step_arrows") ? "step_arrows" : availableModes[0]);
      return;
    }
    const availableDifficulties = Object.keys(
      selectedSongSummary.modeDifficultyBeatCounts?.[selectedGameMode] ?? {}
    ) as GameDifficulty[];
    if (availableDifficulties.length === 0) {
      setSelectedDifficulty("normal");
      return;
    }
    if (!availableDifficulties.includes(selectedDifficulty)) {
      setSelectedDifficulty(
        availableDifficulties.includes("normal") ? "normal" : availableDifficulties[0]
      );
    }
  }, [selectedDifficulty, selectedGameMode, selectedSongSummary]);

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
      if (selectedGameMode === "orb_beat") {
        if (event.key === "7") { handleLaneInput("l1"); event.preventDefault(); }
        if (event.key === "4") { handleLaneInput("l2"); event.preventDefault(); }
        if (event.key === "1") { handleLaneInput("l3"); event.preventDefault(); }
        if (event.key === "9") { handleLaneInput("r1"); event.preventDefault(); }
        if (event.key === "6") { handleLaneInput("r2"); event.preventDefault(); }
        if (event.key === "3") { handleLaneInput("r3"); event.preventDefault(); }
        return;
      }
      if (event.key === "ArrowLeft") { handleLaneInput("left"); event.preventDefault(); }
      if (event.key === "ArrowDown") { handleLaneInput("down"); event.preventDefault(); }
      if (event.key === "ArrowUp") { handleLaneInput("up"); event.preventDefault(); }
      if (event.key === "ArrowRight") { handleLaneInput("right"); event.preventDefault(); }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (selectedGameMode === "orb_beat") {
        if (event.key === "7") releaseLane("l1");
        if (event.key === "4") releaseLane("l2");
        if (event.key === "1") releaseLane("l3");
        if (event.key === "9") releaseLane("r1");
        if (event.key === "6") releaseLane("r2");
        if (event.key === "3") releaseLane("r3");
        return;
      }
      if (event.key === "ArrowLeft") {
        releaseLane("left");
      }
      if (event.key === "ArrowDown") {
        releaseLane("down");
      }
      if (event.key === "ArrowUp") {
        releaseLane("up");
      }
      if (event.key === "ArrowRight") {
        releaseLane("right");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [mode, phase, selectedGameMode]);

  const visibleNotes = useMemo(() => {
    const startWindow = currentTimeSeconds - windows.poor - 0.05;
    const endWindow = currentTimeSeconds + runtimeConfig.gameApproachSeconds + 0.25;
    return notesRef.current.filter((note) => note.timeSeconds <= endWindow && Math.max(note.timeSeconds, note.endSeconds) >= startWindow);
  }, [chartRevision, currentTimeSeconds, windows.poor]);

  const activeLanes = selectedGameMode === "orb_beat" ? orbBeatLaneOrder : stepArrowLaneOrder;
  const enableMenuAudio = (): void => {
    previewLog("audio-enable-clicked", { alreadyEnabled: menuAudioEnabled });
    if (menuAudioEnabled) return;
    setMenuAudioEnabled(true);
    const entryId = selectedId || songs[0]?.beatEntryId || "";
    previewLog("audio-enable-after-set", { entryId });
    if (entryId) {
      void startMenuPreview(entryId);
    }
  };

  if (mode === "menu") {
    return (
      <section className="game-view-shell game-view-shell--menu">
        <header className="game-ui-header">
          <a className="game-ui-link" href={homeHref}>Back Home</a>
          <h2 className="game-menu-title">
            <img src={gameTitleImage} alt="Faceless Dance Stage" draggable={false} />
          </h2>
          <button type="button" onClick={() => loadSongs()} disabled={loadingSongs}>{loadingSongs ? "Refreshing..." : "Refresh Songs"}</button>
        </header>

        <div className="game-menu-screen game-menu-screen--arc">
          <div className="game-menu-heading">
            <h3>Select Your Beat</h3>
            <button
              type="button"
              className={`game-menu-audio-toggle${menuAudioEnabled ? " enabled" : " secondary"}`}
              onClick={enableMenuAudio}
            >
              {menuAudioEnabled ? "Audio Enabled" : "Enable Audio"}
            </button>
          </div>

          <div className="game-menu-arc-layout">
            <div className="game-menu-arc-stage">
              <div className="game-song-rolodex" ref={rolodexRef} onScroll={handleRolodexScroll}>
                {songs.map((song) => (
              <button
                key={song.beatEntryId}
                type="button"
                data-song-id={song.beatEntryId}
                className={`game-song-card${selectedId === song.beatEntryId ? " selected" : ""}`}
                onClick={() => focusSongCard(song.beatEntryId, true)}
              >
                {song.coverImageUrl ? (
                  <img className="game-song-card-bg" src={song.coverImageUrl} alt="" draggable={false} />
                ) : null}
                <div className="game-song-card-overlay" />
                <div className="game-song-card-glare" />
                <strong>{song.title}</strong>
                <span>
                  {song.availableDifficulties?.length > 0
                    ? `${song.availableDifficulties.join(", ")}`
                    : `${song.gameBeatCount || song.majorBeatCount} notes`}
                </span>
              </button>
                ))}
              </div>
            </div>

            <aside className="game-menu-control-panel">
              {selectedSongSummary ? (
                <>
                  <div className="game-menu-control-group">
                    <p className="game-menu-group-label">Game Mode</p>
                    <div className="game-menu-actions game-menu-actions--group">
                      {GAME_MODES.map((gameMode) => {
                        const available = (selectedSongSummary.availableGameModes ?? []).includes(gameMode);
                        return (
                          <button
                            key={gameMode}
                            type="button"
                            className={selectedGameMode === gameMode ? "" : "secondary"}
                            disabled={!available}
                            onClick={() => setSelectedGameMode(gameMode)}
                          >
                            {formatGameModeLabel(gameMode)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="game-menu-control-group">
                    <p className="game-menu-group-label">Difficulty</p>
                    <div className="game-menu-actions game-menu-actions--group">
                      {GAME_DIFFICULTIES.map((difficulty) => {
                        const available =
                          (selectedSongSummary.modeDifficultyBeatCounts?.[selectedGameMode]?.[difficulty] ?? 0) > 0;
                        return (
                          <button
                            key={difficulty}
                            type="button"
                            className={selectedDifficulty === difficulty ? "" : "secondary"}
                            disabled={!available}
                            onClick={() => setSelectedDifficulty(difficulty)}
                          >
                            {difficulty} ({selectedSongSummary.modeDifficultyBeatCounts?.[selectedGameMode]?.[difficulty] ?? 0})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="small game-menu-meta">
                    {formatGameModeLabel(selectedGameMode)} | {selectedDifficulty} | notes{" "}
                    {selectedSongSummary.modeDifficultyBeatCounts?.[selectedGameMode]?.[selectedDifficulty] ?? 0}
                  </p>
                </>
              ) : null}
              <div className="game-menu-actions game-menu-actions--cta">
                <button
                  type="button"
                  disabled={
                    !selectedId ||
                    loadingEntry ||
                    ((selectedSongSummary?.modeDifficultyBeatCounts?.[selectedGameMode]?.[selectedDifficulty] ?? 0) <= 0 &&
                      !(
                        selectedGameMode === "step_arrows" &&
                        selectedDifficulty === "normal" &&
                        (selectedSongSummary?.majorBeatCount ?? 0) > 0
                      ))
                  }
                  onClick={() => startGame()}
                >
                  {loadingEntry ? "Loading Song..." : "Start Game"}
                </button>
                <button type="button" className="secondary" disabled={!selectedId} onClick={() => setMode("scores")}>View High Scores</button>
              </div>
            </aside>
          </div>
          {error ? <p className="error">{error}</p> : null}
          {songs.length === 0 && !loadingSongs ? <p>No enabled songs available yet.</p> : null}
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
            <h3>Song High Scores ({formatGameModeLabel(selectedGameMode)} | {selectedDifficulty})</h3>
            {songLeaderboard.length === 0 ? <p>No scores yet for this track.</p> : (
              <ol>
                {songLeaderboard.slice(0, 20).map((row) => (
                  <li key={`${row.publicKey}-${row.displayName}`}><span>{row.displayName}</span><strong className="game-score-number">{row.score}</strong></li>
                ))}
              </ol>
            )}
          </section>
          <section className="game-score-panel">
            <h3>Overall High Scores</h3>
            {overallLeaderboard.length === 0 ? <p>No overall scores yet.</p> : (
              <ol>
                {overallLeaderboard.slice(0, 20).map((row) => (
                  <li key={`${row.publicKey}-${row.displayName}`}><span>{row.displayName}</span><strong className="game-score-number">{row.totalScore}</strong></li>
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
      <div className={`ddr-field${selectedGameMode === "orb_beat" ? ` orb-field${isLandscape ? " landscape" : " portrait"}` : ""}`}>
        <div className="game-play-overlay">
          <div className="game-play-topbar">
            <button type="button" className="secondary game-play-exit" onClick={() => goToMenu()}>Exit</button>
            <div className="game-play-title-block">
              <div className="game-play-title">
                {songs.find((song) => song.beatEntryId === selectedId)?.title ?? "Gameplay"}
              </div>
              <div className="game-play-subtitle">{formatGameModeLabel(selectedGameMode)} | {selectedDifficulty}</div>
            </div>
            <div className="game-top-status">{phase === "finished" ? "Complete" : phase === "running" ? "Live" : ""}</div>
          </div>
          <div className="game-play-hud">
            <div className="ddr-life"><span>LIFE</span><div className="ddr-life-bar"><div className="ddr-life-fill" style={{ width: `${lifePercent}%` }} /></div></div>
            <div className="ddr-score-stack"><span className="ddr-score-label">SCORE</span><strong className="game-score-number">{totalScore}</strong></div>
            <div className="ddr-score-stack"><span className="ddr-score-label">COMBO</span><strong className="game-score-number">{score.combo}</strong></div>
          </div>
        </div>

        <div className="game-play-stage">
          {selectedGameMode === "orb_beat" ? (
            <>
              <div className="orb-core" />
              <div className="orb-lanes">
                {activeLanes.map((lane) => {
                  const laneNotes = visibleNotes.filter((note) => note.lane === lane);
                  return (
                    <div key={lane} className={`orb-lane lane-${lane}`}>
                      {laneNotes.map((note) => {
                        const timeUntilHit = note.timeSeconds - currentTimeSeconds;
                        const progress = 1 - timeUntilHit / Math.max(0.05, runtimeConfig.gameApproachSeconds);
                        const distancePercent = Math.max(0, Math.min(100, progress * 100));
                        const isHold = note.type === "hold" && note.endSeconds - note.timeSeconds >= HOLD_MIN_SECONDS;
                        const tailScale = Math.max(
                          0.4,
                          Math.min(2.5, (note.endSeconds - note.timeSeconds) / Math.max(0.08, runtimeConfig.gameApproachSeconds))
                        );
                        return (
                          <div
                            key={note.id}
                            className={`orb-note lane-${note.lane}${note.judged ? " judged" : ""}${note.holdStarted && !note.judged ? " holding" : ""}${isHold ? " hold-note" : ""}`}
                            style={{
                              "--orb-progress": `${distancePercent}%`,
                              "--orb-tail-scale": String(tailScale)
                            } as CSSProperties}
                          >
                            <span className="orb-note-core" />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <div className="orb-control-grid">
                {activeLanes.map((lane) => (
                  <div key={lane} className={`orb-control-anchor lane-${lane}`}>
                    <button
                      type="button"
                      disabled={phase !== "running"}
                      className={`orb-control lane-${lane}${pressedLanes[lane] ? " pressed" : ""}${heldLanes[lane] ? " held" : ""}`}
                      onMouseDown={() => handleLaneMouseDown(lane)}
                      onMouseUp={() => releaseLane(lane)}
                      onMouseLeave={() => releaseLane(lane)}
                      onTouchStart={(event) => handleLaneTouchStart(event, lane)}
                      onTouchEnd={() => releaseLane(lane)}
                      onTouchCancel={() => releaseLane(lane)}
                    >
                      <span>{orbControlLabels[lane as OrbBeatLane]}</span>
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="ddr-lanes">
                {stepArrowLaneOrder.map((lane) => (
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
                          <img className={`ddr-arrow-graphic beat ${isHold ? "top-cap" : "single"}`} src={beatArrowImages[note.lane as StepArrowLane]} alt="" draggable={false} />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="ddr-step-zone">
                {stepArrowLaneOrder.map((lane) => (
                  <button
                    key={lane}
                    type="button"
                    disabled={phase !== "running"}
                    className={`ddr-receptor lane-${lane}${pressedLanes[lane] ? " pressed" : ""}${heldLanes[lane] ? " held" : ""}`}
                    onMouseDown={() => handleLaneMouseDown(lane)}
                    onMouseUp={() => releaseLane(lane)}
                    onMouseLeave={() => releaseLane(lane)}
                    onTouchStart={(event) => handleLaneTouchStart(event, lane)}
                    onTouchEnd={() => releaseLane(lane)}
                    onTouchCancel={() => releaseLane(lane)}
                  >
                    <img className="ddr-arrow-graphic control" src={controlArrowImages[lane]} alt="" draggable={false} />
                  </button>
                ))}
              </div>
            </>
          )}

          {lastJudgement ? (
            <div key={`${lastJudgement}-${judgementEventId}`} className={`ddr-judge-popup ${lastJudgement}`}>
              {lastJudgement.toUpperCase()}
            </div>
          ) : null}
          {score.combo > 1 ? <div className="ddr-combo-popup"><span className="game-score-number">{score.combo}</span> COMBO</div> : null}
          {phase === "countdown" && countdownBeats > 0 ? <div className="game-countdown-overlay">{countdownBeats}</div> : null}

          {resultsModal.visible ? (
            <div className="game-results-modal" role="dialog" aria-modal="true">
              <h3>Song Complete</h3>
              <p className="result-line">Score: <strong className="game-score-number">{resultsModal.score}</strong></p>
              <p className="result-line">Accuracy: <strong className="game-score-number">{resultsModal.percentage.toFixed(2)}%</strong></p>
              {canSubmitHolderScore && resultsModal.rank ? <p className="result-line">Rank: <strong className="game-score-number">#{resultsModal.rank}</strong></p> : null}
              <p className="small">{resultsModal.message}</p>
              <button type="button" onClick={() => goToMenu()}>Back To Menu</button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
