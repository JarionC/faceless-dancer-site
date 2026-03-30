import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { runtimeConfig } from "../config/runtime";
import { createPrecisePlaybackEngine, type PrecisePlaybackEngine } from "../lib/audio/precisePlaybackEngine";
import {
  buildMelodyNotesFromMajorBeats,
  type GameLane,
  type MelodyNote
} from "../lib/game/melodyChartService";
import type { SavedBeatEntry, SavedBeatSummary } from "../types/beat";

interface GameViewProps {
  apiBaseUrl: string;
}

interface HybridAnalysisResult {
  majorBeats?: Array<{ timeSeconds: number; strength: number }>;
}

type Judgement = "perfect" | "great" | "good" | "poor" | "miss";

interface GameNoteState extends MelodyNote {
  judged: boolean;
  judgement: Judgement | null;
  holdStarted: boolean;
  holding: boolean;
  holdStartJudgement: Exclude<Judgement, "miss"> | null;
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
const laneSymbols: Record<GameLane, string> = {
  left: "←",
  up: "↑",
  down: "↓",
  right: "→"
};

const HOLD_MIN_SECONDS = 0.14;

function createInitialScore(): ScoreState {
  return {
    combo: 0,
    maxCombo: 0,
    perfect: 0,
    great: 0,
    good: 0,
    poor: 0,
    miss: 0
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed.");
  }
  return body;
}

function classifyJudgement(
  deltaSeconds: number,
  windows: { perfect: number; great: number; good: number; poor: number }
): Judgement {
  const absDelta = Math.abs(deltaSeconds);
  if (absDelta <= windows.perfect) {
    return "perfect";
  }
  if (absDelta <= windows.great) {
    return "great";
  }
  if (absDelta <= windows.good) {
    return "good";
  }
  if (absDelta <= windows.poor) {
    return "poor";
  }
  return "miss";
}

export function GameView({ apiBaseUrl }: GameViewProps): JSX.Element {
  const engineRef = useRef<PrecisePlaybackEngine | null>(null);
  const gameAreaRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const notesRef = useRef<GameNoteState[]>([]);
  const heldLanesRef = useRef<Record<GameLane, boolean>>({
    left: false,
    down: false,
    up: false,
    right: false
  });
  const pulseTimeoutsRef = useRef<Record<GameLane, number | null>>({
    left: null,
    down: null,
    up: null,
    right: null
  });
  const impulseTimeoutsRef = useRef<Record<GameLane, number | null>>({
    left: null,
    down: null,
    up: null,
    right: null
  });
  const [listError, setListError] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [summaries, setSummaries] = useState<SavedBeatSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<SavedBeatEntry | null>(null);
  const [score, setScore] = useState<ScoreState>(createInitialScore);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [gameAreaHeightPx, setGameAreaHeightPx] = useState(680);
  const [playing, setPlaying] = useState(false);
  const [lastJudgement, setLastJudgement] = useState<Judgement | null>(null);
  const [analysisMajorBeats, setAnalysisMajorBeats] = useState<Array<{ timeSeconds: number; strength: number }> | null>(null);
  const [pressedLanes, setPressedLanes] = useState<Record<GameLane, boolean>>({
    left: false,
    down: false,
    up: false,
    right: false
  });
  const [heldLanes, setHeldLanes] = useState<Record<GameLane, boolean>>({
    left: false,
    down: false,
    up: false,
    right: false
  });
  const [laneImpulses, setLaneImpulses] = useState<Record<GameLane, Exclude<Judgement, "miss"> | null>>({
    left: null,
    down: null,
    up: null,
    right: null
  });

  const windows = useMemo(() => {
    const perfect = runtimeConfig.gamePerfectWindowSeconds;
    const great = Math.max(perfect, runtimeConfig.gameGreatWindowSeconds);
    const good = Math.max(great, runtimeConfig.gameGoodWindowSeconds);
    const poor = Math.max(good, runtimeConfig.gamePoorWindowSeconds);
    return { perfect, great, good, poor };
  }, []);

  const applyJudgement = (judgement: Judgement): void => {
    setLastJudgement(judgement);
    setScore((previous) => {
      const next: ScoreState = { ...previous };
      if (judgement === "perfect") {
        next.perfect += 1;
      } else if (judgement === "great") {
        next.great += 1;
      } else if (judgement === "good") {
        next.good += 1;
      } else if (judgement === "poor") {
        next.poor += 1;
      } else {
        next.miss += 1;
      }
      if (judgement === "miss") {
        next.combo = 0;
      } else {
        next.combo += 1;
        next.maxCombo = Math.max(next.maxCombo, next.combo);
      }
      return next;
    });
  };

  const resetChart = (): void => {
    if (!selectedEntry) {
      notesRef.current = [];
      setScore(createInitialScore());
      setLastJudgement(null);
      return;
    }
    const baseEntry: SavedBeatEntry =
      selectedEntry.gameBeats && selectedEntry.gameBeats.length > 0
        ? { ...selectedEntry, majorBeats: selectedEntry.gameBeats }
        : analysisMajorBeats && analysisMajorBeats.length > 0
          ? { ...selectedEntry, majorBeats: analysisMajorBeats }
          : selectedEntry;
    notesRef.current = buildMelodyNotesFromMajorBeats(baseEntry).map((note) => ({
      ...note,
      judged: false,
      judgement: null,
      holdStarted: false,
      holding: false,
      holdStartJudgement: null
    }));
    setScore(createInitialScore());
    setLastJudgement(null);
  };

  const stopRaf = (): void => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const autoMissPassedNotes = (heardTimeSeconds: number): void => {
    let updated = false;
    for (const note of notesRef.current) {
      if (note.judged) {
        continue;
      }
      const isHold = note.type === "hold" && note.endSeconds - note.timeSeconds >= HOLD_MIN_SECONDS;
      if (!isHold && heardTimeSeconds - note.timeSeconds > windows.poor) {
        note.judged = true;
        note.judgement = "miss";
        applyJudgement("miss");
        updated = true;
        continue;
      }
      if (!isHold) {
        continue;
      }
      if (!note.holdStarted && heardTimeSeconds - note.timeSeconds > windows.poor) {
        note.judged = true;
        note.judgement = "miss";
        applyJudgement("miss");
        updated = true;
        continue;
      }
      if (!note.holdStarted) {
        continue;
      }
      note.holding = heldLanesRef.current[note.lane];
      if (!note.holding && heardTimeSeconds < note.endSeconds - windows.poor) {
        note.judged = true;
        note.judgement = "miss";
        applyJudgement("miss");
        updated = true;
        continue;
      }
      if (heardTimeSeconds >= note.endSeconds) {
        note.judged = true;
        const completionJudgement = note.holdStartJudgement ?? "good";
        note.judgement = completionJudgement;
        applyJudgement(completionJudgement);
        pulseLane(note.lane, completionJudgement);
        updated = true;
      }
    }
    if (updated) {
      setCurrentTimeSeconds(heardTimeSeconds);
    }
  };

  const tick = (): void => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    const heard = engine.getCurrentHeardTime();
    autoMissPassedNotes(heard);
    setCurrentTimeSeconds(heard);
    if (engine.isPlaying()) {
      rafRef.current = window.requestAnimationFrame(tick);
    } else {
      stopRaf();
    }
  };

