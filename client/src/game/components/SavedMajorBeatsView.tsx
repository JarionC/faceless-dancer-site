import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { PointerEvent as ReactPointerEvent } from "preact/compat";
import { createPrecisePlaybackEngine, type PrecisePlaybackEngine } from "../lib/audio/precisePlaybackEngine";
import type { BeatPoint, SavedBeatEntry, SavedBeatSummary, SourceEvent, SourceName } from "../types/beat";
import { formatSourceLabel, getSourceColor, sortSourceLabels } from "../lib/visual/sourceColors";
import { decodeAudioArrayBuffer } from "../lib/audio/decodeAudio";
import { extractBeatDataFromAudioBuffer } from "../lib/audio/extractBeatData";
import { findZeroSlopePeakIndices } from "../lib/audio/findZeroSlopePeaks";
import { runtimeConfig } from "../config/runtime";
import {
  GAME_DIFFICULTIES,
  GAME_MODES,
  type GameDifficulty,
  type GameMode,
  getAvailableDifficulties,
  getAvailableGameModes,
  getModeDifficultyBeatCount,
  getModeDifficultyChart,
} from "../lib/game/difficultyCharts";

interface SavedMajorBeatsViewProps {
  apiBaseUrl: string;
  activeWindowSeconds: number;
  autoSelectEntryId?: string;
}

interface HybridAnalysisResult {
  algorithm: string;
  durationSeconds: number;
  sampleRate: number;
  tempoBpm: number;
  majorBeats: Array<{ timeSeconds: number; strength: number }>;
  bandBeats?: {
    low?: Array<{ timeSeconds: number; strength: number }>;
    mid?: Array<{ timeSeconds: number; strength: number }>;
    high?: Array<{ timeSeconds: number; strength: number }>;
    combined?: Array<{ timeSeconds: number; strength: number }>;
  };
  sustains: Array<{
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
    strength: number;
    pitchMidi?: number | null;
  }>;
  meta?: {
    beatCount?: number;
    onsetCount?: number;
    majorBeatCount?: number;
    sustainCount?: number;
    sustainSource?: string;
  };
}

interface ControlDefaultsResponse {
  analysisOverrides: Record<string, number | boolean> | null;
  laneStrengthThresholds: Record<SourceName, number> | null;
}

type ChartDataMode = "separated" | "hybrid" | "saved";
type GameBeatSelection = {
  id: string;
  source: SourceName;
  startSeconds: number;
  endSeconds: number;
};
type AnalysisOverrides = {
  hopLength: number;
  onsetMinStrength: number;
  onsetMinDistanceSeconds: number;
  adaptiveWindowSeconds: number;
  strictK: number;
  permissiveK: number;
  gapTriggerSeconds: number;
  sustainMinDurationSeconds: number;
  sustainMergeGapSeconds: number;
  sustainBridgeFloor: number;
  sustainMaxPitchJumpSemitones: number;
  sustainSplitOnPitchChange: boolean;
  sustainMinPitchConfidence: number;
  sustainEnableContinuousPitchSplit: boolean;
  sustainPitchSplitThresholdSemitones: number;
  sustainPitchSplitMinSegmentSeconds: number;
  sustainPitchSplitMinVoicedProbability: number;
  lowFmin: number;
  lowFmax: number;
  midFmin: number;
  midFmax: number;
  highFmin: number;
  highFmax: number;
  lowWeight: number;
  midWeight: number;
  highWeight: number;
};

const PADDING_LEFT = 56;
const PADDING_RIGHT = 20;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 36;
const MIN_CHART_WIDTH = 1400;
const PIXELS_PER_SECOND = 22;
const LANES_TOP = 32;
const HYBRID_EDITOR_SOURCES: SourceName[] = [
  "hybrid_band_low",
  "hybrid_band_mid",
  "hybrid_band_high",
  "hybrid_band_combined",
  "hybrid_sustain"
];

function toX(timeSeconds: number, durationSeconds: number, chartWidth: number): number {
  const safeDuration = durationSeconds > 0 ? durationSeconds : 1;
  const drawableWidth = chartWidth - PADDING_LEFT - PADDING_RIGHT;
  return PADDING_LEFT + (timeSeconds / safeDuration) * drawableWidth;
}

function laneY(source: SourceName, lanes: SourceName[]): number {
  const index = lanes.indexOf(source);
  const laneGap = lanes.length > 18 ? 22 : lanes.length > 10 ? 30 : 40;
  return LANES_TOP + Math.max(0, index) * laneGap;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed.");
  }
  return body;
}

function createDefaultAnalysisOverrides(): AnalysisOverrides {
  return {
    hopLength: runtimeConfig.hybridAnalysisHopLengthDefault,
    onsetMinStrength: runtimeConfig.hybridAnalysisOnsetMinStrengthDefault,
    onsetMinDistanceSeconds: runtimeConfig.hybridAnalysisOnsetMinDistanceSecondsDefault,
    adaptiveWindowSeconds: runtimeConfig.hybridAnalysisAdaptiveWindowSecondsDefault,
    strictK: runtimeConfig.hybridAnalysisStrictKDefault,
    permissiveK: runtimeConfig.hybridAnalysisPermissiveKDefault,
    gapTriggerSeconds: runtimeConfig.hybridAnalysisGapTriggerSecondsDefault,
    sustainMinDurationSeconds: runtimeConfig.hybridAnalysisSustainMinDurationSecondsDefault,
    sustainMergeGapSeconds: runtimeConfig.hybridAnalysisSustainMergeGapSecondsDefault,
    sustainBridgeFloor: runtimeConfig.hybridAnalysisSustainBridgeFloorDefault,
    sustainMaxPitchJumpSemitones: runtimeConfig.hybridAnalysisSustainMaxPitchJumpSemitonesDefault,
    sustainSplitOnPitchChange: runtimeConfig.hybridAnalysisSustainSplitOnPitchChangeDefault,
    sustainMinPitchConfidence: runtimeConfig.hybridAnalysisSustainMinPitchConfidenceDefault,
    sustainEnableContinuousPitchSplit:
      runtimeConfig.hybridAnalysisSustainEnableContinuousPitchSplitDefault,
    sustainPitchSplitThresholdSemitones:
      runtimeConfig.hybridAnalysisSustainPitchSplitThresholdSemitonesDefault,
    sustainPitchSplitMinSegmentSeconds:
      runtimeConfig.hybridAnalysisSustainPitchSplitMinSegmentSecondsDefault,
    sustainPitchSplitMinVoicedProbability:
      runtimeConfig.hybridAnalysisSustainPitchSplitMinVoicedProbabilityDefault,
    lowFmin: runtimeConfig.hybridAnalysisLowFminDefault,
    lowFmax: runtimeConfig.hybridAnalysisLowFmaxDefault,
    midFmin: runtimeConfig.hybridAnalysisMidFminDefault,
    midFmax: runtimeConfig.hybridAnalysisMidFmaxDefault,
    highFmin: runtimeConfig.hybridAnalysisHighFminDefault,
    highFmax: runtimeConfig.hybridAnalysisHighFmaxDefault,
    lowWeight: runtimeConfig.hybridAnalysisLowWeightDefault,
    midWeight: runtimeConfig.hybridAnalysisMidWeightDefault,
    highWeight: runtimeConfig.hybridAnalysisHighWeightDefault
  };
}

