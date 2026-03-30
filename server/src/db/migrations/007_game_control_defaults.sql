CREATE TABLE IF NOT EXISTS game_control_defaults (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  analysis_overrides_json TEXT,
  lane_strength_thresholds_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO game_control_defaults (
  id,
  analysis_overrides_json,
  lane_strength_thresholds_json
)
SELECT
  1,
  '{
    "hopLength": 512,
    "onsetMinStrength": 0.1,
    "onsetMinDistanceSeconds": 0.11,
    "adaptiveWindowSeconds": 0.45,
    "strictK": 1.15,
    "permissiveK": 0.62,
    "gapTriggerSeconds": 0.23,
    "sustainMinDurationSeconds": 0.2,
    "sustainMergeGapSeconds": 0.12,
    "sustainBridgeFloor": 0.28,
    "sustainMaxPitchJumpSemitones": 1.2,
    "sustainSplitOnPitchChange": true,
    "sustainMinPitchConfidence": 0.2,
    "sustainEnableContinuousPitchSplit": true,
    "sustainPitchSplitThresholdSemitones": 0.35,
    "sustainPitchSplitMinSegmentSeconds": 0.02,
    "sustainPitchSplitMinVoicedProbability": 0.1,
    "lowFmin": 20,
    "lowFmax": 3500,
    "midFmin": 5000,
    "midFmax": 7000,
    "highFmin": 7000,
    "highFmax": 12000,
    "lowWeight": 1.15,
    "midWeight": 1,
    "highWeight": 0.9
  }',
  '{
    "hybrid_band_low": 0.2,
    "hybrid_band_mid": 0.51,
    "hybrid_band_high": 0.08,
    "hybrid_band_combined": 0.08,
    "hybrid_sustain": 0.38
  }'
WHERE NOT EXISTS (SELECT 1 FROM game_control_defaults WHERE id = 1);
