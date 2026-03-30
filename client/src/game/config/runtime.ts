export interface RuntimeConfig {
  appName: string;
  beatWindowSize: number;
  beatHopSize: number;
  beatSmoothingAlpha: number;
  audioOutputLatencySeconds: number;
  peakMinProminence: number;
  peakMinStrength: number;
  peakMinDistancePoints: number;
  beatApiBaseUrl: string;
  majorBeatActiveWindowSeconds: number;
  sourceDrumsThreshold: number;
  sourceBassThreshold: number;
  sourceOtherThreshold: number;
  sourceDrumsMinDurationSeconds: number;
  sourceBassMinDurationSeconds: number;
  sourceOtherMinDurationSeconds: number;
  sourceSyntheticCount: number;
  sourceTransientHopScale: number;
  sourceAdaptiveThresholdWindow: number;
  sourceMinInterOnsetSeconds: number;
  sourceBassDominanceRatio: number;
  sourceBassMaxSustainSeconds: number;
  sourceDrumTransientGain: number;
  sourceDrumTriggerFloor: number;
  sourceReassignMargin: number;
  sourceStemHarmonicBands: number;
  sourceStemTransientBands: number;
  sourceStemBaseThreshold: number;
  sourceStemTransientBoost: number;
  sourceStemSustainMinDurationSeconds: number;
  sourceStemTransientMinDurationSeconds: number;
  sourceStemSustainReleaseSeconds: number;
  sourceStemMergeGapSeconds: number;
  sourceStemMaxSourcesPerStem: number;
  sourceStemMinAverageStrengthPerSource: number;
  sourceStemMinEventsPerSource: number;
  sourceTrackerMaxGapSeconds: number;
  sourceTrackerBandWeight: number;
  sourceTrackerStemSwitchPenalty: number;
  sourceTrackerMinEventsPerTrack: number;
  stemPeakSmoothingWindow: number;
  stemPeakMinStrength: number;
  stemPeakMinProminence: number;
  stemPeakMinDistancePoints: number;
  hybridAnalysisHopLengthDefault: number;
  hybridAnalysisOnsetMinStrengthDefault: number;
  hybridAnalysisOnsetMinDistanceSecondsDefault: number;
  hybridAnalysisAdaptiveWindowSecondsDefault: number;
  hybridAnalysisStrictKDefault: number;
  hybridAnalysisPermissiveKDefault: number;
  hybridAnalysisGapTriggerSecondsDefault: number;
  hybridAnalysisSustainMinDurationSecondsDefault: number;
  hybridAnalysisSustainMergeGapSecondsDefault: number;
  hybridAnalysisSustainBridgeFloorDefault: number;
  hybridAnalysisSustainMaxPitchJumpSemitonesDefault: number;
  hybridAnalysisSustainSplitOnPitchChangeDefault: boolean;
  hybridAnalysisSustainMinPitchConfidenceDefault: number;
  hybridAnalysisSustainEnableContinuousPitchSplitDefault: boolean;
  hybridAnalysisSustainPitchSplitThresholdSemitonesDefault: number;
  hybridAnalysisSustainPitchSplitMinSegmentSecondsDefault: number;
  hybridAnalysisSustainPitchSplitMinVoicedProbabilityDefault: number;
  hybridAnalysisLowFminDefault: number;
  hybridAnalysisLowFmaxDefault: number;
  hybridAnalysisMidFminDefault: number;
  hybridAnalysisMidFmaxDefault: number;
  hybridAnalysisHighFminDefault: number;
  hybridAnalysisHighFmaxDefault: number;
  hybridAnalysisLowWeightDefault: number;
  hybridAnalysisMidWeightDefault: number;
  hybridAnalysisHighWeightDefault: number;
  gameBeatEditorDefaultMinStrength: number;
  gameBeatEditorMergeWindowSeconds: number;
  gameApproachSeconds: number;
  gamePerfectWindowSeconds: number;
  gameGreatWindowSeconds: number;
  gameGoodWindowSeconds: number;
  gamePoorWindowSeconds: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseClampedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export const runtimeConfig: RuntimeConfig = {
  appName: import.meta.env.VITE_APP_NAME ?? "Faceless Game Builder",
  beatWindowSize: parsePositiveInt(import.meta.env.VITE_BEAT_WINDOW_SIZE, 1024),
  beatHopSize: parsePositiveInt(import.meta.env.VITE_BEAT_HOP_SIZE, 512),
  beatSmoothingAlpha: parseClampedNumber(
    import.meta.env.VITE_BEAT_SMOOTHING_ALPHA,
    0.35,
    0,
    1
  ),
  audioOutputLatencySeconds: parseClampedNumber(
    import.meta.env.VITE_AUDIO_OUTPUT_LATENCY_SECONDS,
    0.12,
    0,
    1
  ),
  peakMinProminence: parseClampedNumber(
    import.meta.env.VITE_PEAK_MIN_PROMINENCE,
    0.18,
    0,
    1
  ),
  peakMinStrength: parseClampedNumber(import.meta.env.VITE_PEAK_MIN_STRENGTH, 0.5, 0, 1),
  peakMinDistancePoints: parsePositiveInt(import.meta.env.VITE_PEAK_MIN_DISTANCE_POINTS, 8),
  beatApiBaseUrl: import.meta.env.VITE_BEAT_API_BASE_URL ?? "/api/game",
  majorBeatActiveWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_MAJOR_BEAT_ACTIVE_WINDOW_SECONDS,
    0.03,
    0.005,
    0.2
  ),
  sourceDrumsThreshold: parseClampedNumber(import.meta.env.VITE_SOURCE_DRUMS_THRESHOLD, 0.22, 0, 1),
  sourceBassThreshold: parseClampedNumber(import.meta.env.VITE_SOURCE_BASS_THRESHOLD, 0.32, 0, 1),
  sourceOtherThreshold: parseClampedNumber(import.meta.env.VITE_SOURCE_OTHER_THRESHOLD, 0.18, 0, 1),
  sourceDrumsMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_DRUMS_MIN_DURATION_SECONDS,
    0.05,
    0.02,
    2
  ),
  sourceBassMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_BASS_MIN_DURATION_SECONDS,
    0.18,
    0.03,
    5
  ),
  sourceOtherMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_OTHER_MIN_DURATION_SECONDS,
    0.14,
    0.03,
    5
  ),
  sourceSyntheticCount: parsePositiveInt(import.meta.env.VITE_SOURCE_SYNTHETIC_COUNT, 4),
  sourceTransientHopScale: parsePositiveInt(import.meta.env.VITE_SOURCE_TRANSIENT_HOP_SCALE, 2),
  sourceAdaptiveThresholdWindow: parsePositiveInt(
    import.meta.env.VITE_SOURCE_ADAPTIVE_THRESHOLD_WINDOW,
    16
  ),
  sourceMinInterOnsetSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_MIN_INTER_ONSET_SECONDS,
    0.03,
    0.005,
    0.3
  ),
  sourceBassDominanceRatio: parseClampedNumber(
    import.meta.env.VITE_SOURCE_BASS_DOMINANCE_RATIO,
    1.4,
    1,
    4
  ),
  sourceBassMaxSustainSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_BASS_MAX_SUSTAIN_SECONDS,
    0.7,
    0.05,
    8
  ),
  sourceDrumTransientGain: parseClampedNumber(
    import.meta.env.VITE_SOURCE_DRUM_TRANSIENT_GAIN,
    1.8,
    0.2,
    5
  ),
  sourceDrumTriggerFloor: parseClampedNumber(
    import.meta.env.VITE_SOURCE_DRUM_TRIGGER_FLOOR,
    0.08,
    0,
    1
  ),
  sourceReassignMargin: parseClampedNumber(
    import.meta.env.VITE_SOURCE_REASSIGN_MARGIN,
    0.1,
    0,
    1
  ),
  sourceStemHarmonicBands: parsePositiveInt(import.meta.env.VITE_SOURCE_STEM_HARMONIC_BANDS, 8),
  sourceStemTransientBands: parsePositiveInt(import.meta.env.VITE_SOURCE_STEM_TRANSIENT_BANDS, 8),
  sourceStemBaseThreshold: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_BASE_THRESHOLD,
    0.1,
    0.01,
    0.95
  ),
  sourceStemTransientBoost: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_TRANSIENT_BOOST,
    1.65,
    0.5,
    5
  ),
  sourceStemSustainMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_SUSTAIN_MIN_DURATION_SECONDS,
    0.16,
    0.02,
    8
  ),
  sourceStemTransientMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_TRANSIENT_MIN_DURATION_SECONDS,
    0.03,
    0.01,
    1
  ),
  sourceStemSustainReleaseSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_SUSTAIN_RELEASE_SECONDS,
    0.08,
    0,
    1.5
  ),
  sourceStemMergeGapSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_MERGE_GAP_SECONDS,
    0.09,
    0,
    1
  ),
  sourceStemMaxSourcesPerStem: parsePositiveInt(
    import.meta.env.VITE_SOURCE_STEM_MAX_SOURCES_PER_STEM,
    4
  ),
  sourceStemMinAverageStrengthPerSource: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_MIN_AVERAGE_STRENGTH_PER_SOURCE,
    0.14,
    0.01,
    1
  ),
  sourceStemMinEventsPerSource: parsePositiveInt(
    import.meta.env.VITE_SOURCE_STEM_MIN_EVENTS_PER_SOURCE,
    3
  ),
  sourceTrackerMaxGapSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_TRACKER_MAX_GAP_SECONDS,
    0.9,
    0.05,
    8
  ),
  sourceTrackerBandWeight: parseClampedNumber(
    import.meta.env.VITE_SOURCE_TRACKER_BAND_WEIGHT,
    0.08,
    0,
    1
  ),
  sourceTrackerStemSwitchPenalty: parseClampedNumber(
    import.meta.env.VITE_SOURCE_TRACKER_STEM_SWITCH_PENALTY,
    0.22,
    0,
    2
  ),
  sourceTrackerMinEventsPerTrack: parsePositiveInt(
    import.meta.env.VITE_SOURCE_TRACKER_MIN_EVENTS_PER_TRACK,
    2
  ),
  stemPeakSmoothingWindow: parsePositiveInt(
    import.meta.env.VITE_STEM_PEAK_SMOOTHING_WINDOW,
    3
  ),
  stemPeakMinStrength: parseClampedNumber(
    import.meta.env.VITE_STEM_PEAK_MIN_STRENGTH,
    0.03,
    0,
    1
  ),
  stemPeakMinProminence: parseClampedNumber(
    import.meta.env.VITE_STEM_PEAK_MIN_PROMINENCE,
    0.01,
    0,
    1
  ),
  stemPeakMinDistancePoints: parsePositiveInt(
    import.meta.env.VITE_STEM_PEAK_MIN_DISTANCE_POINTS,
    3
  ),
  hybridAnalysisHopLengthDefault: parsePositiveInt(
    import.meta.env.VITE_HYBRID_ANALYSIS_HOP_LENGTH_DEFAULT,
    512
  ),
  hybridAnalysisOnsetMinStrengthDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_ONSET_MIN_STRENGTH_DEFAULT,
    0.1,
    0,
    1
  ),
  hybridAnalysisOnsetMinDistanceSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_ONSET_MIN_DISTANCE_SECONDS_DEFAULT,
    0.11,
    0.01,
    2
  ),
  hybridAnalysisAdaptiveWindowSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_ADAPTIVE_WINDOW_SECONDS_DEFAULT,
    0.45,
    0.05,
    5
  ),
  hybridAnalysisStrictKDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_STRICT_K_DEFAULT,
    1.15,
    0,
    4
  ),
  hybridAnalysisPermissiveKDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_PERMISSIVE_K_DEFAULT,
    0.62,
    0,
    4
  ),
  hybridAnalysisGapTriggerSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_GAP_TRIGGER_SECONDS_DEFAULT,
    0.24,
    0.02,
    4
  ),
  hybridAnalysisSustainMinDurationSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_MIN_DURATION_SECONDS_DEFAULT,
    0.08,
    0.02,
    4
  ),
  hybridAnalysisSustainMergeGapSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_MERGE_GAP_SECONDS_DEFAULT,
    0.14,
    0,
    2
  ),
  hybridAnalysisSustainBridgeFloorDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_BRIDGE_FLOOR_DEFAULT,
    0.25,
    0,
    2
  ),
  hybridAnalysisSustainMaxPitchJumpSemitonesDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_MAX_PITCH_JUMP_SEMITONES_DEFAULT,
    3.0,
    0,
    24
  ),
  hybridAnalysisSustainSplitOnPitchChangeDefault: parseBoolean(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_SPLIT_ON_PITCH_CHANGE_DEFAULT,
    true
  ),
  hybridAnalysisSustainMinPitchConfidenceDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_MIN_PITCH_CONFIDENCE_DEFAULT,
    0.45,
    0,
    1
  ),
  hybridAnalysisSustainEnableContinuousPitchSplitDefault: parseBoolean(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_ENABLE_CONTINUOUS_PITCH_SPLIT_DEFAULT,
    true
  ),
  hybridAnalysisSustainPitchSplitThresholdSemitonesDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_PITCH_SPLIT_THRESHOLD_SEMITONES_DEFAULT,
    0.75,
    0,
    24
  ),
  hybridAnalysisSustainPitchSplitMinSegmentSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_PITCH_SPLIT_MIN_SEGMENT_SECONDS_DEFAULT,
    0.2,
    0.02,
    10
  ),
  hybridAnalysisSustainPitchSplitMinVoicedProbabilityDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_PITCH_SPLIT_MIN_VOICED_PROBABILITY_DEFAULT,
    0.7,
    0,
    1
  ),
  hybridAnalysisLowFminDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_LOW_FMIN_DEFAULT,
    20,
    1,
    24000
  ),
  hybridAnalysisLowFmaxDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_LOW_FMAX_DEFAULT,
    5000,
    2,
    24000
  ),
  hybridAnalysisMidFminDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_MID_FMIN_DEFAULT,
    5000,
    2,
    24000
  ),
  hybridAnalysisMidFmaxDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_MID_FMAX_DEFAULT,
    7000,
    3,
    24000
  ),
  hybridAnalysisHighFminDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_HIGH_FMIN_DEFAULT,
    7000,
    3,
    24000
  ),
  hybridAnalysisHighFmaxDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_HIGH_FMAX_DEFAULT,
    12000,
    4,
    24000
  ),
  hybridAnalysisLowWeightDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_LOW_WEIGHT_DEFAULT,
    1.15,
    0,
    8
  ),
  hybridAnalysisMidWeightDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_MID_WEIGHT_DEFAULT,
    1.0,
    0,
    8
  ),
  hybridAnalysisHighWeightDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_HIGH_WEIGHT_DEFAULT,
    0.9,
    0,
    8
  ),
  gameBeatEditorDefaultMinStrength: parseClampedNumber(
    import.meta.env.VITE_GAME_BEAT_EDITOR_DEFAULT_MIN_STRENGTH,
    0.08,
    0,
    1
  ),
  gameBeatEditorMergeWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_BEAT_EDITOR_MERGE_WINDOW_SECONDS,
    0.03,
    0.001,
    0.2
  ),
  gameApproachSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_APPROACH_SECONDS,
    1.8,
    0.4,
    5
  ),
  gamePerfectWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_WINDOW_PERFECT_SECONDS,
    0.04,
    0.005,
    0.2
  ),
  gameGreatWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_WINDOW_GREAT_SECONDS,
    0.08,
    0.01,
    0.3
  ),
  gameGoodWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_WINDOW_GOOD_SECONDS,
    0.13,
    0.02,
    0.4
  ),
  gamePoorWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_WINDOW_POOR_SECONDS,
    0.2,
    0.03,
    0.6
  )
};
