import { pool } from "../../db/postgres.js";
import { createId } from "../../utils/crypto.js";
import type {
  DanceOffParticipantRecord,
  DanceOffParticipantRole,
  DanceOffParticipantJoinStatus,
  DanceOffRecord,
  DanceOffStatus,
} from "./types.js";

type SqlClient = {
  query: typeof pool.query;
};

function mapDanceOff(row: any): DanceOffRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    beatEntryId: row.beat_entry_id,
    gameMode: row.game_mode,
    difficulty: row.difficulty,
    requiredPlayerCount: Number(row.required_player_count),
    status: row.status,
    cancelReason: row.cancel_reason,
    readyDeadlineAtIso: row.ready_deadline_at,
    countdownStartedAtIso: row.countdown_started_at,
    startedAtIso: row.started_at,
    endedAtIso: row.ended_at,
    winnerUserId: row.winner_user_id,
    isDraw: Number(row.is_draw ?? 0) === 1,
    createdAtIso: row.created_at,
    updatedAtIso: row.updated_at,
  };
}

function mapParticipant(row: any): DanceOffParticipantRecord {
  return {
    id: row.id,
    danceOffId: row.dance_off_id,
    userId: row.user_id,
    publicKey: row.public_key,
    displayNameSnapshot: row.display_name_snapshot,
    role: row.role,
    joinStatus: row.join_status,
    joinedAtIso: row.joined_at,
    readyAtIso: row.ready_at,
    finishedAtIso: row.finished_at,
    finalScore: row.final_score === null ? null : Number(row.final_score),
    finalAccuracy: row.final_accuracy === null ? null : Number(row.final_accuracy),
  };
}

export async function withTransaction<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createDanceOff(client: SqlClient, params: {
  ownerUserId: string;
  beatEntryId: string;
  gameMode: "step_arrows" | "orb_beat";
  difficulty: "easy" | "normal" | "hard";
  requiredPlayerCount: number;
}): Promise<DanceOffRecord> {
  const id = createId();
  const result = await client.query(
    `INSERT INTO dance_offs (
      id, owner_user_id, beat_entry_id, game_mode, difficulty, required_player_count, status
    ) VALUES ($1, $2, $3, $4, $5, $6, 'waiting')
    RETURNING id, owner_user_id, beat_entry_id, game_mode, difficulty, required_player_count, status,
      cancel_reason, ready_deadline_at::text, countdown_started_at::text, started_at::text, ended_at::text,
      winner_user_id, is_draw, created_at::text, updated_at::text`,
    [id, params.ownerUserId, params.beatEntryId, params.gameMode, params.difficulty, params.requiredPlayerCount]
  );
  return mapDanceOff(result.rows[0]);
}

export async function insertParticipant(client: SqlClient, params: {
  danceOffId: string;
  userId: string;
  publicKey: string;
  displayNameSnapshot: string | null;
  role: DanceOffParticipantRole;
  joinStatus?: DanceOffParticipantJoinStatus;
}): Promise<DanceOffParticipantRecord> {
  const id = createId();
  const result = await client.query(
    `INSERT INTO dance_off_participants (
      id, dance_off_id, user_id, public_key, display_name_snapshot, role, join_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, dance_off_id, user_id, public_key, display_name_snapshot, role, join_status,
      joined_at::text, ready_at::text, finished_at::text, final_score, final_accuracy`,
    [id, params.danceOffId, params.userId, params.publicKey, params.displayNameSnapshot, params.role, params.joinStatus ?? "joined"]
  );
  return mapParticipant(result.rows[0]);
}

export async function listParticipants(client: SqlClient, danceOffId: string): Promise<DanceOffParticipantRecord[]> {
  const result = await client.query(
    `SELECT id, dance_off_id, user_id, public_key, display_name_snapshot, role, join_status,
      joined_at::text, ready_at::text, finished_at::text, final_score, final_accuracy
     FROM dance_off_participants
     WHERE dance_off_id = $1
     ORDER BY joined_at ASC`,
    [danceOffId]
  );
  return result.rows.map(mapParticipant);
}