function normalizeAnalysisOverrides(value: AnalysisOverrides): AnalysisOverrides {
  const lowFmin = Math.max(1, value.lowFmin);
  const lowFmax = Math.max(lowFmin + 1, value.lowFmax);
  const midFmin = Math.max(lowFmin + 1, value.midFmin);
  const midFmax = Math.max(midFmin + 1, value.midFmax);
  const highFmin = Math.max(midFmin + 1, value.highFmin);
  const highFmax = Math.max(highFmin + 1, value.highFmax);
  return {
    ...value,
    hopLength: Math.max(64, Math.round(value.hopLength)),
    onsetMinStrength: Math.max(0, Math.min(1, value.onsetMinStrength)),
    onsetMinDistanceSeconds: Math.max(0.01, value.onsetMinDistanceSeconds),
    adaptiveWindowSeconds: Math.max(0.05, value.adaptiveWindowSeconds),
    strictK: Math.max(0, value.strictK),
    permissiveK: Math.max(0, value.permissiveK),
    gapTriggerSeconds: Math.max(0.02, value.gapTriggerSeconds),
    sustainMinDurationSeconds: Math.max(0.02, value.sustainMinDurationSeconds),
    sustainMergeGapSeconds: Math.max(0, value.sustainMergeGapSeconds),
    sustainBridgeFloor: Math.max(0, value.sustainBridgeFloor),
    sustainMaxPitchJumpSemitones: Math.max(0, value.sustainMaxPitchJumpSemitones),
    sustainSplitOnPitchChange: Boolean(value.sustainSplitOnPitchChange),
    sustainMinPitchConfidence: Math.max(0, Math.min(1, value.sustainMinPitchConfidence)),
    sustainEnableContinuousPitchSplit: Boolean(value.sustainEnableContinuousPitchSplit),
    sustainPitchSplitThresholdSemitones: Math.max(0, value.sustainPitchSplitThresholdSemitones),
    sustainPitchSplitMinSegmentSeconds: Math.max(0.02, value.sustainPitchSplitMinSegmentSeconds),
    sustainPitchSplitMinVoicedProbability: Math.max(
      0,
      Math.min(1, value.sustainPitchSplitMinVoicedProbability)
    ),
    lowFmin,
    lowFmax,
    midFmin,
    midFmax,
    highFmin,
    highFmax,
    lowWeight: Math.max(0, value.lowWeight),
    midWeight: Math.max(0, value.midWeight),
    highWeight: Math.max(0, value.highWeight)
  };
}

function collapseSustainEvents(events: SourceEvent[], mergeGapSeconds: number): SourceEvent[] {
  if (events.length === 0) {
    return [];
  }
  const sorted = [...events].sort((a, b) => a.startSeconds - b.startSeconds);
  const merged: SourceEvent[] = [];
  for (const event of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...event });
      continue;
    }
    if (event.startSeconds <= last.endSeconds + Math.max(0, mergeGapSeconds)) {
      last.endSeconds = Math.max(last.endSeconds, event.endSeconds);
      last.durationSeconds = Math.max(0.01, last.endSeconds - last.startSeconds);
      last.strength = Math.max(last.strength, event.strength);
      continue;
    }
    merged.push({ ...event });
  }
  return merged;
}

function HelpBubble({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="help-bubble"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="help-bubble-trigger"
        aria-label="Explain setting"
        onClick={() => setOpen((previous) => !previous)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && <span className="help-bubble-text">{text}</span>}
    </span>
  );
}