  const startRaf = (): void => {
    if (rafRef.current === null) {
      rafRef.current = window.requestAnimationFrame(tick);
    }
  };

  useEffect(() => {
    const engine = createPrecisePlaybackEngine();
    engine.setOnEnded(() => {
      setPlaying(false);
      setCurrentTimeSeconds(engine.getDurationSeconds());
      stopRaf();
    });
    engineRef.current = engine;

    return () => {
      stopRaf();
      for (const lane of laneOrder) {
        const handle = pulseTimeoutsRef.current[lane];
        if (handle !== null) {
          window.clearTimeout(handle);
        }
        const impulseHandle = impulseTimeoutsRef.current[lane];
        if (impulseHandle !== null) {
          window.clearTimeout(impulseHandle);
        }
      }
      engine.dispose().catch(() => undefined);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const target = gameAreaRef.current;
    if (!target) {
      return;
    }
    const updateSize = (): void => {
      const rect = target.getBoundingClientRect();
      if (rect.height > 0) {
        setGameAreaHeightPx(rect.height);
      }
    };
    updateSize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(target);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [selectedEntry?.id]);

  const pulseLane = (lane: GameLane, judgement: Exclude<Judgement, "miss"> | null): void => {
    const current = pulseTimeoutsRef.current[lane];
    if (current !== null) {
      window.clearTimeout(current);
    }
    const impulseCurrent = impulseTimeoutsRef.current[lane];
    if (impulseCurrent !== null) {
      window.clearTimeout(impulseCurrent);
    }
    setPressedLanes((previous) => ({ ...previous, [lane]: true }));
    setLaneImpulses((previous) => ({ ...previous, [lane]: judgement }));
    const timeout = window.setTimeout(() => {
      setPressedLanes((previous) => ({ ...previous, [lane]: false }));
      pulseTimeoutsRef.current[lane] = null;
    }, 45);
    const impulseTimeout = window.setTimeout(() => {
      setLaneImpulses((previous) => ({ ...previous, [lane]: null }));
      impulseTimeoutsRef.current[lane] = null;
    }, 170);
    pulseTimeoutsRef.current[lane] = timeout;
    impulseTimeoutsRef.current[lane] = impulseTimeout;
  };

  const loadSummaries = async (): Promise<void> => {
    setLoadingList(true);
    setListError(null);
    try {
      const result = await fetchJson<{ ok: boolean; entries: SavedBeatSummary[] }>(
        `${apiBaseUrl}/api/beats/list`
      );
      setSummaries(result.entries ?? []);
      if (!selectedId && result.entries && result.entries.length > 0) {
        setSelectedId(result.entries[0].id);
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to load saved songs.");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadSummaries().catch(() => undefined);
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const loadEntry = async (): Promise<void> => {
      const engine = engineRef.current;
      if (!engine) {
        return;
      }
      setLoadingEntry(true);
      setEntryError(null);
      setPlaying(false);
      stopRaf();
      engine.pause();
      engine.seek(0);
      setCurrentTimeSeconds(0);
      try {
        const detail = await fetchJson<{ ok: boolean; entry: SavedBeatEntry }>(
          `${apiBaseUrl}/api/beats/${encodeURIComponent(selectedId)}`
        );
        const audioResponse = await fetch(`${apiBaseUrl}/api/beats/${encodeURIComponent(selectedId)}/audio`);
        if (!audioResponse.ok) {
          throw new Error("Failed to load saved audio.");
        }
        const audioBytes = await audioResponse.arrayBuffer();
        await engine.loadFromArrayBuffer(audioBytes);
        setDurationSeconds(engine.getDurationSeconds() || detail.entry.entry.durationSeconds);
        setSelectedEntry(detail.entry);
        try {
          const analysis = await fetchJson<{ ok: boolean; result: HybridAnalysisResult }>(
            `${apiBaseUrl}/api/analyze/${encodeURIComponent(selectedId)}/result`
          );
          const beats = Array.isArray(analysis.result?.majorBeats) ? analysis.result.majorBeats : [];
          setAnalysisMajorBeats(beats.length > 0 ? beats : null);
        } catch {
          setAnalysisMajorBeats(null);
        }
      } catch (error) {
        setEntryError(error instanceof Error ? error.message : "Failed to load selected song.");
        setSelectedEntry(null);
        setAnalysisMajorBeats(null);
        notesRef.current = [];
      } finally {
        setLoadingEntry(false);
      }
    };
    loadEntry().catch(() => undefined);
  }, [apiBaseUrl, selectedId]);

  useEffect(() => {
    resetChart();
    // Reset when entry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntry?.id, analysisMajorBeats?.length]);

  const handleTogglePlay = async (): Promise<void> => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    if (playing) {
      engine.pause();
      setCurrentTimeSeconds(engine.getCurrentHeardTime());
      setPlaying(false);
      stopRaf();
      return;
    }
    await engine.play();
    setPlaying(true);
    startRaf();
  };

  const handleRestart = (): void => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    engine.pause();
    engine.seek(0);
    setPlaying(false);
    setCurrentTimeSeconds(0);
    heldLanesRef.current = { left: false, down: false, up: false, right: false };
    setHeldLanes({ left: false, down: false, up: false, right: false });
    setLaneImpulses({ left: null, down: null, up: null, right: null });
    stopRaf();
    resetChart();
  };

  const handleLaneInput = (lane: GameLane): void => {
    heldLanesRef.current = { ...heldLanesRef.current, [lane]: true };
    setHeldLanes((previous) => ({ ...previous, [lane]: true }));
    if (!selectedEntry) {
      pulseLane(lane, null);
      return;
    }
    const engine = engineRef.current;
    const heardTime = engine ? engine.getCurrentHeardTime() : currentTimeSeconds;
    for (const note of notesRef.current) {
      if (note.judged || note.lane !== lane || !note.holdStarted) {
        continue;
      }
      note.holding = true;
    }
    let candidate: GameNoteState | null = null;
    let bestAbsDelta = Number.POSITIVE_INFINITY;
    for (const note of notesRef.current) {
      if (note.judged || note.lane !== lane || note.holdStarted) {
        continue;
      }
      const delta = heardTime - note.timeSeconds;
      const absDelta = Math.abs(delta);
      if (absDelta > windows.poor) {
        continue;
      }
      if (absDelta < bestAbsDelta) {
        candidate = note;
        bestAbsDelta = absDelta;
      }
    }

    if (!candidate) {
      pulseLane(lane, null);
      applyJudgement("miss");
      return;
    }

    const delta = heardTime - candidate.timeSeconds;
    const judgement = classifyJudgement(delta, windows);
    const isHold = candidate.type === "hold" && candidate.endSeconds - candidate.timeSeconds >= HOLD_MIN_SECONDS;
    if (!isHold) {
      candidate.judged = true;
      candidate.judgement = judgement;
      pulseLane(lane, judgement === "miss" ? null : judgement);
      applyJudgement(judgement);
      setCurrentTimeSeconds(heardTime);
      return;
    }
    if (judgement === "miss") {
      candidate.judged = true;
      candidate.judgement = "miss";
      pulseLane(lane, null);
      applyJudgement("miss");
      setCurrentTimeSeconds(heardTime);
      return;
    }
    candidate.holdStarted = true;
    candidate.holding = true;
    candidate.holdStartJudgement = judgement;
    pulseLane(lane, judgement);
    setCurrentTimeSeconds(heardTime);
  };

  useEffect(() => {
    const area = gameAreaRef.current;
    if (!area || !playing) {
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && area.contains(active)) {
      active.blur();
    }
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (area.contains(target)) {
        target.blur();
      }
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [playing]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }
      if (event.key === "ArrowLeft") {
        handleLaneInput("left");
        event.preventDefault();
      } else if (event.key === "ArrowUp") {
        handleLaneInput("up");
        event.preventDefault();
      } else if (event.key === "ArrowDown") {
        handleLaneInput("down");
        event.preventDefault();
      } else if (event.key === "ArrowRight") {
        handleLaneInput("right");
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft") {
        heldLanesRef.current = { ...heldLanesRef.current, left: false };
        setHeldLanes((previous) => ({ ...previous, left: false }));
      } else if (event.key === "ArrowUp") {
        heldLanesRef.current = { ...heldLanesRef.current, up: false };
        setHeldLanes((previous) => ({ ...previous, up: false }));
      } else if (event.key === "ArrowDown") {
        heldLanesRef.current = { ...heldLanesRef.current, down: false };
        setHeldLanes((previous) => ({ ...previous, down: false }));
      } else if (event.key === "ArrowRight") {
        heldLanesRef.current = { ...heldLanesRef.current, right: false };
        setHeldLanes((previous) => ({ ...previous, right: false }));
      }
    };
    const onBlur = (): void => {
      heldLanesRef.current = { left: false, down: false, up: false, right: false };
      setHeldLanes({ left: false, down: false, up: false, right: false });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
    // Depends on selected song and timing windows.
  }, [selectedEntry, windows.poor]);

  const visibleNotes = useMemo(() => {
    const startWindow = currentTimeSeconds - windows.poor - 0.05;
    const endWindow = currentTimeSeconds + runtimeConfig.gameApproachSeconds + 0.2;
    return notesRef.current.filter(
      (note) => note.timeSeconds <= endWindow && Math.max(note.timeSeconds, note.endSeconds) >= startWindow
    );
  }, [currentTimeSeconds, windows.poor]);

  return (
    <section className="panel game-panel">
      <div className="saved-header">
        <h2>Rhythm Game</h2>
        <button type="button" onClick={() => loadSummaries()} disabled={loadingList}>
          {loadingList ? "Refreshing..." : "Refresh Songs"}
        </button>
      </div>
      <p className="game-help">
        Uses saved game beats first, then hybrid onset beats, then saved major beats. Supports hold notes and overlapping lanes. Controls: Arrow keys.
      </p>
      {listError && <p className="error">{listError}</p>}
      {summaries.length > 0 ? (
        <label className="saved-select">
          Select Song
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {summaries.map((summary) => (
              <option key={summary.id} value={summary.id}>
                {summary.entryName} ({summary.gameBeatCount ?? summary.majorBeatCount} melody beats)
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>No saved songs found yet.</p>
      )}
      {entryError && <p className="error">{entryError}</p>}
      {loadingEntry && <p>Loading selected song...</p>}

      <div className="game-controls">
        <button type="button" onClick={() => handleTogglePlay()} disabled={!selectedEntry}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={() => handleRestart()} disabled={!selectedEntry}>
          Restart
        </button>
        <span>
          Time: {currentTimeSeconds.toFixed(2)} / {durationSeconds.toFixed(2)}s
        </span>
      </div>

      <div className="game-score-grid">
        <span>Combo: {score.combo}</span>
        <span>Max Combo: {score.maxCombo}</span>
        <span>Perfect: {score.perfect}</span>
        <span>Great: {score.great}</span>
        <span>Good: {score.good}</span>
        <span>Poor: {score.poor}</span>
        <span>Miss: {score.miss}</span>
        <span className={`judgement-tag ${lastJudgement ?? "idle"}`}>
          Last: {lastJudgement ? lastJudgement.toUpperCase() : "NONE"}
        </span>
      </div>

      <div
        className="game-area"
        aria-label="DDR style game area"
        ref={gameAreaRef}
        onPointerDown={(event) => {
          event.preventDefault();
        }}
      >
        <div className="game-receptors">
          {laneOrder.map((lane) => (
            <div
              key={lane}
              className={`game-receptor lane-${lane}${pressedLanes[lane] ? " pressed" : ""}${
                heldLanes[lane] ? " held" : ""
              }${
                laneImpulses[lane] ? ` impulse-${laneImpulses[lane]}` : ""
              }`}
            >
              {laneSymbols[lane]}
            </div>
          ))}
        </div>

        <div className="game-lanes">
          {laneOrder.map((lane) => (
            <div key={lane} className="game-lane">
              {visibleNotes
                .filter((note) => note.lane === lane)
                .map((note) => {
                  const timeUntilHit = note.timeSeconds - currentTimeSeconds;
                  const progress = 1 - timeUntilHit / Math.max(0.05, runtimeConfig.gameApproachSeconds);
                  const topPercent = 86 - progress * 70;
                  const isHold = note.type === "hold" && note.endSeconds - note.timeSeconds >= HOLD_MIN_SECONDS;
                  const tailSeconds = Math.max(0, note.endSeconds - note.timeSeconds);
                  const travelPx = Math.max(80, gameAreaHeightPx * 0.7);
                  const tailHeightPx = Math.max(
                    14,
                    (tailSeconds / Math.max(0.05, runtimeConfig.gameApproachSeconds)) * travelPx
                  );
                  return (
                    <div
                      key={note.id}
                      className={`game-note lane-${note.lane}${note.judged ? " judged" : ""}${
                        note.holdStarted && !note.judged ? " holding" : ""
                      }${isHold ? " hold-note" : ""}`}
                      style={
                        {
                          top: `${topPercent}%`,
                          "--hold-height-px": `${tailHeightPx}px`
                        } as CSSProperties
                      }
                    >
                      {isHold && <div className="hold-tail" />}
                      {laneSymbols[note.lane]}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