export async function getDanceOffById(client: SqlClient, id: string): Promise<DanceOffRecord | null> {
  const result = await client.query(
    `SELECT id, owner_user_id, beat_entry_id, game_mode, difficulty, required_player_count, status,
      cancel_reason, ready_deadline_at::text, countdown_started_at::text, started_at::text, ended_at::text,
      winner_user_id, is_draw, created_at::text, updated_at::text
     FROM dance_offs
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapDanceOff(result.rows[0]);
}

export async function getDanceOffByIdForUpdate(client: SqlClient, id: string): Promise<DanceOffRecord | null> {
  const result = await client.query(
    `SELECT id, owner_user_id, beat_entry_id, game_mode, difficulty, required_player_count, status,
      cancel_reason, ready_deadline_at::text, countdown_started_at::text, started_at::text, ended_at::text,
      winner_user_id, is_draw, created_at::text, updated_at::text
     FROM dance_offs
     WHERE id = $1
     FOR UPDATE`,
    [id]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapDanceOff(result.rows[0]);
}

export async function getParticipant(client: SqlClient, danceOffId: string, userId: string): Promise<DanceOffParticipantRecord | null> {
  const result = await client.query(
    `SELECT id, dance_off_id, user_id, public_key, display_name_snapshot, role, join_status,
      joined_at::text, ready_at::text, finished_at::text, final_score, final_accuracy
     FROM dance_off_participants
     WHERE dance_off_id = $1 AND user_id = $2
     LIMIT 1`,
    [danceOffId, userId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapParticipant(result.rows[0]);
}

export async function updateParticipantReady(client: SqlClient, danceOffId: string, userId: string, ready: boolean): Promise<void> {
  await client.query(
    `UPDATE dance_off_participants
     SET join_status = $3,
         ready_at = CASE WHEN $3 = 'ready' THEN now() ELSE NULL END
     WHERE dance_off_id = $1 AND user_id = $2`,
    [danceOffId, userId, ready ? "ready" : "joined"]
  );
}

export async function saveParticipantResult(client: SqlClient, params: {
  danceOffId: string;
  userId: string;
  score: number;
  accuracy: number;
}): Promise<void> {
  await client.query(
    `UPDATE dance_off_participants
     SET join_status = 'finished',
         finished_at = now(),
         final_score = $3,
         final_accuracy = $4
     WHERE dance_off_id = $1 AND user_id = $2`,
    [params.danceOffId, params.userId, params.score, params.accuracy]
  );
}

export async function removeParticipant(client: SqlClient, danceOffId: string, userId: string): Promise<void> {
  await client.query(`DELETE FROM dance_off_participants WHERE dance_off_id = $1 AND user_id = $2`, [danceOffId, userId]);
}

export async function resetParticipantReadiness(client: SqlClient, danceOffId: string): Promise<void> {
  await client.query(
    `UPDATE dance_off_participants
     SET join_status = 'joined', ready_at = NULL
     WHERE dance_off_id = $1 AND join_status != 'finished'`,
    [danceOffId]
  );
}

export async function updateDanceOffStatus(client: SqlClient, params: {
  danceOffId: string;
  status: DanceOffStatus;
  cancelReason?: string | null;
  readyDeadlineAtIso?: string | null;
  countdownStartedAtIso?: string | null;
  startedAtIso?: string | null;
  endedAtIso?: string | null;
  winnerUserId?: string | null;
  isDraw?: boolean;
}): Promise<void> {
  await client.query(
    `UPDATE dance_offs
     SET status = $2,
         cancel_reason = COALESCE($3, cancel_reason),
         ready_deadline_at = CASE WHEN $4::timestamptz IS NULL THEN ready_deadline_at ELSE $4::timestamptz END,
         countdown_started_at = CASE WHEN $5::timestamptz IS NULL THEN countdown_started_at ELSE $5::timestamptz END,
         started_at = CASE WHEN $6::timestamptz IS NULL THEN started_at ELSE $6::timestamptz END,
         ended_at = CASE WHEN $7::timestamptz IS NULL THEN ended_at ELSE $7::timestamptz END,
         winner_user_id = CASE WHEN $8::text IS NULL THEN winner_user_id ELSE $8::text END,
         is_draw = CASE WHEN $9::boolean IS NULL THEN is_draw ELSE CASE WHEN $9::boolean THEN 1 ELSE 0 END END,
         updated_at = now()
     WHERE id = $1`,
    [
      params.danceOffId,
      params.status,
      params.cancelReason ?? null,
      params.readyDeadlineAtIso === undefined ? null : params.readyDeadlineAtIso,
      params.countdownStartedAtIso === undefined ? null : params.countdownStartedAtIso,
      params.startedAtIso === undefined ? null : params.startedAtIso,
      params.endedAtIso === undefined ? null : params.endedAtIso,
      params.winnerUserId === undefined ? null : params.winnerUserId,
      params.isDraw === undefined ? null : params.isDraw,
    ]
  );
}

export async function clearDanceOffTimingFields(client: SqlClient, danceOffId: string): Promise<void> {
  await client.query(
    `UPDATE dance_offs
     SET ready_deadline_at = NULL,
         countdown_started_at = NULL,
         started_at = CASE WHEN status = 'active' THEN started_at ELSE NULL END,
         updated_at = now()
     WHERE id = $1`,
    [danceOffId]
  );
}

export async function listOpenDanceOffs(client?: SqlClient): Promise<DanceOffRecord[]> {
  const db = client ?? pool;
  const result = await db.query(
    `SELECT id, owner_user_id, beat_entry_id, game_mode, difficulty, required_player_count, status,
      cancel_reason, ready_deadline_at::text, countdown_started_at::text, started_at::text, ended_at::text,
      winner_user_id, is_draw, created_at::text, updated_at::text
     FROM dance_offs
     WHERE status IN ('waiting', 'ready_check', 'countdown', 'active')
     ORDER BY created_at DESC`
  );
  return result.rows.map(mapDanceOff);
}

export async function listDanceOffsByParticipantUser(client: SqlClient, userId: string): Promise<DanceOffRecord[]> {
  const result = await client.query(
    `SELECT d.id, d.owner_user_id, d.beat_entry_id, d.game_mode, d.difficulty, d.required_player_count, d.status,
      d.cancel_reason, d.ready_deadline_at::text, d.countdown_started_at::text, d.started_at::text, d.ended_at::text,
      d.winner_user_id, d.is_draw, d.created_at::text, d.updated_at::text
     FROM dance_offs d
     JOIN dance_off_participants p ON p.dance_off_id = d.id
     WHERE p.user_id = $1 AND d.status IN ('waiting', 'ready_check', 'countdown', 'active')
     ORDER BY d.created_at DESC`,
    [userId]
  );
  return result.rows.map(mapDanceOff);
}

export async function appendDanceOffEvent(client: SqlClient, danceOffId: string, eventType: string, payload?: Record<string, unknown>): Promise<void> {
  await client.query(
    `INSERT INTO dance_off_events (dance_off_id, event_type, payload_json)
     VALUES ($1, $2, $3)`,
    [danceOffId, eventType, payload ? JSON.stringify(payload) : null]
  );
}

export async function findExpiredReadyChecks(client: SqlClient, nowIso: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM dance_offs
     WHERE status = 'ready_check' AND ready_deadline_at IS NOT NULL AND ready_deadline_at <= $1::timestamptz`,
    [nowIso]
  );
  return result.rows.map((row) => row.id);
}

export async function findExpiredCountdowns(client: SqlClient, nowIso: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM dance_offs
     WHERE status = 'countdown' AND countdown_started_at IS NOT NULL
       AND (countdown_started_at + interval '10 seconds') <= $1::timestamptz`,
    [nowIso]
  );
  return result.rows.map((row) => row.id);
}

export async function findActiveDanceOffsWithResultTimeout(
  client: SqlClient,
  nowIso: string,
  timeoutSeconds: number
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT d.id
     FROM dance_offs d
     JOIN dance_off_participants p ON p.dance_off_id = d.id
     WHERE d.status = 'active'
     GROUP BY d.id
     HAVING COUNT(*) FILTER (WHERE p.join_status = 'finished') >= 1
       AND COUNT(*) FILTER (WHERE p.join_status != 'finished') >= 1
       AND MIN(p.finished_at) FILTER (WHERE p.join_status = 'finished')
           <= ($1::timestamptz - make_interval(secs => $2::int))`,
    [nowIso, timeoutSeconds]
  );
  return result.rows.map((row) => row.id);
}
