export const GAME_DIFFICULTIES = ["easy", "normal", "hard"] as const;
export const GAME_MODES = ["step_arrows", "orb_beat", "laser_shoot"] as const;

export type GameDifficulty = (typeof GAME_DIFFICULTIES)[number];
export type GameMode = (typeof GAME_MODES)[number];

export interface DifficultyChartRecord {
  gameBeats?: unknown[];
  gameNotes?: unknown[];
  gameBeatSelections?: unknown[];
  gameBeatConfig?: Record<string, unknown>;
  gameBeatsUpdatedAtIso?: string;
}

export type ModeChartMatrix = Partial<
  Record<GameMode, Partial<Record<GameDifficulty, DifficultyChartRecord>>>
>;

export function isGameDifficulty(value: unknown): value is GameDifficulty {
  return typeof value === "string" && GAME_DIFFICULTIES.includes(value as GameDifficulty);
}

export function normalizeGameDifficulty(
  value: unknown,
  fallback: GameDifficulty = "normal"
): GameDifficulty {
  return isGameDifficulty(value) ? value : fallback;
}

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "string" && GAME_MODES.includes(value as GameMode);
}

export function normalizeGameMode(value: unknown, fallback: GameMode = "step_arrows"): GameMode {
  return isGameMode(value) ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeChartRecord(value: Record<string, unknown>): DifficultyChartRecord {
  return {
    gameBeats: Array.isArray(value.gameBeats) ? value.gameBeats : [],
    gameNotes: Array.isArray(value.gameNotes) ? value.gameNotes : [],
    gameBeatSelections: Array.isArray(value.gameBeatSelections) ? value.gameBeatSelections : [],
    gameBeatConfig: asRecord(value.gameBeatConfig) ?? {},
    gameBeatsUpdatedAtIso:
      typeof value.gameBeatsUpdatedAtIso === "string" ? value.gameBeatsUpdatedAtIso : undefined
  };
}

function parseLegacyDifficultyCharts(entry: Record<string, unknown>): ModeChartMatrix {
  const raw = asRecord(entry.difficultyCharts);
  if (!raw) {
    return {};
  }
  const legacyStepCharts: Partial<Record<GameDifficulty, DifficultyChartRecord>> = {};
  for (const difficulty of GAME_DIFFICULTIES) {
    const chart = asRecord(raw[difficulty]);
    if (!chart) {
      continue;
    }
    legacyStepCharts[difficulty] = normalizeChartRecord(chart);
  }
  return Object.keys(legacyStepCharts).length > 0 ? { step_arrows: legacyStepCharts } : {};
}

export function getModeDifficultyCharts(entry: Record<string, unknown>): ModeChartMatrix {
  const raw = asRecord(entry.modeDifficultyCharts);
  if (!raw) {
    return parseLegacyDifficultyCharts(entry);
  }

  const charts: ModeChartMatrix = {};
  for (const mode of GAME_MODES) {
    const modeRecord = asRecord(raw[mode]);
    if (!modeRecord) {
      continue;
    }
    const modeCharts: Partial<Record<GameDifficulty, DifficultyChartRecord>> = {};
    for (const difficulty of GAME_DIFFICULTIES) {
      const chart = asRecord(modeRecord[difficulty]);
      if (!chart) {
        continue;
      }
      modeCharts[difficulty] = normalizeChartRecord(chart);
    }
    if (Object.keys(modeCharts).length > 0) {
      charts[mode] = modeCharts;
    }
  }

  const legacyCharts = parseLegacyDifficultyCharts(entry);
  if (!charts.step_arrows && legacyCharts.step_arrows) {
    charts.step_arrows = legacyCharts.step_arrows;
  }
  return charts;
}

export function getLegacyStepArrowsNormalChart(
  entry: Record<string, unknown>
): DifficultyChartRecord | null {
  const hasLegacyData =
    Array.isArray(entry.gameBeats) ||
    Array.isArray(entry.gameNotes) ||
    Array.isArray(entry.gameBeatSelections) ||
    (entry.gameBeatConfig && typeof entry.gameBeatConfig === "object");

  if (!hasLegacyData) {
    return null;
  }

  return {
    gameBeats: Array.isArray(entry.gameBeats) ? entry.gameBeats : [],
    gameNotes: Array.isArray(entry.gameNotes) ? entry.gameNotes : [],
    gameBeatSelections: Array.isArray(entry.gameBeatSelections) ? entry.gameBeatSelections : [],
    gameBeatConfig: asRecord(entry.gameBeatConfig) ?? {},
    gameBeatsUpdatedAtIso:
      typeof entry.gameBeatsUpdatedAtIso === "string" ? entry.gameBeatsUpdatedAtIso : undefined
  };
}

export function getModeDifficultyChart(
  entry: Record<string, unknown>,
  modeValue: GameMode,
  difficultyValue: GameDifficulty
): DifficultyChartRecord | null {
  const mode = normalizeGameMode(modeValue);
  const difficulty = normalizeGameDifficulty(difficultyValue);
  const charts = getModeDifficultyCharts(entry);
  const explicit = charts[mode]?.[difficulty];
  if (explicit) {
    return explicit;
  }
  if (mode === "laser_shoot") {
    const mirrored = charts.step_arrows?.[difficulty];
    if (mirrored) {
      return mirrored;
    }
  }
  if (mode === "step_arrows" && difficulty === "normal") {
    return getLegacyStepArrowsNormalChart(entry);
  }
  return null;
}

export function countDifficultyChartBeats(chart: DifficultyChartRecord | null | undefined): number {
  if (!chart) {
    return 0;
  }
  if (Array.isArray(chart.gameNotes) && chart.gameNotes.length > 0) {
    return chart.gameNotes.length;
  }
  if (Array.isArray(chart.gameBeats) && chart.gameBeats.length > 0) {
    return chart.gameBeats.length;
  }
  return 0;
}

export function getModeDifficultyBeatCounts(entry: Record<string, unknown>): Partial<
  Record<GameMode, Partial<Record<GameDifficulty, number>>>
> {
  const counts: Partial<Record<GameMode, Partial<Record<GameDifficulty, number>>>> = {};
  for (const mode of GAME_MODES) {
    const difficultyCounts: Partial<Record<GameDifficulty, number>> = {};
    for (const difficulty of GAME_DIFFICULTIES) {
      const count = countDifficultyChartBeats(getModeDifficultyChart(entry, mode, difficulty));
      if (count > 0) {
        difficultyCounts[difficulty] = count;
      }
    }
    if (Object.keys(difficultyCounts).length > 0) {
      counts[mode] = difficultyCounts;
    }
  }
  return counts;
}

export function getDifficultyBeatCounts(
  entry: Record<string, unknown>,
  mode: GameMode = "step_arrows"
): Partial<Record<GameDifficulty, number>> {
  return getModeDifficultyBeatCounts(entry)[mode] ?? {};
}

export function getAvailableDifficulties(
  entry: Record<string, unknown>,
  mode: GameMode = "step_arrows"
): GameDifficulty[] {
  return GAME_DIFFICULTIES.filter(
    (difficulty) => countDifficultyChartBeats(getModeDifficultyChart(entry, mode, difficulty)) > 0
  );
}

export function getAvailableGameModes(entry: Record<string, unknown>): GameMode[] {
  return GAME_MODES.filter((mode) => getAvailableDifficulties(entry, mode).length > 0);
}

export function hasExplicitModeDifficultyChart(
  entry: Record<string, unknown>,
  modeValue: GameMode,
  difficultyValue: GameDifficulty
): boolean {
  const charts = getModeDifficultyCharts(entry);
  const mode = normalizeGameMode(modeValue);
  const difficulty = normalizeGameDifficulty(difficultyValue);
  return Boolean(charts[mode]?.[difficulty]);
}

export function hasLegacyNormalChartOnly(entry: Record<string, unknown>): boolean {
  return (
    !hasExplicitModeDifficultyChart(entry, "step_arrows", "normal") &&
    countDifficultyChartBeats(getLegacyStepArrowsNormalChart(entry)) > 0
  );
}

export function writeModeDifficultyChart(
  entry: Record<string, unknown>,
  modeValue: GameMode,
  difficultyValue: GameDifficulty,
  chart: DifficultyChartRecord
): Record<string, unknown> {
  const mode = normalizeGameMode(modeValue);
  const difficulty = normalizeGameDifficulty(difficultyValue);
  const existing = getModeDifficultyCharts(entry);
  const nextCharts: ModeChartMatrix = {
    ...existing,
    [mode]: {
      ...(existing[mode] ?? {}),
      [difficulty]: {
        gameBeats: Array.isArray(chart.gameBeats) ? chart.gameBeats : [],
        gameNotes: Array.isArray(chart.gameNotes) ? chart.gameNotes : [],
        gameBeatSelections: Array.isArray(chart.gameBeatSelections) ? chart.gameBeatSelections : [],
        gameBeatConfig:
          chart.gameBeatConfig && typeof chart.gameBeatConfig === "object"
            ? chart.gameBeatConfig
            : {},
        gameBeatsUpdatedAtIso:
          typeof chart.gameBeatsUpdatedAtIso === "string"
            ? chart.gameBeatsUpdatedAtIso
            : new Date().toISOString()
      }
    }
  };

  const updated: Record<string, unknown> = {
    ...entry,
    modeDifficultyCharts: nextCharts
  };

  if (mode === "step_arrows" && difficulty === "normal") {
    updated.difficultyCharts = nextCharts.step_arrows ?? {};
    updated.gameBeats = nextCharts.step_arrows?.normal?.gameBeats ?? [];
    updated.gameNotes = nextCharts.step_arrows?.normal?.gameNotes ?? [];
    updated.gameBeatSelections = nextCharts.step_arrows?.normal?.gameBeatSelections ?? [];
    updated.gameBeatConfig = nextCharts.step_arrows?.normal?.gameBeatConfig ?? {};
    updated.gameBeatsUpdatedAtIso =
      nextCharts.step_arrows?.normal?.gameBeatsUpdatedAtIso ?? new Date().toISOString();
  }

  return updated;
}

export function materializeLegacyNormalChart(entry: Record<string, unknown>): Record<string, unknown> {
  const legacy = getLegacyStepArrowsNormalChart(entry);
  if (!legacy) {
    return entry;
  }
  if (hasExplicitModeDifficultyChart(entry, "step_arrows", "normal")) {
    return entry;
  }
  return writeModeDifficultyChart(entry, "step_arrows", "normal", {
    ...legacy,
    gameBeatsUpdatedAtIso: legacy.gameBeatsUpdatedAtIso ?? new Date().toISOString()
  });
}
