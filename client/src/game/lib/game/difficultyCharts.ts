import type { SavedBeatEntry } from "../../types/beat";

export const GAME_DIFFICULTIES = ["easy", "normal", "hard"] as const;
export const GAME_MODES = ["step_arrows", "orb_beat"] as const;

export type GameDifficulty = (typeof GAME_DIFFICULTIES)[number];
export type GameMode = (typeof GAME_MODES)[number];

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

export function getModeDifficultyChart(
  entry: SavedBeatEntry | null | undefined,
  modeValue: GameMode,
  difficultyValue: GameDifficulty
) {
  if (!entry) {
    return null;
  }
  const mode = normalizeGameMode(modeValue);
  const difficulty = normalizeGameDifficulty(difficultyValue);
  const explicit = entry.modeDifficultyCharts?.[mode]?.[difficulty];
  if (explicit) {
    return explicit;
  }
  const legacyModeCharts = mode === "step_arrows" ? entry.difficultyCharts?.[difficulty] : undefined;
  if (legacyModeCharts) {
    return legacyModeCharts;
  }
  if (mode === "step_arrows" && difficulty === "normal") {
    const hasLegacyData =
      (entry.gameBeats?.length ?? 0) > 0 ||
      (entry.gameNotes?.length ?? 0) > 0 ||
      (entry.gameBeatSelections?.length ?? 0) > 0 ||
      Boolean(entry.gameBeatConfig);
    if (hasLegacyData) {
      return {
        gameBeats: entry.gameBeats ?? [],
        gameNotes: entry.gameNotes ?? [],
        gameBeatSelections: entry.gameBeatSelections ?? [],
        gameBeatConfig: entry.gameBeatConfig ?? {},
        gameBeatsUpdatedAtIso: entry.gameBeatsUpdatedAtIso
      };
    }
  }
  return null;
}

export function getDifficultyChart(
  entry: SavedBeatEntry | null | undefined,
  difficulty: GameDifficulty
) {
  return getModeDifficultyChart(entry, "step_arrows", difficulty);
}

export function getModeDifficultyBeatCount(
  entry: SavedBeatEntry | null | undefined,
  modeValue: GameMode,
  difficultyValue: GameDifficulty
): number {
  const chart = getModeDifficultyChart(entry, modeValue, difficultyValue);
  if (!chart) {
    return 0;
  }
  if ((chart.gameNotes?.length ?? 0) > 0) {
    return chart.gameNotes?.length ?? 0;
  }
  return chart.gameBeats?.length ?? 0;
}

export function getDifficultyBeatCount(
  entry: SavedBeatEntry | null | undefined,
  difficulty: GameDifficulty
): number {
  return getModeDifficultyBeatCount(entry, "step_arrows", difficulty);
}

export function getAvailableDifficulties(
  entry: SavedBeatEntry | null | undefined,
  modeValue: GameMode = "step_arrows"
): GameDifficulty[] {
  return GAME_DIFFICULTIES.filter(
    (difficulty) => getModeDifficultyBeatCount(entry, modeValue, difficulty) > 0
  );
}

export function getAvailableGameModes(entry: SavedBeatEntry | null | undefined): GameMode[] {
  return GAME_MODES.filter((mode) => getAvailableDifficulties(entry, mode).length > 0);
}
