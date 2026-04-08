import { io, type Socket } from "socket.io-client";

export interface DanceOffOnlineUser {
  userId: string;
  publicKey: string;
  displayName: string | null;
  connections: number;
}

export type DanceOffStatus = "waiting" | "ready_check" | "countdown" | "active" | "completed" | "cancelled";

export interface DanceOffParticipant {
  userId: string;
  publicKey: string;
  displayName: string | null;
  role: "owner" | "player";
  joinStatus: "joined" | "ready" | "finished";
  finalScore: number | null;
  finalAccuracy: number | null;
}

export interface DanceOffPayload {
  id: string;
  status: DanceOffStatus;
  beatEntryId: string;
  gameMode: "step_arrows" | "orb_beat";
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
  participants: DanceOffParticipant[];
}

const socketUrl = (import.meta.env.VITE_DANCEOFF_SOCKET_URL as string | undefined)?.trim() || undefined;

export function createDanceOffPresenceSocket(displayName: string | null): Socket {
  return io(socketUrl, {
    path: "/socket.io",
    withCredentials: true,
    auth: {
      displayName: displayName ?? "",
    },
    transports: ["websocket", "polling"],
  });
}
