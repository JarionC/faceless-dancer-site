import type { DanceOffParticipantRecord, DanceOffRecord } from "./types.js";

export interface DanceOffTransitionDecision {
  nextStatus: DanceOffRecord["status"] | null;
  reason?: string;
}

export function shouldEnterReadyCheck(danceOff: DanceOffRecord, participants: DanceOffParticipantRecord[]): boolean {
  if (danceOff.status !== "waiting") {
    return false;
  }
  return participants.length >= danceOff.requiredPlayerCount;
}

export function shouldReturnToWaitingFromReadyCheck(
  danceOff: DanceOffRecord,
  participants: DanceOffParticipantRecord[],
  now: Date
): DanceOffTransitionDecision {
  if (danceOff.status !== "ready_check") {
    return { nextStatus: null };
  }
  if (participants.length < danceOff.requiredPlayerCount) {
    return { nextStatus: "waiting", reason: "participant_count_dropped" };
  }
  const allReady = participants.length > 0 && participants.every((participant) => participant.joinStatus === "ready");
  if (allReady) {
    return { nextStatus: "countdown", reason: "all_ready" };
  }
  if (danceOff.readyDeadlineAtIso && new Date(danceOff.readyDeadlineAtIso).getTime() <= now.getTime()) {
    return { nextStatus: "waiting", reason: "ready_timeout" };
  }
  return { nextStatus: null };
}

export function shouldAdvanceCountdown(
  danceOff: DanceOffRecord,
  participants: DanceOffParticipantRecord[],
  now: Date
): DanceOffTransitionDecision {
  if (danceOff.status !== "countdown") {
    return { nextStatus: null };
  }
  if (participants.length < danceOff.requiredPlayerCount) {
    return { nextStatus: "waiting", reason: "participant_count_dropped" };
  }
  const allReady = participants.length > 0 && participants.every((participant) => participant.joinStatus === "ready");
  if (!allReady) {
    return { nextStatus: "waiting", reason: "readiness_lost" };
  }
  if (!danceOff.countdownStartedAtIso) {
    return { nextStatus: null };
  }
  const startsAt = new Date(danceOff.countdownStartedAtIso).getTime();
  if (startsAt + 10_000 <= now.getTime()) {
    return { nextStatus: "active", reason: "countdown_elapsed" };
  }
  return { nextStatus: null };
}

export function shouldCompleteDanceOff(danceOff: DanceOffRecord, participants: DanceOffParticipantRecord[]): boolean {
  if (danceOff.status !== "active") {
    return false;
  }
  if (participants.length !== danceOff.requiredPlayerCount) {
    return false;
  }
  return participants.every((participant) => participant.joinStatus === "finished" && participant.finalScore !== null);
}

export function shouldCancelActiveDanceOffForResultTimeout(
  danceOff: DanceOffRecord,
  participants: DanceOffParticipantRecord[],
  now: Date,
  timeoutSeconds: number
): boolean {
  if (danceOff.status !== "active") {
    return false;
  }
  const finishedParticipants = participants.filter((participant) => participant.joinStatus === "finished" && participant.finishedAtIso);
  const pendingParticipants = participants.filter((participant) => participant.joinStatus !== "finished");
  if (finishedParticipants.length === 0 || pendingParticipants.length === 0) {
    return false;
  }
  const earliestFinishedAtMs = Math.min(
    ...finishedParticipants.map((participant) => new Date(participant.finishedAtIso as string).getTime())
  );
  return earliestFinishedAtMs + timeoutSeconds * 1000 <= now.getTime();
}

export function resolveWinner(participants: DanceOffParticipantRecord[]): { winnerUserId: string | null; isDraw: boolean } {
  const finished = participants
    .filter((participant) => participant.finalScore !== null)
    .map((participant) => ({ userId: participant.userId, score: participant.finalScore ?? 0 }))
    .sort((a, b) => b.score - a.score);
  if (finished.length === 0) {
    return { winnerUserId: null, isDraw: false };
  }
  if (finished.length > 1 && finished[0].score === finished[1].score) {
    return { winnerUserId: null, isDraw: true };
  }
  return { winnerUserId: finished[0].userId, isDraw: false };
}