export function SavedMajorBeatsView({
  apiBaseUrl,
  activeWindowSeconds,
  autoSelectEntryId
}: SavedMajorBeatsViewProps): JSX.Element {
  const engineRef = useRef<PrecisePlaybackEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const dragSelectionRef = useRef<GameBeatSelection | null>(null);
  const [summaries, setSummaries] = useState<SavedBeatSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedEntry, setSelectedEntry] = useState<SavedBeatEntry | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [separationState, setSeparationState] = useState<{
    status: string;
    message?: string;
    errorCode?: string;
  } | null>(null);
  const [isStartingSeparation, setIsStartingSeparation] = useState(false);
  const [separatedStemEvents, setSeparatedStemEvents] = useState<SourceEvent[] | null>(null);
  const [loadingSeparatedSources, setLoadingSeparatedSources] = useState(false);
  const [separationLogText, setSeparationLogText] = useState<string | null>(null);
  const [loadingSeparationLog, setLoadingSeparationLog] = useState(false);
  const [analysisState, setAnalysisState] = useState<{
    status: string;
    message?: string;
    errorCode?: string;
  } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<HybridAnalysisResult | null>(null);
  const [loadingAnalysisResult, setLoadingAnalysisResult] = useState(false);
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
  const [chartDataMode, setChartDataMode] = useState<ChartDataMode>("hybrid");
  const [controlDefaults, setControlDefaults] = useState<ControlDefaultsResponse | null>(null);
  const [analysisOverrides, setAnalysisOverrides] = useState<AnalysisOverrides>(
    createDefaultAnalysisOverrides()
  );
  const [laneStrengthThresholds, setLaneStrengthThresholds] = useState<Record<SourceName, number>>({
    hybrid_band_low: runtimeConfig.gameBeatEditorDefaultMinStrength,
    hybrid_band_mid: runtimeConfig.gameBeatEditorDefaultMinStrength,
    hybrid_band_high: runtimeConfig.gameBeatEditorDefaultMinStrength,
    hybrid_band_combined: runtimeConfig.gameBeatEditorDefaultMinStrength,
    hybrid_sustain: runtimeConfig.gameBeatEditorDefaultMinStrength
  });
  const [gameBeatSelections, setGameBeatSelections] = useState<GameBeatSelection[]>([]);
  const [dragSelection, setDragSelection] = useState<GameBeatSelection | null>(null);
  const [saveGameBeatsState, setSaveGameBeatsState] = useState<{
    status: "idle" | "saving" | "saved" | "failed";
    message?: string;
  }>({ status: "idle" });
  const [selectedGameMode, setSelectedGameMode] = useState<GameMode>("step_arrows");
  const [selectedDifficulty, setSelectedDifficulty] = useState<GameDifficulty>("normal");

  const stopRaf = (): void => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const tick = (): void => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    setCurrentTimeSeconds(engine.getCurrentHeardTime());
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
      engine.dispose().catch(() => undefined);
      engineRef.current = null;
    };
  }, []);

  const refreshList = async (): Promise<void> => {
    setLoadingList(true);
    setListError(null);
    try {
      const result = await fetchJson<{ ok: boolean; entries: SavedBeatSummary[] }>(
        `${apiBaseUrl}/api/beats/list`
      );
      setSummaries(result.entries ?? []);
      if (!selectedId && result.entries?.length) {
        setSelectedId(result.entries[0].id);
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to load saved sessions.");
    } finally {
      setLoadingList(false);
    }
  };

  const loadSeparatedSourceEvents = async (entryId: string): Promise<void> => {
    setLoadingSeparatedSources(true);
    try {
      const sourcesResponse = await fetchJson<{
        ok: boolean;
        sources: Array<{ label: string; fileName: string }>;
      }>(`${apiBaseUrl}/api/separate/${encodeURIComponent(entryId)}/sources`);

      const allEvents: SourceEvent[] = [];
      for (const source of sourcesResponse.sources ?? []) {
        const audioResponse = await fetch(
          `${apiBaseUrl}/api/separate/${encodeURIComponent(entryId)}/source/${encodeURIComponent(source.label)}/audio`
        );
        if (!audioResponse.ok) {
          continue;
        }
        const bytes = await audioResponse.arrayBuffer();
        const buffer = await decodeAudioArrayBuffer(bytes);
        const beatPoints = extractBeatDataFromAudioBuffer(buffer, {
          windowSize: runtimeConfig.beatWindowSize,
          hopSize: runtimeConfig.beatHopSize,
          smoothingAlpha: runtimeConfig.beatSmoothingAlpha
        });
        const stemPeakIndices = findZeroSlopePeakIndices(beatPoints, {
          smoothingWindow: runtimeConfig.stemPeakSmoothingWindow,
          minStrength: runtimeConfig.stemPeakMinStrength,
          minProminence: runtimeConfig.stemPeakMinProminence,
          minDistancePoints: runtimeConfig.stemPeakMinDistancePoints
        });
        const sourceEvents: SourceEvent[] = stemPeakIndices
          .map((pointIndex) => beatPoints[pointIndex])
          .filter((point): point is (typeof beatPoints)[number] => point !== undefined)
          .map((point) => {
            const endSeconds =
              point.timeSeconds + Math.max(0.03, runtimeConfig.beatHopSize / Math.max(1, buffer.sampleRate) * 2);
            return {
              source: source.label,
              startSeconds: point.timeSeconds,
              endSeconds,
              durationSeconds: Math.max(0.01, endSeconds - point.timeSeconds),
              strength: point.strength
            };
          });
        allEvents.push(...sourceEvents);
      }
      allEvents.sort((a, b) => a.startSeconds - b.startSeconds);
      setSeparatedStemEvents(allEvents);
    } catch {
      setSeparatedStemEvents(null);
    } finally {
      setLoadingSeparatedSources(false);
    }
  };

  const loadSeparationLog = async (entryId: string): Promise<void> => {
    setLoadingSeparationLog(true);
    try {
      const result = await fetchJson<{
        ok: boolean;
        tailLines?: string[];
      }>(`${apiBaseUrl}/api/separate/${encodeURIComponent(entryId)}/log?tail=300`);
      const lines = result.tailLines ?? [];
      setSeparationLogText(lines.length > 0 ? lines.join("\n") : "No separation log found yet.");
    } catch (error) {
      setSeparationLogText(
        error instanceof Error ? `Failed to load log: ${error.message}` : "Failed to load log."
      );
    } finally {
      setLoadingSeparationLog(false);
    }
  };

  const loadHybridAnalysisResult = async (entryId: string): Promise<void> => {
    setLoadingAnalysisResult(true);
    try {
      const result = await fetchJson<{
        ok: boolean;
        result: HybridAnalysisResult;
      }>(`${apiBaseUrl}/api/analyze/${encodeURIComponent(entryId)}/result`);
      setAnalysisResult(result.result);
      setChartDataMode("hybrid");
    } catch {
      setAnalysisResult(null);
    } finally {
      setLoadingAnalysisResult(false);
    }
  };

  const loadControlDefaults = async (): Promise<ControlDefaultsResponse | null> => {
    try {
      return await fetchJson<ControlDefaultsResponse>(`${apiBaseUrl}/api/control-defaults`);
    } catch {
      return null;
    }
  };

  useEffect(() => {
    refreshList().catch(() => undefined);
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoSelectEntryId) {
      return;
    }
    setSelectedId(autoSelectEntryId);
    refreshList().catch(() => undefined);
  }, [autoSelectEntryId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedEntry(null);
      return;
    }

    const loadSelection = async (): Promise<void> => {
      const engine = engineRef.current;
      if (!engine) {
        return;
      }

      setLoadingEntry(true);
      setEntryError(null);
      setPlaying(false);
      setSeparationState(null);
      setSeparatedStemEvents(null);
      setSeparationLogText(null);
      setAnalysisState(null);
      setAnalysisResult(null);
      setChartDataMode("hybrid");
      setSelectedGameMode("step_arrows");
      setSelectedDifficulty("normal");
      setControlDefaults(null);
      setAnalysisOverrides(createDefaultAnalysisOverrides());
      setLaneStrengthThresholds({
        hybrid_band_low: runtimeConfig.gameBeatEditorDefaultMinStrength,
        hybrid_band_mid: runtimeConfig.gameBeatEditorDefaultMinStrength,
        hybrid_band_high: runtimeConfig.gameBeatEditorDefaultMinStrength,
        hybrid_band_combined: runtimeConfig.gameBeatEditorDefaultMinStrength,
        hybrid_sustain: runtimeConfig.gameBeatEditorDefaultMinStrength
      });
      setGameBeatSelections([]);
      setDragSelection(null);
      dragSelectionRef.current = null;
      setSaveGameBeatsState({ status: "idle" });
      stopRaf();
      engine.pause();
      engine.seek(0);
      setCurrentTimeSeconds(0);

      try {
        const detail = await fetchJson<{ ok: boolean; entry: SavedBeatEntry }>(
          `${apiBaseUrl}/api/beats/${encodeURIComponent(selectedId)}`
        );
        const audioResponse = await fetch(
          `${apiBaseUrl}/api/beats/${encodeURIComponent(selectedId)}/audio`
        );
        if (!audioResponse.ok) {
          throw new Error("Failed to load saved audio.");
        }
        const audioBytes = await audioResponse.arrayBuffer();
        await engine.loadFromArrayBuffer(audioBytes);
        setDurationSeconds(engine.getDurationSeconds() || detail.entry.entry.durationSeconds);
        setSelectedEntry(detail.entry);
        const defaults = await loadControlDefaults();
        setControlDefaults(defaults);
        if (defaults?.analysisOverrides) {
          setAnalysisOverrides((previous) =>
            normalizeAnalysisOverrides({
              ...previous,
              ...(defaults.analysisOverrides ?? {})
            } as AnalysisOverrides)
          );
        }
        if (defaults?.laneStrengthThresholds) {
          setLaneStrengthThresholds((previous) => ({
            ...previous,
            ...defaults.laneStrengthThresholds
          }));
        }
        setCurrentTimeSeconds(0);
        if (Array.isArray(detail.entry.separatedSources) && detail.entry.separatedSources.length > 0) {
          setSeparationState({ status: "completed", message: "Separation completed." });
          await loadSeparatedSourceEvents(selectedId);
        }
        if (detail.entry.hybridAnalysis?.storedFileName) {
          setAnalysisState({ status: "completed", message: "Hybrid analysis available." });
          await loadHybridAnalysisResult(selectedId);
        }
      } catch (error) {
        setEntryError(error instanceof Error ? error.message : "Failed to load saved entry.");
        setSelectedEntry(null);
      } finally {
        setLoadingEntry(false);
      }
    };

    loadSelection().catch(() => undefined);
  }, [apiBaseUrl, selectedId]);

  useEffect(() => {
    if (!selectedEntry) {
      return;
    }
    const modeDifficulties = getAvailableDifficulties(selectedEntry, selectedGameMode);
    if (modeDifficulties.length > 0 && !modeDifficulties.includes(selectedDifficulty)) {
      setSelectedDifficulty(modeDifficulties.includes("normal") ? "normal" : modeDifficulties[0]);
      return;
    }
    const defaults = controlDefaults?.analysisOverrides
      ? normalizeAnalysisOverrides({
          ...createDefaultAnalysisOverrides(),
          ...(controlDefaults.analysisOverrides ?? {})
        } as AnalysisOverrides)
      : createDefaultAnalysisOverrides();
    const chart = getModeDifficultyChart(selectedEntry, selectedGameMode, selectedDifficulty);
    const chartConfig = chart?.gameBeatConfig;

    setAnalysisOverrides(
      normalizeAnalysisOverrides({
        ...defaults,
        ...(chartConfig?.analysisOverrides ?? {})
      } as AnalysisOverrides)
    );
    setLaneStrengthThresholds({
      hybrid_band_low: runtimeConfig.gameBeatEditorDefaultMinStrength,
      hybrid_band_mid: runtimeConfig.gameBeatEditorDefaultMinStrength,
      hybrid_band_high: runtimeConfig.gameBeatEditorDefaultMinStrength,
      hybrid_band_combined: runtimeConfig.gameBeatEditorDefaultMinStrength,
      hybrid_sustain: runtimeConfig.gameBeatEditorDefaultMinStrength,
      ...(controlDefaults?.laneStrengthThresholds ?? {}),
      ...(chartConfig?.laneStrengthThresholds ?? {})
    });
    setGameBeatSelections(
      (chart?.gameBeatSelections ?? []).map((selection, index) => ({
        id: `persisted-${selectedDifficulty}-${index}`,
        source: selection.source,
        startSeconds: selection.startSeconds,
        endSeconds: selection.endSeconds
      }))
    );
    dragSelectionRef.current = null;
    setDragSelection(null);
    setSaveGameBeatsState({ status: "idle" });
  }, [controlDefaults, selectedDifficulty, selectedEntry, selectedGameMode]);

  const startRealSeparation = async (): Promise<void> => {
    if (!selectedId) {
      return;
    }
    setIsStartingSeparation(true);
    setSeparationState({ status: "starting", message: "Starting separation..." });
    setSeparationLogText(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/separate/${encodeURIComponent(selectedId)}/start`, {
        method: "POST"
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to start separation.");
      }
    } catch (error) {
      setSeparationState({
        status: "failed",
        message: error instanceof Error ? error.message : "Failed to start separation.",
        errorCode: "start_request_failed"
      });
      setIsStartingSeparation(false);
      return;
    }

    setIsStartingSeparation(false);
    setSeparationState({ status: "running", message: "Separation running..." });
    const maxPollAttempts = 180;
    for (let i = 0; i < maxPollAttempts; i += 1) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 2000);
      });
      try {
        const statusResult = await fetchJson<{
          ok: boolean;
          status: string;
          message?: string;
          errorCode?: string;
          sources?: Array<{ label: string; fileName: string }>;
        }>(`${apiBaseUrl}/api/separate/${encodeURIComponent(selectedId)}/status`);
        const status = statusResult.status ?? "running";
        setSeparationState({
          status,
          message: statusResult.message,
          errorCode: statusResult.errorCode
        });
        if (status === "completed") {
          await loadSeparatedSourceEvents(selectedId);
          return;
        }
        if (status === "failed") {
          await loadSeparationLog(selectedId);
          return;
        }
      } catch {
        // Continue polling transient network errors.
      }
    }
    setSeparationState({
      status: "timeout",
      message: "Timed out waiting for separation status.",
      errorCode: "status_poll_timeout"
    });
  };

  const startHybridAnalysis = async (): Promise<void> => {
    if (!selectedId) {
      return;
    }
    const normalized = normalizeAnalysisOverrides(analysisOverrides);
    setAnalysisOverrides(normalized);
    setIsStartingAnalysis(true);
    setAnalysisState({ status: "starting", message: "Starting hybrid analysis..." });
    try {
      const response = await fetch(`${apiBaseUrl}/api/analyze/${encodeURIComponent(selectedId)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisOverrides: normalized,
          laneStrengthThresholds
        })
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to start analysis.");
      }
    } catch (error) {
      setAnalysisState({
        status: "failed",
        message: error instanceof Error ? error.message : "Failed to start analysis.",
        errorCode: "analysis_start_request_failed"
      });
      setIsStartingAnalysis(false);
      return;
    }
    setIsStartingAnalysis(false);
    setAnalysisState({ status: "running", message: "Hybrid analysis running..." });
    const maxPollAttempts = 240;
    for (let i = 0; i < maxPollAttempts; i += 1) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 2000);
      });
      try {
        const statusResult = await fetchJson<{
          ok: boolean;
          status: string;
          message?: string;
          errorCode?: string;
        }>(`${apiBaseUrl}/api/analyze/${encodeURIComponent(selectedId)}/status`);
        const status = statusResult.status ?? "running";
        setAnalysisState({
          status,
          message: statusResult.message,
          errorCode: statusResult.errorCode
        });
        if (status === "completed") {
          await loadHybridAnalysisResult(selectedId);
          return;
        }
        if (status === "failed") {
          return;
        }
      } catch {
        // Continue polling transient errors.
      }
    }
    setAnalysisState({
      status: "timeout",
      message: "Timed out waiting for hybrid analysis status.",
      errorCode: "analysis_status_poll_timeout"
    });
  };

  const togglePlay = async (): Promise<void> => {
    const engine = engineRef.current;
    if (!engine || !selectedEntry) {
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

  const handleSeek = (nextTime: number): void => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    engine.seek(nextTime);
    setCurrentTimeSeconds(engine.getCurrentHeardTime());
    if (engine.isPlaying()) {
      startRaf();
    }
  };

  const chartWidth = useMemo(
    () => Math.max(MIN_CHART_WIDTH, Math.ceil(durationSeconds * PIXELS_PER_SECOND)),
    [durationSeconds]
  );
  const hybridEvents = useMemo<SourceEvent[]>(() => {
    if (!analysisResult) {
      return [];
    }
    const toBeatEvents = (
      beats: Array<{ timeSeconds: number; strength: number }> | undefined,
      source: SourceName
    ): SourceEvent[] =>
      (beats ?? []).map((beat) => ({
        source,
        startSeconds: beat.timeSeconds,
        endSeconds: beat.timeSeconds + 0.04,
        durationSeconds: 0.04,
        strength: beat.strength
      }));
    const bandBeatEvents = [
      ...toBeatEvents(analysisResult.bandBeats?.low, "hybrid_band_low"),
      ...toBeatEvents(analysisResult.bandBeats?.mid, "hybrid_band_mid"),
      ...toBeatEvents(analysisResult.bandBeats?.high, "hybrid_band_high"),
      ...toBeatEvents(analysisResult.bandBeats?.combined, "hybrid_band_combined")
    ];
    const majorBeatEvents =
      bandBeatEvents.length > 0
        ? []
        : toBeatEvents(analysisResult.majorBeats ?? [], "hybrid_band_combined");
    const sustainEvents = (analysisResult.sustains ?? []).map((sustain) => ({
      source: "hybrid_sustain",
      startSeconds: sustain.startSeconds,
      endSeconds: sustain.endSeconds,
      durationSeconds: sustain.durationSeconds,
      strength: sustain.strength
    }));
    return [...bandBeatEvents, ...majorBeatEvents, ...sustainEvents].sort(
      (a, b) => a.startSeconds - b.startSeconds
    );
  }, [analysisResult]);

  const sourceEvents = useMemo<SourceEvent[]>(() => {
    if (chartDataMode === "hybrid") {
      return hybridEvents;
    }
    if (chartDataMode === "separated") {
      return separatedStemEvents ?? [];
    }
    if (selectedEntry?.sourceEvents && selectedEntry.sourceEvents.length > 0) {
      return selectedEntry.sourceEvents;
    }
    return (selectedEntry?.majorBeats ?? []).map((beat) => ({
      source: "source_01",
      startSeconds: beat.timeSeconds,
      endSeconds: beat.timeSeconds + 0.05,
      durationSeconds: 0.05,
      strength: beat.strength
    }));
  }, [chartDataMode, hybridEvents, selectedEntry, separatedStemEvents]);

  const displayedSourceEvents = useMemo<SourceEvent[]>(() => {
    if (chartDataMode !== "hybrid") {
      return sourceEvents;
    }
    const filtered = sourceEvents.filter((event) => {
      const threshold = laneStrengthThresholds[event.source];
      if (threshold === undefined) {
        if (event.source === "hybrid_sustain") {
          return event.durationSeconds >= analysisOverrides.sustainMinDurationSeconds;
        }
        return true;
      }
      if (event.strength < threshold) {
        return false;
      }
      if (event.source === "hybrid_sustain") {
        return event.durationSeconds >= analysisOverrides.sustainMinDurationSeconds;
      }
      return true;
    });
    const sustain = filtered.filter((event) => event.source === "hybrid_sustain");
    const nonSustain = filtered.filter((event) => event.source !== "hybrid_sustain");
    const collapsedSustain = collapseSustainEvents(sustain, analysisOverrides.sustainMergeGapSeconds);
    return [...nonSustain, ...collapsedSustain].sort((a, b) => a.startSeconds - b.startSeconds);
  }, [
    analysisOverrides.sustainMergeGapSeconds,
    analysisOverrides.sustainMinDurationSeconds,
    chartDataMode,
    laneStrengthThresholds,
    sourceEvents
  ]);

  const updateAnalysisOverride = (key: keyof AnalysisOverrides, value: number): void => {
    setAnalysisOverrides((previous) => ({
      ...previous,
      [key]: Number.isFinite(value) ? value : previous[key]
    }));
  };

  const updateAnalysisToggle = (
    key: "sustainSplitOnPitchChange" | "sustainEnableContinuousPitchSplit",
    value: boolean
  ): void => {
    setAnalysisOverrides((previous) => ({
      ...previous,
      [key]: value
    }));
  };

  const updateLaneStrength = (source: SourceName, value: number): void => {
    setLaneStrengthThresholds((previous) => ({
      ...previous,
      [source]: Math.max(0, Math.min(1, Number.isFinite(value) ? value : previous[source] ?? 0))
    }));
  };

  const getChartPointerInfo = (
    event: ReactPointerEvent<SVGSVGElement>
  ): { timeSeconds: number; source: SourceName } | null => {
    const wrapper = chartWrapperRef.current;
    if (!wrapper || durationSeconds <= 0 || sourceLanes.length === 0) {
      return null;
    }
    const rect = wrapper.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const x = event.clientX - rect.left + wrapper.scrollLeft;
    const y = event.clientY - rect.top + wrapper.scrollTop;
    const drawableWidth = chartWidth - PADDING_LEFT - PADDING_RIGHT;
    const clampedX = Math.max(PADDING_LEFT, Math.min(chartWidth - PADDING_RIGHT, x));
    const timeSeconds =
      ((clampedX - PADDING_LEFT) / Math.max(1, drawableWidth)) * Math.max(0.0001, durationSeconds);
    const laneIndex = Math.floor((y - LANES_TOP + laneGap * 0.5) / laneGap);
    const source = sourceLanes[Math.max(0, Math.min(sourceLanes.length - 1, laneIndex))];
    if (!source) {
      return null;
    }
    return { timeSeconds, source };
  };

  const maybeAutoScrollWhileDragging = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const wrapper = chartWrapperRef.current;
    if (!wrapper || !dragSelectionRef.current) {
      return;
    }
    const rect = wrapper.getBoundingClientRect();
    const edge = 28;
    const step = 22;
    if (event.clientX <= rect.left + edge) {
      wrapper.scrollLeft = Math.max(0, wrapper.scrollLeft - step);
    } else if (event.clientX >= rect.right - edge) {
      wrapper.scrollLeft = Math.min(wrapper.scrollWidth, wrapper.scrollLeft + step);
    }
  };

  const startSelectionDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (chartDataMode !== "hybrid") {
      return;
    }
    const pointer = getChartPointerInfo(event);
    if (!pointer || !HYBRID_EDITOR_SOURCES.includes(pointer.source)) {
      return;
    }
    const next: GameBeatSelection = {
      id: `draft-${Date.now()}`,
      source: pointer.source,
      startSeconds: pointer.timeSeconds,
      endSeconds: pointer.timeSeconds
    };
    dragSelectionRef.current = next;
    setDragSelection(next);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSelectionDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!dragSelectionRef.current) {
      return;
    }
    maybeAutoScrollWhileDragging(event);
    const pointer = getChartPointerInfo(event);
    if (!pointer) {
      return;
    }
    const updated: GameBeatSelection = {
      ...dragSelectionRef.current,
      endSeconds: pointer.timeSeconds
    };
    dragSelectionRef.current = updated;
    setDragSelection(updated);
  };

  const endSelectionDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const current = dragSelectionRef.current;
    if (!current) {
      return;
    }
    const startSeconds = Math.min(current.startSeconds, current.endSeconds);
    const endSeconds = Math.max(current.startSeconds, current.endSeconds);
    const minLength = 0.01;
    if (endSeconds - startSeconds >= minLength) {
      setGameBeatSelections((previous) => [
        ...previous,
        {
          ...current,
          startSeconds,
          endSeconds,
          id: `sel-${Date.now()}-${previous.length}`
        }
      ]);
      setSaveGameBeatsState({ status: "idle" });
    }
    dragSelectionRef.current = null;
    setDragSelection(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const removeSelection = (selectionId: string): void => {
    setGameBeatSelections((previous) => previous.filter((selection) => selection.id !== selectionId));
    setSaveGameBeatsState({ status: "idle" });
  };

  const clearSelections = (): void => {
    setGameBeatSelections([]);
    dragSelectionRef.current = null;
    setDragSelection(null);
    setSaveGameBeatsState({ status: "idle" });
  };

  const selectedGameEvents = useMemo<SourceEvent[]>(() => {
    const ranges = [...gameBeatSelections];
    if (dragSelection) {
      ranges.push({
        ...dragSelection,
        startSeconds: Math.min(dragSelection.startSeconds, dragSelection.endSeconds),
        endSeconds: Math.max(dragSelection.startSeconds, dragSelection.endSeconds)
      });
    }
    if (ranges.length === 0) {
      return [];
    }
    const picked: SourceEvent[] = [];
    for (const selection of ranges) {
      for (const event of displayedSourceEvents) {
        if (selection.source !== event.source) {
          continue;
        }
        if (event.endSeconds < selection.startSeconds || event.startSeconds > selection.endSeconds) {
          continue;
        }
        picked.push({
          ...event
        });
      }
    }
    const dedup = new Map<string, SourceEvent>();
    for (const event of picked) {
      const key = `${event.source}:${Math.round(event.startSeconds * 1000)}:${Math.round(
        event.endSeconds * 1000
      )}:${Math.round(event.strength * 1000)}`;
      if (!dedup.has(key)) {
        dedup.set(key, event);
      }
    }
    return Array.from(dedup.values()).sort((a, b) => a.startSeconds - b.startSeconds);
  }, [displayedSourceEvents, dragSelection, gameBeatSelections]);

  const selectedGameBeats = useMemo<BeatPoint[]>(() => {
    if (selectedGameEvents.length === 0) {
      return [];
    }
    const sorted = selectedGameEvents
      .map((event) => ({ timeSeconds: event.startSeconds, strength: event.strength }))
      .sort((a, b) => a.timeSeconds - b.timeSeconds);
    const mergeWindow = runtimeConfig.gameBeatEditorMergeWindowSeconds;
    const merged: BeatPoint[] = [];
    for (const beat of sorted) {
      const previous = merged[merged.length - 1];
      if (!previous || beat.timeSeconds - previous.timeSeconds > mergeWindow) {
        merged.push({
          timeSeconds: Math.max(0, beat.timeSeconds),
          strength: Math.max(0, Math.min(1, beat.strength))
        });
        continue;
      }
      if (beat.strength > previous.strength) {
        previous.timeSeconds = beat.timeSeconds;
      }
      previous.strength = Math.max(previous.strength, beat.strength);
    }
    return merged;
  }, [selectedGameEvents]);

  const selectedGameNotes = useMemo(() => {
    return selectedGameEvents
      .map((event) => ({
        timeSeconds: Math.max(0, event.startSeconds),
        endSeconds: Math.max(event.startSeconds, event.endSeconds),
        strength: Math.max(0, Math.min(1, event.strength)),
        source: event.source
      }))
      .sort((a, b) => a.timeSeconds - b.timeSeconds);
  }, [selectedGameEvents]);

  const saveSelectedGameBeats = async (): Promise<void> => {
    if (!selectedId) {
      return;
    }
    setSaveGameBeatsState({ status: "saving", message: "Saving selected game beats..." });
    try {
      const response = await fetch(`${apiBaseUrl}/api/beats/${encodeURIComponent(selectedId)}/game-beats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameMode: selectedGameMode,
          difficulty: selectedDifficulty,
          gameBeats: selectedGameBeats,
          gameNotes: selectedGameNotes,
          gameBeatSelections: gameBeatSelections.map((selection) => ({
            source: selection.source,
            startSeconds: selection.startSeconds,
            endSeconds: selection.endSeconds,
            minStrength: laneStrengthThresholds[selection.source] ?? 0
          })),
          gameBeatConfig: {
            mergeWindowSeconds: runtimeConfig.gameBeatEditorMergeWindowSeconds,
            laneStrengthThresholds,
            analysisOverrides: normalizeAnalysisOverrides(analysisOverrides)
          }
        })
      });
      const payload = (await response.json()) as { error?: string; gameBeatCount?: number };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save selected game beats.");
      }
      setSaveGameBeatsState({
        status: "saved",
        message: `Saved ${payload.gameBeatCount ?? selectedGameBeats.length} ${selectedGameMode} ${selectedDifficulty} game beats.`
      });
      const detail = await fetchJson<{ ok: boolean; entry: SavedBeatEntry }>(
        `${apiBaseUrl}/api/beats/${encodeURIComponent(selectedId)}`
      );
      setSelectedEntry(detail.entry);
    } catch (error) {
      setSaveGameBeatsState({
        status: "failed",
        message: error instanceof Error ? error.message : "Failed to save selected game beats."
      });
    }
  };

  const playheadX = toX(
    Math.max(0, Math.min(currentTimeSeconds, durationSeconds)),
    durationSeconds,
    chartWidth
  );
  const sourceLanes = useMemo(() => {
    const lanes = Array.from(new Set(displayedSourceEvents.map((event) => event.source)));
    return sortSourceLabels(lanes);
  }, [displayedSourceEvents]);
  const availableGameModes = useMemo(
    () => getAvailableGameModes(selectedEntry),
    [selectedEntry]
  );
  const availableDifficulties = useMemo(
    () => getAvailableDifficulties(selectedEntry, selectedGameMode),
    [selectedEntry, selectedGameMode]
  );
  const currentDifficultyBeatCount = useMemo(
    () => getModeDifficultyBeatCount(selectedEntry, selectedGameMode, selectedDifficulty),
    [selectedDifficulty, selectedEntry, selectedGameMode]
  );
  const laneGap = sourceLanes.length > 18 ? 22 : sourceLanes.length > 10 ? 30 : 40;
  const chartHeight = Math.max(
    260,
    PADDING_TOP + PADDING_BOTTOM + LANES_TOP + Math.max(1, sourceLanes.length) * laneGap + 20
  );
  const segmentWidth = sourceLanes.length > 18 ? 4 : sourceLanes.length > 10 ? 5 : 7;
  const separationStatusLabel = useMemo(() => {
    if (loadingSeparatedSources) {
      return "loading stems";
    }
    if (!separationState) {
      return "idle";
    }
    const details = [separationState.message, separationState.errorCode]
      .filter((part) => Boolean(part))
      .join(" | ");
    return details ? `${separationState.status}: ${details}` : separationState.status;
  }, [loadingSeparatedSources, separationState]);
  const analysisStatusLabel = useMemo(() => {
    if (loadingAnalysisResult) {
      return "loading analysis result";
    }
    if (!analysisState) {
      return "idle";
    }
    const details = [analysisState.message, analysisState.errorCode]
      .filter((part) => Boolean(part))
      .join(" | ");
    return details ? `${analysisState.status}: ${details}` : analysisState.status;
  }, [analysisState, loadingAnalysisResult]);

  const modeHint = useMemo(() => {
    if (displayedSourceEvents.length > 0) {
      return null;
    }
    return "No hybrid events to display yet. Run Hybrid Analysis for this entry.";
  }, [displayedSourceEvents.length]);

  return (
    <section className="panel saved-panel">
      <div className="saved-header">
        <h2>Saved Entries</h2>
        <button type="button" onClick={() => refreshList()} disabled={loadingList}>
          {loadingList ? "Refreshing..." : "Refresh List"}
        </button>
      </div>

      {listError && <p className="error">{listError}</p>}

      {summaries.length === 0 ? (
        <p>No saved sessions yet.</p>
      ) : (
        <label className="saved-select">
          Select Saved Session
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {summaries.map((summary) => (
              <option key={summary.id} value={summary.id}>
                {summary.entryName} (
                {summary.separatedSourceCount && summary.separatedSourceCount > 0
                  ? `${summary.separatedSourceCount} stems`
                  : `${summary.sourceEventCount ?? summary.majorBeatCount} events`}
                )
              </option>
            ))}
          </select>
        </label>
      )}

      {loadingEntry && <p>Loading selected session...</p>}
      {entryError && <p className="error">{entryError}</p>}

      {selectedEntry && !loadingEntry && (
        <div className="saved-playback">
          <div className="separation-controls">
            <button type="button" onClick={() => startHybridAnalysis()} disabled={isStartingAnalysis}>
              {isStartingAnalysis ? "Starting..." : "Run Hybrid Analysis"}
            </button>
            <span>
              Hybrid analysis status: {analysisStatusLabel}
            </span>
            <span>Saved chart beats: {currentDifficultyBeatCount}</span>
            <span>
              Available modes: {availableGameModes.length > 0 ? availableGameModes.join(", ") : "none"}
            </span>
            <span>
              Available difficulties: {availableDifficulties.length > 0 ? availableDifficulties.join(", ") : "none"}
            </span>
            <span>Chart data: Hybrid Beats + Sustains</span>
          </div>
          <div className="editor-grid">
            <fieldset className="editor-fieldset">
              <legend>Hybrid Analyze Controls</legend>
              <button type="button" onClick={() => startHybridAnalysis()} disabled={isStartingAnalysis}>
                {isStartingAnalysis ? "Starting..." : "Apply Controls + Re-Run Hybrid Analysis"}
              </button>
              <p className="editor-help">
                After changing values here, click this button to update the hybrid timeline with the new analysis.
              </p>
              <label>
                <span className="control-label">
                  Hop Length
                  <HelpBubble text="Time resolution of analysis frames. Lower values capture tighter timing, higher values are smoother." />
                </span>
                <input
                  type="number"
                  min={64}
                  step={1}
                  value={analysisOverrides.hopLength}
                  onChange={(event) =>
                    updateAnalysisOverride("hopLength", Number.parseFloat(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Onset Min Strength
                  <HelpBubble text="Minimum beat energy required to include an onset. Higher value removes weaker hits." />
                </span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={analysisOverrides.onsetMinStrength}
                  onChange={(event) =>
                    updateAnalysisOverride("onsetMinStrength", Number.parseFloat(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Onset Min Distance (s)
                  <HelpBubble text="Minimum spacing between detected beats. Increase to reduce dense/duplicate hits." />
                </span>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={analysisOverrides.onsetMinDistanceSeconds}
                  onChange={(event) =>
                    updateAnalysisOverride("onsetMinDistanceSeconds", Number.parseFloat(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Adaptive Window (s)
                  <HelpBubble text="Local window used to estimate dynamic threshold around each candidate peak." />
                </span>
                <input
                  type="number"
                  min={0.05}
                  step={0.01}
                  value={analysisOverrides.adaptiveWindowSeconds}
                  onChange={(event) =>
                    updateAnalysisOverride("adaptiveWindowSeconds", Number.parseFloat(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Gap Trigger (s)
                  <HelpBubble text="If spacing between strong peaks is larger than this, the analyzer may insert a permissive peak in the gap." />
                </span>
                <input
                  type="number"
                  min={0.02}
                  step={0.01}
                  value={analysisOverrides.gapTriggerSeconds}
                  onChange={(event) =>
                    updateAnalysisOverride("gapTriggerSeconds", Number.parseFloat(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Sustain Min Duration (s)
                  <HelpBubble text="Only sustain notes at or above this duration are shown and used when saving game beats." />
                </span>
                <input
                  type="number"
                  min={0.02}
                  step={0.01}
                  value={analysisOverrides.sustainMinDurationSeconds}
                  onChange={(event) =>
                    updateAnalysisOverride(
                      "sustainMinDurationSeconds",
                      Number.parseFloat(event.target.value)
                    )
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Sustain Merge Gap (s)
                  <HelpBubble text="Merge neighboring sustain segments when the silence between them is at or below this gap." />
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={analysisOverrides.sustainMergeGapSeconds}
                  onChange={(event) =>
                    updateAnalysisOverride(
                      "sustainMergeGapSeconds",
                      Number.parseFloat(event.target.value)
                    )
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Sustain Bridge Floor
                  <HelpBubble text="Energy requirement for merging across a gap. Lower merges more aggressively; higher keeps segments separate." />
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={analysisOverrides.sustainBridgeFloor}
                  onChange={(event) =>
                    updateAnalysisOverride("sustainBridgeFloor", Number.parseFloat(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Sustain Max Pitch Jump (st)
                  <HelpBubble text="Maximum semitone jump allowed when merging pitched sustain notes. Lower keeps different tones separate." />
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={analysisOverrides.sustainMaxPitchJumpSemitones}
                  onChange={(event) =>
                    updateAnalysisOverride(
                      "sustainMaxPitchJumpSemitones",
                      Number.parseFloat(event.target.value)
                    )
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Sustain Split On Pitch Change
                  <HelpBubble text="When enabled, any detected pitch change forces a new sustain segment instead of merging." />
                </span>
                <input
                  type="checkbox"
                  checked={analysisOverrides.sustainSplitOnPitchChange}
                  onChange={(event) =>
                    updateAnalysisToggle("sustainSplitOnPitchChange", event.target.checked)
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Sustain Min Pitch Confidence
                  <HelpBubble text="Filters out weak/uncertain pitch notes before sustain processing. Higher values are stricter." />
                </span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={analysisOverrides.sustainMinPitchConfidence}
                  onChange={(event) =>
                    updateAnalysisOverride(
                      "sustainMinPitchConfidence",
                      Number.parseFloat(event.target.value)
                    )
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Continuous Pitch Split
                  <HelpBubble text="Uses a frame-level pitch contour to split sustains when detected pitch shifts enough within one note span." />
                </span>
                <input
                  type="checkbox"
                  checked={analysisOverrides.sustainEnableContinuousPitchSplit}
                  onChange={(event) =>
                    updateAnalysisToggle("sustainEnableContinuousPitchSplit", event.target.checked)
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Pitch Split Threshold (st)
                  <HelpBubble text="Semitone movement required to split a sustain segment using the continuous contour." />
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.05}
                  value={analysisOverrides.sustainPitchSplitThresholdSemitones}
                  onChange={(event) =>
                    updateAnalysisOverride(
                      "sustainPitchSplitThresholdSemitones",
                      Number.parseFloat(event.target.value)
                    )
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Pitch Split Min Segment (s)
                  <HelpBubble text="Minimum sustain segment length allowed when contour splitting; shorter pieces are merged back." />
                </span>
                <input
                  type="number"
                  min={0.02}
                  step={0.01}
                  value={analysisOverrides.sustainPitchSplitMinSegmentSeconds}
                  onChange={(event) =>
                    updateAnalysisOverride(
                      "sustainPitchSplitMinSegmentSeconds",
                      Number.parseFloat(event.target.value)
                    )
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Pitch Split Min Voiced Prob
                  <HelpBubble text="Minimum voiced probability used from the contour while deciding pitch-change boundaries." />
                </span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={analysisOverrides.sustainPitchSplitMinVoicedProbability}
                  onChange={(event) =>
                    updateAnalysisOverride(
                      "sustainPitchSplitMinVoicedProbability",
                      Number.parseFloat(event.target.value)
                    )
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Strict K
                  <HelpBubble text="Stricter threshold multiplier. Higher value keeps only stronger peaks." />
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={analysisOverrides.strictK}
                  onChange={(event) =>
                    updateAnalysisOverride("strictK", Number.parseFloat(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Permissive K
                  <HelpBubble text="Looser threshold used for gap-fill candidates. Lower values allow more fallback peaks." />
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={analysisOverrides.permissiveK}
                  onChange={(event) =>
                    updateAnalysisOverride("permissiveK", Number.parseFloat(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="control-label">
                  Low Min/Max Hz
                  <HelpBubble text="Frequency range for the low band. Events in this range feed the low lane." />
                </span>
                <div className="inline-pair">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={analysisOverrides.lowFmin}
                    onChange={(event) =>
                      updateAnalysisOverride("lowFmin", Number.parseFloat(event.target.value))
                    }
                  />
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={analysisOverrides.lowFmax}
                    onChange={(event) =>
                      updateAnalysisOverride("lowFmax", Number.parseFloat(event.target.value))
                    }
                  />
                </div>
              </label>
              <label>
                <span className="control-label">
                  Mid Min/Max Hz
                  <HelpBubble text="Frequency range for the mid band." />
                </span>
                <div className="inline-pair">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={analysisOverrides.midFmin}
                    onChange={(event) =>
                      updateAnalysisOverride("midFmin", Number.parseFloat(event.target.value))
                    }
                  />
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={analysisOverrides.midFmax}
                    onChange={(event) =>
                      updateAnalysisOverride("midFmax", Number.parseFloat(event.target.value))
                    }
                  />
                </div>
              </label>
              <label>
                <span className="control-label">
                  High Min/Max Hz
                  <HelpBubble text="Frequency range for the high band." />
                </span>
                <div className="inline-pair">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={analysisOverrides.highFmin}
                    onChange={(event) =>
                      updateAnalysisOverride("highFmin", Number.parseFloat(event.target.value))
                    }
                  />
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={analysisOverrides.highFmax}
                    onChange={(event) =>
                      updateAnalysisOverride("highFmax", Number.parseFloat(event.target.value))
                    }
                  />
                </div>
              </label>
              <label>
                <span className="control-label">
                  Band Weights (L/M/H)
                  <HelpBubble text="How strongly each band contributes to combined beat detection. Increase one band to prioritize it." />
                </span>
                <div className="inline-triple">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={analysisOverrides.lowWeight}
                    onChange={(event) =>
                      updateAnalysisOverride("lowWeight", Number.parseFloat(event.target.value))
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={analysisOverrides.midWeight}
                    onChange={(event) =>
                      updateAnalysisOverride("midWeight", Number.parseFloat(event.target.value))
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={analysisOverrides.highWeight}
                    onChange={(event) =>
                      updateAnalysisOverride("highWeight", Number.parseFloat(event.target.value))
                    }
                  />
                </div>
              </label>
            </fieldset>
            <fieldset className="editor-fieldset">
              <legend>Game Beat Selector</legend>
              <p className="editor-help">
                Choose a game mode and difficulty, set lane strength filters, run hybrid analysis, then drag on a lane to add a time range.
              </p>
              <div className="difficulty-selector">
                <label>
                  <span className="control-label">Game Mode</span>
                  <select
                    value={selectedGameMode}
                    onChange={(event) => setSelectedGameMode(event.currentTarget.value as GameMode)}
                  >
                    {GAME_MODES.map((gameMode) => (
                      <option key={gameMode} value={gameMode}>
                        {gameMode}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {HYBRID_EDITOR_SOURCES.map((source) => (
                <label key={source}>
                  <span className="control-label">
                    {formatSourceLabel(source)} Min Strength
                    <HelpBubble text="Minimum event strength required from this lane when building saved game beats." />
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={laneStrengthThresholds[source] ?? 0}
                    onChange={(event) => updateLaneStrength(source, Number.parseFloat(event.target.value))}
                  />
                </label>
              ))}
              <div className="difficulty-selector">
                <label>
                  <span className="control-label">Difficulty</span>
                  <select
                    value={selectedDifficulty}
                    onChange={(event) => setSelectedDifficulty(event.currentTarget.value as GameDifficulty)}
                  >
                    {GAME_DIFFICULTIES.map((difficulty) => (
                      <option key={difficulty} value={difficulty}>
                        {difficulty}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="small">
                Current saved count: {currentDifficultyBeatCount}
                {selectedGameMode === "step_arrows" &&
                selectedDifficulty === "normal" &&
                selectedEntry.hasLegacyNormalChartOnly
                  ? " | legacy flat chart currently resolves as normal"
                  : ""}
              </p>
              <div className="selection-actions">
                <button type="button" onClick={() => clearSelections()} disabled={gameBeatSelections.length === 0}>
                  Clear Selections
                </button>
                <button
                  type="button"
                  onClick={() => saveSelectedGameBeats()}
                  disabled={selectedGameBeats.length === 0 || saveGameBeatsState.status === "saving"}
                >
                  {saveGameBeatsState.status === "saving"
                    ? "Saving..."
                    : `Save Selected as ${selectedGameMode} ${selectedDifficulty} Game Beats (${selectedGameBeats.length})`}
                </button>
              </div>
              {saveGameBeatsState.status !== "idle" && (
                <p className={saveGameBeatsState.status === "failed" ? "error" : "save-status"}>
                  {saveGameBeatsState.message}
                </p>
              )}
              <div className="selection-list">
                {gameBeatSelections.map((selection) => (
                  <div key={selection.id} className="selection-chip">
                    <span>
                      {formatSourceLabel(selection.source)} | {selection.startSeconds.toFixed(3)}s -
                      {selection.endSeconds.toFixed(3)}s
                    </span>
                    <button type="button" onClick={() => removeSelection(selection.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </fieldset>
          </div>
          {separationLogText && <pre className="separation-log">{separationLogText}</pre>}
          <div className="source-legend">
            {sourceLanes.map((source) => (
              <span
                key={source}
                className="source-chip"
                style={{ backgroundColor: getSourceColor(source) }}
              >
                {formatSourceLabel(source)}
              </span>
            ))}
          </div>
          <div className="saved-controls">
            <button type="button" onClick={() => togglePlay()}>
              {playing ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(durationSeconds, 0)}
              step={0.001}
              value={Math.min(currentTimeSeconds, durationSeconds)}
              onChange={(event) => handleSeek(Number.parseFloat(event.target.value))}
            />
            <span>
              {currentTimeSeconds.toFixed(3)}s / {durationSeconds.toFixed(3)}s
            </span>
          </div>
          {modeHint ? <p className="small">{modeHint}</p> : null}

          <div className="chart-wrapper" ref={chartWrapperRef}>
            <svg
              ref={chartSvgRef}
              width={chartWidth}
              height={chartHeight}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              role="img"
              aria-label="Saved major beat timeline chart"
              onPointerDown={(event) => startSelectionDrag(event)}
              onPointerMove={(event) => moveSelectionDrag(event)}
              onPointerUp={(event) => endSelectionDrag(event)}
              onPointerCancel={(event) => endSelectionDrag(event)}
            >
              <line
                x1={PADDING_LEFT}
                y1={chartHeight - PADDING_BOTTOM}
                x2={chartWidth - PADDING_RIGHT}
                y2={chartHeight - PADDING_BOTTOM}
                className="axis"
              />
              <line
                x1={PADDING_LEFT}
                y1={PADDING_TOP}
                x2={PADDING_LEFT}
                y2={chartHeight - PADDING_BOTTOM}
                className="axis"
              />
              {sourceLanes.map((source) => (
                <g key={source}>
                  <line
                    x1={PADDING_LEFT}
                    y1={laneY(source, sourceLanes)}
                    x2={chartWidth - PADDING_RIGHT}
                    y2={laneY(source, sourceLanes)}
                    className="source-lane"
                  />
                  <text
                    x={PADDING_LEFT + 6}
                    y={laneY(source, sourceLanes) - 6}
                    className="lane-label"
                  >
                    {formatSourceLabel(source)}
                  </text>
                </g>
              ))}
              {displayedSourceEvents.map((event, index) => {
                const x1 = toX(event.startSeconds, durationSeconds, chartWidth);
                const x2 = toX(event.endSeconds, durationSeconds, chartWidth);
                const y = laneY(event.source, sourceLanes);
                const isActive =
                  currentTimeSeconds >= event.startSeconds - activeWindowSeconds &&
                  currentTimeSeconds <= event.endSeconds + activeWindowSeconds;
                const isPassed = currentTimeSeconds > event.endSeconds + activeWindowSeconds;
                const className = isActive
                  ? "source-segment active"
                  : isPassed
                    ? "source-segment passed"
                    : "source-segment";
                return (
                  <line
                    key={`${event.source}-${event.startSeconds}-${index}`}
                    x1={x1}
                    y1={y}
                    x2={Math.max(x2, x1 + 1)}
                    y2={y}
                    className={className}
                    style={{
                      opacity: 0.25 + event.strength * 0.75,
                      stroke: getSourceColor(event.source),
                      strokeWidth: isActive ? segmentWidth + 2 : segmentWidth
                    }}
                  />
                );
              })}
              {[...gameBeatSelections, ...(dragSelection ? [dragSelection] : [])].map((selection) => {
                if (!sourceLanes.includes(selection.source)) {
                  return null;
                }
                const start = Math.min(selection.startSeconds, selection.endSeconds);
                const end = Math.max(selection.startSeconds, selection.endSeconds);
                const x1 = toX(start, durationSeconds, chartWidth);
                const x2 = toX(end, durationSeconds, chartWidth);
                const y = laneY(selection.source, sourceLanes) - Math.max(8, laneGap * 0.35);
                const height = Math.max(16, laneGap * 0.7);
                return (
                  <rect
                    key={`sel-${selection.id}`}
                    x={Math.min(x1, x2)}
                    y={y}
                    width={Math.max(1, Math.abs(x2 - x1))}
                    height={height}
                    rx={8}
                    className="selected-range-box"
                  />
                );
              })}
              <line
                x1={playheadX}
                y1={PADDING_TOP}
                x2={playheadX}
                y2={chartHeight - PADDING_BOTTOM}
                className="playhead"
              />
              <text x={PADDING_LEFT} y={chartHeight - 8} className="axis-label">
                0s
              </text>
              <text x={chartWidth - PADDING_RIGHT - 56} y={chartHeight - 8} className="axis-label">
                {durationSeconds.toFixed(2)}s
              </text>
            </svg>
          </div>
        </div>
      )}
    </section>
  );
}
