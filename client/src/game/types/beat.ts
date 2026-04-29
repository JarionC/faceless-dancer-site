export interface BeatPoint {
  timeSeconds: number;
  strength: number;
}

export type SourceName = string;

export interface SourceEvent {
  source: SourceName;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  strength: number;
}

export interface StoredAudioInfo {
  fileName: string;
  mimeType: string;
}

export interface SeparatedSourceMeta {
  label: string;
  fileName: string;
}

export interface LyricWord {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface LyricSegment {
  id: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  words: LyricWord[];
}

export interface EntryLyrics {
  enabled: boolean;
  source: "extracted" | "edited";
  provider: string;
  model: string;
  language: string | null;
  languageProbability: number | null;
  updatedAtIso: string;
  segments: LyricSegment[];
}

export interface SavedBeatSummary {
  id: string;
  savedAtIso: string;
  entryName: string;
  fileName: string;
  durationSeconds: number;
  majorBeatCount: number;
  gameBeatCount?: number;
  sourceEventCount?: number;
  separatedSourceCount?: number;
  lyricsSegmentCount?: number;
  lyricsWordCount?: number;
  lyricsEnabled?: boolean;
  availableGameModes?: Array<"step_arrows" | "orb_beat" | "laser_shoot">;
  availableDifficulties?: Array<"easy" | "normal" | "hard">;
  difficultyBeatCounts?: Partial<Record<"easy" | "normal" | "hard", number>>;
  modeDifficultyBeatCounts?: Partial<
    Record<"step_arrows" | "orb_beat" | "laser_shoot", Partial<Record<"easy" | "normal" | "hard", number>>>
  >;
  hasLegacyNormalChartOnly?: boolean;
}

export interface DifficultyChart {
  gameBeats?: BeatPoint[];
  gameNotes?: Array<{
    timeSeconds: number;
    endSeconds: number;
    strength: number;
    source?: SourceName;
  }>;
  gameBeatSelections?: Array<{
    source: SourceName;
    startSeconds: number;
    endSeconds: number;
    minStrength?: number;
  }>;
  gameBeatConfig?: {
    gameMode?: "step_arrows" | "orb_beat" | "laser_shoot";
    mergeWindowSeconds?: number;
    laneStrengthThresholds?: Record<SourceName, number>;
    analysisOverrides?: Record<string, number | boolean>;
  };
  gameBeatsUpdatedAtIso?: string;
}

export interface SavedBeatEntry {
  id: string;
  savedAtIso: string;
  entry: {
    id?: string;
    name: string;
    fileName: string;
    durationSeconds: number;
  };
  audio: StoredAudioInfo;
  majorBeats: BeatPoint[];
  sourceEvents?: SourceEvent[];
  separatedSources?: SeparatedSourceMeta[];
  lyrics?: EntryLyrics;
  hybridAnalysis?: {
    storedFileName: string;
    updatedAtIso: string;
    majorBeatCount: number;
    sustainCount: number;
    algorithm?: string;
  };
  gameBeats?: BeatPoint[];
  gameNotes?: Array<{
    timeSeconds: number;
    endSeconds: number;
    strength: number;
    source?: SourceName;
  }>;
  gameBeatSelections?: Array<{
    source: SourceName;
    startSeconds: number;
    endSeconds: number;
    minStrength?: number;
  }>;
  gameBeatConfig?: {
    gameMode?: "step_arrows" | "orb_beat" | "laser_shoot";
    mergeWindowSeconds?: number;
    laneStrengthThresholds?: Record<SourceName, number>;
    analysisOverrides?: Record<string, number | boolean>;
  };
  gameBeatsUpdatedAtIso?: string;
  difficultyCharts?: Partial<Record<"easy" | "normal" | "hard", DifficultyChart>>;
  modeDifficultyCharts?: Partial<
    Record<"step_arrows" | "orb_beat" | "laser_shoot", Partial<Record<"easy" | "normal" | "hard", DifficultyChart>>>
  >;
  availableGameModes?: Array<"step_arrows" | "orb_beat" | "laser_shoot">;
  availableDifficulties?: Array<"easy" | "normal" | "hard">;
  difficultyBeatCounts?: Partial<Record<"easy" | "normal" | "hard", number>>;
  modeDifficultyBeatCounts?: Partial<
    Record<"step_arrows" | "orb_beat" | "laser_shoot", Partial<Record<"easy" | "normal" | "hard", number>>>
  >;
  hasLegacyNormalChartOnly?: boolean;
}

export interface BeatEntry {
  id: string;
  name: string;
  fileName: string;
  audioUrl: string;
  sourceFile: File;
  durationSeconds: number;
  beatData: BeatPoint[];
  peakIndices: number[];
  sourceEvents: SourceEvent[];
}
