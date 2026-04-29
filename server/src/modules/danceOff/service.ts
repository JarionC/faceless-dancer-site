import {
  appendDanceOffEvent,
  createDanceOff,
  findActiveDanceOffsWithResultTimeout,
  findExpiredCountdowns,
  findExpiredReadyChecks,
  getDanceOffById,
  getDanceOffByIdForUpdate,
  getParticipant,
  insertParticipant,
  listDanceOffsByParticipantUser,
  listOpenDanceOffs,
  listParticipants,
  removeParticipant,
  resetParticipantReadiness,
  saveParticipantResult,
  updateDanceOffStatus,
  updateParticipantReady,
  withTransaction,
} from "./repository.js";
import {
  resolveWinner,
  shouldCancelActiveDanceOffForResultTimeout,
  shouldAdvanceCountdown,
  shouldCompleteDanceOff,
  shouldEnterReadyCheck,
  shouldReturnToWaitingFromReadyCheck,
} from "./stateMachine.js";
import type {
  DanceOffListItem,
  DanceOffParticipantRecord,
  DanceOffPayload,
  DanceOffParticipantView,
  DanceOffRecord,
  DanceOffResultSubmission,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeDisplayName(input: unknown): string | null {
  const text = String(input ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
  return text || null;
}

function toParticipantView(participant: DanceOffParticipantRecord): DanceOffParticipantView {
  return {
    userId: participant.userId,
    publicKey: participant.publicKey,
    displayName: participant.displayNameSnapshot,
    role: participant.role,
    joinStatus: participant.joinStatus,
    finalScore: participant.finalScore,
    finalAccuracy: participant.finalAccuracy,
  };
}

function toPayload(danceOff: DanceOffRecord, participants: DanceOffParticipantRecord[]): DanceOffPayload {
  return {
    id: danceOff.id,
    status: danceOff.status,
    beatEntryId: danceOff.beatEntryId,
    gameMode: danceOff.gameMode,
    difficulty: danceOff.difficulty,
    requiredPlayerCount: danceOff.requiredPlayerCount,
    ownerUserId: danceOff.ownerUserId,
    cancelReason: danceOff.cancelReason,
    isDraw: danceOff.isDraw,
    winnerUserId: danceOff.winnerUserId,
    readyDeadlineAtIso: danceOff.readyDeadlineAtIso,
    countdownStartedAtIso: danceOff.countdownStartedAtIso,
    startedAtIso: danceOff.startedAtIso,
    endedAtIso: danceOff.endedAtIso,
    createdAtIso: danceOff.createdAtIso,
    updatedAtIso: danceOff.updatedAtIso,
    participants: participants.map(toParticipantView),
  };
}

async function ensureUserIsNotInAnotherOpenDanceOff(
  client: any,
  userId: string,
  currentDanceOffId?: string
): Promise<void> {
  const openDanceOffs = await listDanceOffsByParticipantUser(client, userId);
  const conflicting = openDanceOffs.find((entry) => entry.id !== currentDanceOffId);
  if (conflicting) {
    throw new Error("You are already participating in another Dance-Off.");
  }
}

async function loadDanceOffItem(danceOffId: string): Promise<DanceOffListItem | null> {
  return withTransaction(async (client) => {
    const danceOff = await getDanceOffById(client, danceOffId);
    if (!danceOff) {
      return null;
    }
    const participants = await listParticipants(client, danceOffId);
    return { danceOff, participants };
  });
}

async function advanceDanceOffState(client: any, danceOffId: string): Promise<void> {
  let guard = 0;
  while (guard < 6) {
    guard += 1;
    const danceOff = await getDanceOffByIdForUpdate(client, danceOffId);
    if (!danceOff) {
      return;
    }
    const participants = await listParticipants(client, danceOffId);
    const now = new Date();

    if (shouldEnterReadyCheck(danceOff, participants)) {
      const deadlineIso = new Date(now.getTime() + 3 * 60_000).toISOString();
      await resetParticipantReadiness(client, danceOffId);
      await updateDanceOffStatus(client, {
        danceOffId,
        status: "ready_check",
        readyDeadlineAtIso: deadlineIso,
        countdownStartedAtIso: null,
        startedAtIso: null,
        endedAtIso: null,
      });
      await appendDanceOffEvent(client, danceOffId, "ready_check_started", { readyDeadlineAtIso: deadlineIso });
      continue;
    }

    const readyDecision = shouldReturnToWaitingFromReadyCheck(danceOff, participants, now);
    if (readyDecision.nextStatus === "waiting") {
      await resetParticipantReadiness(client, danceOffId);
      await updateDanceOffStatus(client, {
        danceOffId,
        status: "waiting",
        readyDeadlineAtIso: null,
        countdownStartedAtIso: null,
        startedAtIso: null,
      });
      await appendDanceOffEvent(client, danceOffId, "waiting_restored", { reason: readyDecision.reason ?? "unknown" });
      continue;
    }
    if (readyDecision.nextStatus === "countdown") {
      const startedIso = now.toISOString();
      await updateDanceOffStatus(client, {
        danceOffId,
        status: "countdown",
        countdownStartedAtIso: startedIso,
        readyDeadlineAtIso: danceOff.readyDeadlineAtIso,
      });
      await appendDanceOffEvent(client, danceOffId, "countdown_started", { countdownStartedAtIso: startedIso });
      continue;
    }

    const countdownDecision = shouldAdvanceCountdown(danceOff, participants, now);
    if (countdownDecision.nextStatus === "waiting") {
      await resetParticipantReadiness(client, danceOffId);
      await updateDanceOffStatus(client, {
        danceOffId,
        status: "waiting",
        readyDeadlineAtIso: null,
        countdownStartedAtIso: null,
        startedAtIso: null,
      });
      await appendDanceOffEvent(client, danceOffId, "waiting_restored", { reason: countdownDecision.reason ?? "unknown" });
      continue;
    }
    if (countdownDecision.nextStatus === "active") {
      const startedIso = now.toISOString();
      await updateDanceOffStatus(client, {
        danceOffId,
        status: "active",
        startedAtIso: startedIso,
      });
      await appendDanceOffEvent(client, danceOffId, "match_started", { startedAtIso: startedIso });
      continue;
    }

    if (shouldCompleteDanceOff(danceOff, participants)) {
      const winner = resolveWinner(participants);
      const endedIso = now.toISOString();
      await updateDanceOffStatus(client, {
        danceOffId,
        status: "completed",
        endedAtIso: endedIso,
        winnerUserId: winner.winnerUserId,
        isDraw: winner.isDraw,
      });
      await appendDanceOffEvent(client, danceOffId, "match_completed", {
        endedAtIso: endedIso,
        winnerUserId: winner.winnerUserId,
        isDraw: winner.isDraw,
      });
      continue;
    }

    if (shouldCancelActiveDanceOffForResultTimeout(danceOff, participants, now, 60)) {
      const endedIso = now.toISOString();
      await updateDanceOffStatus(client, {
        danceOffId,
        status: "cancelled",
        endedAtIso: endedIso,
        cancelReason: "player_disconnected",
        winnerUserId: null,
        isDraw: false,
      });
      await appendDanceOffEvent(client, danceOffId, "cancelled", {
        reason: "result_timeout",
        timeoutSeconds: 60,
      });
      continue;
    }

    return;
  }
}

export async function listOpenDanceOffPayloads(): Promise<DanceOffPayload[]> {
  return withTransaction(async (client) => {
    const danceOffs = await listOpenDanceOffs(client);
    const payloads: DanceOffPayload[] = [];
    for (const danceOff of danceOffs) {
      const participants = await listParticipants(client, danceOff.id);
      payloads.push(toPayload(danceOff, participants));
    }
    return payloads;
  });
}

export async function createDanceOffWithOwner(params: {
  ownerUserId: string;
  ownerPublicKey: string;
  ownerDisplayName?: string | null;
  beatEntryId: string;
  gameMode: "step_arrows" | "orb_beat" | "laser_shoot";
  difficulty: "easy" | "normal" | "hard";
  competitors: number;
}): Promise<DanceOffPayload> {
  const requiredPlayerCount = Math.max(2, Math.min(4, Math.floor(params.competitors) + 1));
  const created = await withTransaction(async (client) => {
    await ensureUserIsNotInAnotherOpenDanceOff(client, params.ownerUserId);

    const danceOff = await createDanceOff(client, {
      ownerUserId: params.ownerUserId,
      beatEntryId: params.beatEntryId,
      gameMode: params.gameMode,
      difficulty: params.difficulty,
      requiredPlayerCount,
    });
    await insertParticipant(client, {
      danceOffId: danceOff.id,
      userId: params.ownerUserId,
      publicKey: params.ownerPublicKey,
      displayNameSnapshot: sanitizeDisplayName(params.ownerDisplayName),
      role: "owner",
      joinStatus: "joined",
    });
    await appendDanceOffEvent(client, danceOff.id, "created", {
      ownerUserId: params.ownerUserId,
      requiredPlayerCount,
    });
    await advanceDanceOffState(client, danceOff.id);
    const refreshed = await getDanceOffById(client, danceOff.id);
    if (!refreshed) {
      throw new Error("Dance-Off creation failed.");
    }
    const participants = await listParticipants(client, danceOff.id);
    return toPayload(refreshed, participants);
  });
  return created;
}

export async function joinDanceOff(params: {
  danceOffId: string;
  userId: string;
  publicKey: string;
  displayName?: string | null;
}): Promise<DanceOffPayload> {
  return withTransaction(async (client) => {
    const danceOff = await getDanceOffByIdForUpdate(client, params.danceOffId);
    if (!danceOff) {
      throw new Error("Dance-Off not found.");
    }
    if (danceOff.status !== "waiting") {
      throw new Error("Dance-Off is not joinable right now.");
    }
    const existing = await getParticipant(client, danceOff.id, params.userId);
    await ensureUserIsNotInAnotherOpenDanceOff(client, params.userId, danceOff.id);
    if (!existing) {
      const participantsBefore = await listParticipants(client, danceOff.id);
      if (participantsBefore.length >= danceOff.requiredPlayerCount) {
        throw new Error("Dance-Off is already full.");
      }
      await insertParticipant(client, {
        danceOffId: danceOff.id,
        userId: params.userId,
        publicKey: params.publicKey,
        displayNameSnapshot: sanitizeDisplayName(params.displayName),
        role: "player",
        joinStatus: "joined",
      });
      await appendDanceOffEvent(client, danceOff.id, "joined", { userId: params.userId });
    }

    await advanceDanceOffState(client, danceOff.id);
    const refreshed = await getDanceOffById(client, danceOff.id);
    if (!refreshed) {
      throw new Error("Dance-Off not found.");
    }
    const participants = await listParticipants(client, danceOff.id);
    return toPayload(refreshed, participants);
  });
}

export async function leaveWaitingDanceOff(params: { danceOffId: string; userId: string }): Promise<DanceOffPayload> {
  return withTransaction(async (client) => {
    const danceOff = await getDanceOffByIdForUpdate(client, params.danceOffId);
    if (!danceOff) {
      throw new Error("Dance-Off not found.");
    }
    if (danceOff.status !== "waiting") {
      throw new Error("You can only leave while the Dance-Off is waiting for players.");
    }

    const participant = await getParticipant(client, danceOff.id, params.userId);
    if (!participant) {
      throw new Error("You are not part of this Dance-Off.");
    }
    if (participant.role === "owner") {
      throw new Error("The creator cannot leave. Cancel the Dance-Off instead.");
    }

    await removeParticipant(client, danceOff.id, params.userId);
    await appendDanceOffEvent(client, danceOff.id, "left", { userId: params.userId, reason: "left_waiting_room" });

    await advanceDanceOffState(client, danceOff.id);
    const refreshed = await getDanceOffById(client, danceOff.id);
    if (!refreshed) {
      throw new Error("Dance-Off not found.");
    }
    const participants = await listParticipants(client, danceOff.id);
    return toPayload(refreshed, participants);
  });
}

export async function cancelDanceOff(params: { danceOffId: string; userId: string; reason?: string }): Promise<void> {
  await withTransaction(async (client) => {
    const danceOff = await getDanceOffByIdForUpdate(client, params.danceOffId);
    if (!danceOff) {
      throw new Error("Dance-Off not found.");
    }
    if (danceOff.ownerUserId !== params.userId) {
      throw new Error("Only the creator can cancel this Dance-Off.");
    }
    if (danceOff.status === "completed" || danceOff.status === "cancelled") {
      return;
    }

    const endedIso = nowIso();
    await updateDanceOffStatus(client, {
      danceOffId: danceOff.id,
      status: "cancelled",
      endedAtIso: endedIso,
      cancelReason: params.reason ?? "cancelled_by_owner",
      isDraw: false,
      winnerUserId: null,
    });
    await appendDanceOffEvent(client, danceOff.id, "cancelled", { byUserId: params.userId, reason: params.reason ?? null });
  });
}

export async function setParticipantReady(params: { danceOffId: string; userId: string; ready: boolean }): Promise<DanceOffPayload> {
  return withTransaction(async (client) => {
    const danceOff = await getDanceOffByIdForUpdate(client, params.danceOffId);
    if (!danceOff) {
      throw new Error("Dance-Off not found.");
    }
    if (danceOff.status !== "ready_check" && danceOff.status !== "countdown") {
      throw new Error("Dance-Off is not in ready-check state.");
    }

    const participant = await getParticipant(client, danceOff.id, params.userId);
    if (!participant) {
      throw new Error("You are not part of this Dance-Off.");
    }

    await updateParticipantReady(client, danceOff.id, params.userId, params.ready);
    await appendDanceOffEvent(client, danceOff.id, params.ready ? "ready" : "unready", { userId: params.userId });

    await advanceDanceOffState(client, danceOff.id);
    const refreshed = await getDanceOffById(client, danceOff.id);
    if (!refreshed) {
      throw new Error("Dance-Off not found.");
    }
    const participants = await listParticipants(client, danceOff.id);
    return toPayload(refreshed, participants);
  });
}

export async function submitDanceOffResult(params: {
  danceOffId: string;
  userId: string;
  result: DanceOffResultSubmission;
}): Promise<DanceOffPayload> {
  return withTransaction(async (client) => {
    const danceOff = await getDanceOffByIdForUpdate(client, params.danceOffId);
    if (!danceOff) {
      throw new Error("Dance-Off not found.");
    }
    if (danceOff.status !== "active") {
      throw new Error("Dance-Off is not active.");
    }

    const participant = await getParticipant(client, danceOff.id, params.userId);
    if (!participant) {
      throw new Error("You are not part of this Dance-Off.");
    }

    const score = Math.max(0, Math.floor(params.result.score));
    const accuracy = Math.max(0, Math.min(100, Number(params.result.accuracy)));
    await saveParticipantResult(client, {
      danceOffId: danceOff.id,
      userId: params.userId,
      score,
      accuracy,
    });
    await appendDanceOffEvent(client, danceOff.id, "result_submitted", { userId: params.userId, score, accuracy });

    await advanceDanceOffState(client, danceOff.id);
    const refreshed = await getDanceOffById(client, danceOff.id);
    if (!refreshed) {
      throw new Error("Dance-Off not found.");
    }
    const participants = await listParticipants(client, danceOff.id);
    return toPayload(refreshed, participants);
  });
}

export async function exitActiveDanceOff(params: { danceOffId: string; userId: string }): Promise<DanceOffPayload> {
  return withTransaction(async (client) => {
    const danceOff = await getDanceOffByIdForUpdate(client, params.danceOffId);
    if (!danceOff) {
      throw new Error("Dance-Off not found.");
    }
    const participant = await getParticipant(client, danceOff.id, params.userId);
    if (!participant) {
      throw new Error("You are not part of this Dance-Off.");
    }
    if (danceOff.status !== "active") {
      throw new Error("Dance-Off is not active.");
    }
    const endedIso = nowIso();
    await updateDanceOffStatus(client, {
      danceOffId: danceOff.id,
      status: "cancelled",
      endedAtIso: endedIso,
      cancelReason: "player_exited",
      winnerUserId: null,
      isDraw: false,
    });
    await appendDanceOffEvent(client, danceOff.id, "cancelled", {
      reason: "player_exited",
      userId: params.userId,
    });
    const refreshed = await getDanceOffById(client, danceOff.id);
    if (!refreshed) {
      throw new Error("Dance-Off not found.");
    }
    const participants = await listParticipants(client, danceOff.id);
    return toPayload(refreshed, participants);
  });
}

export async function handleUserDisconnectInDanceOff(userId: string): Promise<string[]> {
  return withTransaction(async (client) => {
    const affectedDanceOffIds = new Set<string>();
    const danceOffs = await listDanceOffsByParticipantUser(client, userId);
    for (const danceOff of danceOffs) {
      const participants = await listParticipants(client, danceOff.id);
      const participant = participants.find((entry) => entry.userId === userId);
      if (!participant) {
        continue;
      }

      if (danceOff.status === "active") {
        const endedIso = nowIso();
        await updateDanceOffStatus(client, {
          danceOffId: danceOff.id,
          status: "cancelled",
          endedAtIso: endedIso,
          cancelReason: "player_disconnected",
          winnerUserId: null,
          isDraw: false,
        });
        await appendDanceOffEvent(client, danceOff.id, "cancelled", {
          reason: "player_disconnected",
          disconnectedUserId: userId,
        });
        affectedDanceOffIds.add(danceOff.id);
        continue;
      }

      if (participant.role === "owner") {
        const endedIso = nowIso();
        await updateDanceOffStatus(client, {
          danceOffId: danceOff.id,
          status: "cancelled",
          endedAtIso: endedIso,
          cancelReason: "owner_disconnected",
          winnerUserId: null,
          isDraw: false,
        });
        await appendDanceOffEvent(client, danceOff.id, "cancelled", {
          reason: "owner_disconnected",
          disconnectedUserId: userId,
        });
        affectedDanceOffIds.add(danceOff.id);
        continue;
      }

      await removeParticipant(client, danceOff.id, userId);
      await appendDanceOffEvent(client, danceOff.id, "participant_removed", {
        userId,
        reason: "disconnected_before_start",
      });
      await advanceDanceOffState(client, danceOff.id);
      affectedDanceOffIds.add(danceOff.id);
    }
    return Array.from(affectedDanceOffIds);
  });
}

export async function tickDanceOffTransitions(): Promise<string[]> {
  const now = nowIso();
  return withTransaction(async (client) => {
    const readyExpiredIds = await findExpiredReadyChecks(client, now);
    const countdownExpiredIds = await findExpiredCountdowns(client, now);
    const resultTimeoutIds = await findActiveDanceOffsWithResultTimeout(client, now, 60);
    const targets = new Set<string>([...readyExpiredIds, ...countdownExpiredIds, ...resultTimeoutIds]);
    const transitionedIds: string[] = [];
    for (const danceOffId of targets) {
      const before = await getDanceOffById(client, danceOffId);
      await advanceDanceOffState(client, danceOffId);
      const after = await getDanceOffById(client, danceOffId);
      if (before && after && before.status !== after.status) {
        transitionedIds.push(danceOffId);
      }
    }
    return transitionedIds;
  });
}

export async function getDanceOffPayloadById(danceOffId: string): Promise<DanceOffPayload | null> {
  const item = await loadDanceOffItem(danceOffId);
  if (!item) {
    return null;
  }
  return toPayload(item.danceOff, item.participants);
}
