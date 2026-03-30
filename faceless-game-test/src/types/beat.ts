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
    mergeWindowSeconds?: number;
    laneStrengthThresholds?: Record<SourceName, number>;
    analysisOverrides?: Record<string, number | boolean>;
  };
  gameBeatsUpdatedAtIso?: string;
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
