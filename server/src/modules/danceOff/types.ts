export type DanceOffStatus = "waiting" | "ready_check" | "countdown" | "active" | "completed" | "cancelled";
export type DanceOffParticipantRole = "owner" | "player";
export type DanceOffParticipantJoinStatus = "joined" | "ready" | "finished";

export interface DanceOffRecord {
  id: string;
  ownerUserId: string;
  beatEntryId: string;
  gameMode: "step_arrows" | "orb_beat" | "laser_shoot";
  difficulty: "easy" | "normal" | "hard";
  requiredPlayerCount: number;
  status: DanceOffStatus;
  cancelReason: string | null;
  readyDeadlineAtIso: string | null;
  countdownStartedAtIso: string | null;
  startedAtIso: string | null;
  endedAtIso: string | null;
  winnerUserId: string | null;
  isDraw: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface DanceOffParticipantRecord {
  id: string;
  danceOffId: string;
  userId: string;
  publicKey: string;
  displayNameSnapshot: string | null;
  role: DanceOffParticipantRole;
  joinStatus: DanceOffParticipantJoinStatus;
  joinedAtIso: string;
  readyAtIso: string | null;
  finishedAtIso: string | null;
  finalScore: number | null;
  finalAccuracy: number | null;
}

export interface DanceOffListItem {
  danceOff: DanceOffRecord;
  participants: DanceOffParticipantRecord[];
}

export interface DanceOffResultSubmission {
  score: number;
  accuracy: number;
}

export interface DanceOffParticipantView {
  userId: string;
  publicKey: string;
  displayName: string | null;
  role: DanceOffParticipantRole;
  joinStatus: DanceOffParticipantJoinStatus;
  finalScore: number | null;
  finalAccuracy: number | null;
}

export interface DanceOffPayload {
  id: string;
  status: DanceOffStatus;
  beatEntryId: string;
  gameMode: "step_arrows" | "orb_beat" | "laser_shoot";
  difficulty: "easy" | "normal" | "hard";
  requiredPlayerCount: number;
  ownerUserId: string;
  cancelReason: string | null;
  isDraw: boolean;
  winnerUserId: string | null;
  readyDeadlineAtIso: string | null;
  countdownStartedAtIso: string | null;
  startedAtIso: string | null;
  endedAtIso: string | null;
  createdAtIso: string;
  updatedAtIso: string;
  participants: DanceOffParticipantView[];
}

export interface DanceOffReadyModalPayload {
  danceOff: DanceOffPayload;
  remainingSeconds: number;
}
