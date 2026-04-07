import { pool } from "../../db/postgres.js";
import { createId } from "../../utils/crypto.js";
import { GameDifficulty, GameMode, normalizeGameDifficulty, normalizeGameMode } from "./difficultyCharts.js";

export interface GameSongRow {
  id: string;
  beat_entry_id: string;
  title: string;
  is_enabled: number;
  cover_image_file_name: string | null;
  created_at: string;
  updated_at: string;
}

export async function saveGameControlDefaults(params: {
  analysisOverrides?: Record<string, unknown> | null;
  laneStrengthThresholds?: Record<string, unknown> | null;
}): Promise<void> {
  const analysisJson = params.analysisOverrides ? JSON.stringify(params.analysisOverrides) : null;
  const laneJson = params.laneStrengthThresholds ? JSON.stringify(params.laneStrengthThresholds) : null;
  await pool.query(
    `INSERT INTO game_control_defaults (id, analysis_overrides_json, lane_strength_thresholds_json, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT(id) DO UPDATE SET
       analysis_overrides_json = excluded.analysis_overrides_json,
       lane_strength_thresholds_json = excluded.lane_strength_thresholds_json,
       updated_at = now()`,
    [analysisJson, laneJson]
  );
}

export async function getGameControlDefaults(): Promise<{
  analysisOverrides: Record<string, unknown> | null;
  laneStrengthThresholds: Record<string, unknown> | null;
}> {
  const result = await pool.query<{
    analysis_overrides_json: string | null;
    lane_strength_thresholds_json: string | null;
  }>(
    `SELECT analysis_overrides_json, lane_strength_thresholds_json
     FROM game_control_defaults
     WHERE id = 1
     LIMIT 1`
  );

  const row = result.rows[0];

  const parseJson = (value: string | null): Record<string, unknown> | null => {
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  return {
    analysisOverrides: parseJson(row?.analysis_overrides_json ?? null),
    laneStrengthThresholds: parseJson(row?.lane_strength_thresholds_json ?? null),
  };
}

export async function listAllSongs(): Promise<Array<GameSongRow>> {
  return (
    await pool.query<GameSongRow>(
      `SELECT id, beat_entry_id, title, is_enabled, cover_image_file_name, created_at::text, updated_at::text
       FROM game_songs
       ORDER BY updated_at DESC`
    )
  ).rows;
}

export async function listEnabledSongs(): Promise<
  Array<{ beatEntryId: string; title: string; coverImageFileName: string | null }>
> {
  return (
    await pool.query<{ beatEntryId: string; title: string; coverImageFileName: string | null }>(
      `SELECT beat_entry_id AS "beatEntryId", title, cover_image_file_name AS "coverImageFileName"
       FROM game_songs
       WHERE is_enabled = 1
       ORDER BY updated_at DESC`
    )
  ).rows;
}

export async function findSongByEntryId(beatEntryId: string): Promise<GameSongRow | undefined> {
  return (
    await pool.query<GameSongRow>(
      `SELECT id, beat_entry_id, title, is_enabled, cover_image_file_name, created_at::text, updated_at::text
       FROM game_songs
       WHERE beat_entry_id = $1
       LIMIT 1`,
      [beatEntryId]
    )
  ).rows[0];
}

export async function isEntryEnabled(beatEntryId: string): Promise<boolean> {
  const row = (
    await pool.query<{ is_enabled: number }>(`SELECT is_enabled FROM game_songs WHERE beat_entry_id = $1 LIMIT 1`, [beatEntryId])
  ).rows[0];
  return row?.is_enabled === 1;
}

export async function upsertSongForEntry(params: {
  beatEntryId: string;
  title: string;
  isEnabled: boolean;
  createdByUserId: string;
}): Promise<GameSongRow> {
  const existing = await findSongByEntryId(params.beatEntryId);
  if (!existing) {
    const id = createId();
    await pool.query(
      `INSERT INTO game_songs (id, beat_entry_id, title, is_enabled, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, params.beatEntryId, params.title, params.isEnabled ? 1 : 0, params.createdByUserId]
    );
    return (await findSongByEntryId(params.beatEntryId))!;
  }

  await pool.query(
    `UPDATE game_songs
     SET title = $1, is_enabled = $2, updated_at = now()
     WHERE beat_entry_id = $3`,
    [params.title, params.isEnabled ? 1 : 0, params.beatEntryId]
  );

  return (await findSongByEntryId(params.beatEntryId))!;
}

export async function setSongCoverImageForEntry(
  beatEntryId: string,
  coverImageFileName: string | null
): Promise<GameSongRow | undefined> {
  await pool.query(
    `UPDATE game_songs
     SET cover_image_file_name = $1, updated_at = now()
     WHERE beat_entry_id = $2`,
    [coverImageFileName, beatEntryId]
  );
  return findSongByEntryId(beatEntryId);
}

export async function createScore(params: {
  beatEntryId: string;
  userId: string;
  gameMode?: GameMode;
  difficulty?: GameDifficulty;
  displayName: string;
  score: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  poor: number;
  miss: number;
}) {
  const song = await findSongByEntryId(params.beatEntryId);
  if (!song || song.is_enabled !== 1) {
    return { ok: false as const, reason: "Song is not enabled." };
  }
  const gameMode = normalizeGameMode(params.gameMode);
  const difficulty = normalizeGameDifficulty(params.difficulty);

  await pool.query(
    `INSERT INTO game_scores (
      id,
      song_id,
      user_id,
      beat_entry_id,
      game_mode,
      difficulty,
      display_name,
      score,
      max_combo,
      perfect,
      great,
      good,
      poor,
      miss
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      createId(),
      song.id,
      params.userId,
      params.beatEntryId,
      gameMode,
      difficulty,
      params.displayName,
      params.score,
      params.maxCombo,
      params.perfect,
      params.great,
      params.good,
      params.poor,
      params.miss,
    ]
  );

  return { ok: true as const };
}

export async function listSongLeaderboard(
  beatEntryId: string,
  gameModeValue?: GameMode,
  difficultyValue?: GameDifficulty
) {
  const gameMode = normalizeGameMode(gameModeValue);
  const difficulty = normalizeGameDifficulty(difficultyValue);
  return (
    await pool.query<{
      displayName: string;
      publicKey: string;
      gameMode: GameMode;
      difficulty: GameDifficulty;
      score: number;
      maxCombo: number;
      perfect: number;
      great: number;
      good: number;
      poor: number;
      miss: number;
      updatedAt: string;
    }>(
      `SELECT
         gs.display_name AS "displayName",
         u.public_key AS "publicKey",
         gs.game_mode AS "gameMode",
         gs.difficulty AS difficulty,
         MAX(gs.score) AS score,
         MAX(gs.max_combo) AS "maxCombo",
         MAX(gs.perfect) AS perfect,
         MAX(gs.great) AS great,
         MAX(gs.good) AS good,
         MAX(gs.poor) AS poor,
         MAX(gs.miss) AS miss,
         MAX(gs.created_at)::text AS "updatedAt"
       FROM game_scores gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.beat_entry_id = $1
         AND gs.game_mode = $2
         AND gs.difficulty = $3
       GROUP BY gs.user_id, gs.display_name, u.public_key, gs.game_mode, gs.difficulty
       ORDER BY score DESC, "updatedAt" ASC
       LIMIT 100`,
      [beatEntryId, gameMode, difficulty]
    )
  ).rows as Array<{
    displayName: string;
    publicKey: string;
    gameMode: GameMode;
    difficulty: GameDifficulty;
    score: number;
    maxCombo: number;
    perfect: number;
    great: number;
    good: number;
    poor: number;
    miss: number;
    updatedAt: string;
  }>;
}

export async function listOverallLeaderboard() {
  return (
    await pool.query<{
      displayName: string;
      publicKey: string;
      totalScore: number;
      songsCount: number;
    }>(
      `WITH best_per_song AS (
         SELECT user_id, beat_entry_id, game_mode, difficulty, MAX(score) AS best_score
         FROM game_scores
         GROUP BY user_id, beat_entry_id, game_mode, difficulty
       ),
       display_names AS (
         SELECT user_id, display_name, MAX(created_at) AS latest
         FROM game_scores
         GROUP BY user_id, display_name
       )
       SELECT
         d.display_name AS "displayName",
         u.public_key AS "publicKey",
         SUM(b.best_score) AS "totalScore",
         COUNT(*) AS "songsCount"
       FROM best_per_song b
       JOIN users u ON u.id = b.user_id
       JOIN display_names d ON d.user_id = b.user_id
       GROUP BY b.user_id, d.display_name, u.public_key
       ORDER BY "totalScore" DESC, "songsCount" DESC
       LIMIT 100`
    )
  ).rows as Array<{ displayName: string; publicKey: string; totalScore: number; songsCount: number }>;
}
