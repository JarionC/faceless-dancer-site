import type { Server as HttpServer } from "node:http";
import { parse as parseCookieHeader } from "cookie";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { Server, type Socket } from "socket.io";
import { env } from "../../config/env.js";
import { verifyAccessToken } from "../auth/tokens.js";
import {
  cancelDanceOff,
  createDanceOffWithOwner,
  exitActiveDanceOff,
  getDanceOffPayloadById,
  handleUserDisconnectInDanceOff,
  joinDanceOff,
  leaveWaitingDanceOff,
  listOpenDanceOffPayloads,
  setParticipantReady,
  submitDanceOffResult,
  tickDanceOffTransitions,
} from "./service.js";
import type { DanceOffPayload } from "./types.js";

export interface DanceOffOnlineUser {
  userId: string;
  publicKey: string;
  displayName: string | null;
  connections: number;
}

interface DanceOffSocketData {
  userId: string;
  publicKey: string;
  isHolder: boolean;
  isAdmin: boolean;
  displayName: string | null;
}

type DanceOffSocket = Socket<any, any, any, DanceOffSocketData>;
type FetchedDanceOffSocket = {
  data: DanceOffSocketData;
  emit: (eventName: string, payload: Record<string, unknown>) => void;
};

function sanitizeDisplayName(input: unknown): string | null {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(/\s+/g, " ").slice(0, 32);
  return normalized || null;
}

function sanitizeRedisUrl(input: string): string {
  return input.trim();
}

function nowMs(): number {
  return Date.now();
}

function remainingSeconds(deadlineIso: string | null): number {
  if (!deadlineIso) {
    return 0;
  }
  const remaining = Math.ceil((new Date(deadlineIso).getTime() - nowMs()) / 1000);
  return Math.max(0, remaining);
}

function countdownRemainingSeconds(countdownStartedAtIso: string | null): number {
  if (!countdownStartedAtIso) {
    return 10;
  }
  const elapsed = Math.floor((nowMs() - new Date(countdownStartedAtIso).getTime()) / 1000);
  return Math.max(0, 10 - elapsed);
}

async function configureRedisAdapter(io: Server): Promise<void> {
  const redisUrl = sanitizeRedisUrl(env.DANCEOFF_REDIS_URL);
  if (!redisUrl) {
    console.log("[danceoff] Redis adapter disabled (DANCEOFF_REDIS_URL is empty).");
    return;
  }

  const clientConfig: Record<string, unknown> = { url: redisUrl };
  if (env.DANCEOFF_REDIS_USERNAME) {
    clientConfig.username = env.DANCEOFF_REDIS_USERNAME;
  }
  if (env.DANCEOFF_REDIS_PASSWORD) {
    clientConfig.password = env.DANCEOFF_REDIS_PASSWORD;
  }
  if (env.danceOffRedisTls) {
    clientConfig.socket = { tls: true };
  }

  const pubClient = createClient(clientConfig as any);
  const subClient = pubClient.duplicate();

  pubClient.on("error", (error) => {
    console.error("[danceoff] Redis pub client error", error);
  });
  subClient.on("error", (error) => {
    console.error("[danceoff] Redis sub client error", error);
  });

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log("[danceoff] Redis adapter enabled.");
}

async function findSocketsForUserId(io: Server, userId: string): Promise<DanceOffSocket[]> {
  const sockets = (await io.fetchSockets()) as unknown as FetchedDanceOffSocket[];
  return sockets.filter((socket) => socket.data.userId === userId) as unknown as DanceOffSocket[];
}

async function emitToUser(io: Server, userId: string, eventName: string, payload: Record<string, unknown>): Promise<void> {
  const sockets = await findSocketsForUserId(io, userId);
  for (const socket of sockets) {
    socket.emit(eventName as any, payload as any);
  }
}

async function emitDanceOffToParticipants(io: Server, danceOff: DanceOffPayload, eventName: string): Promise<void> {
  const userIds = new Set<string>(danceOff.participants.map((entry) => entry.userId));
  for (const userId of userIds) {
    await emitToUser(io, userId, eventName, { danceOff });
  }
}

function pickParticipantDanceOff(danceOffs: DanceOffPayload[], userId: string): DanceOffPayload | null {
  const participantDanceOffs = danceOffs.filter((danceOff) => danceOff.participants.some((entry) => entry.userId === userId));
  if (participantDanceOffs.length === 0) {
    return null;
  }
  const priority = (status: DanceOffPayload["status"]): number => {
    if (status === "active") return 0;
    if (status === "countdown") return 1;
    if (status === "ready_check") return 2;
    if (status === "waiting") return 3;
    return 4;
  };
  return participantDanceOffs.sort((a, b) => {
    const p = priority(a.status) - priority(b.status);
    if (p !== 0) {
      return p;
    }
    return a.createdAtIso > b.createdAtIso ? -1 : 1;
  })[0];
}

export async function createDanceOffSocketServer(httpServer: HttpServer): Promise<Server> {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    },
  });

  await configureRedisAdapter(io);

  io.use((socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie ?? "";
      const cookies = parseCookieHeader(cookieHeader);
      const accessToken = cookies.accessToken;
      if (!accessToken) {
        return next(new Error("Unauthorized"));
      }

      const session = verifyAccessToken(accessToken);
      socket.data.userId = session.userId;
      socket.data.publicKey = session.publicKey;
      socket.data.isHolder = session.isHolder;
      socket.data.isAdmin = session.isAdmin;
      socket.data.displayName = sanitizeDisplayName(socket.handshake.auth?.displayName);
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  const broadcastOnlineUsers = async (): Promise<void> => {
    const sockets = (await io.fetchSockets()) as unknown as FetchedDanceOffSocket[];
    const byUserId = new Map<string, DanceOffOnlineUser>();

    for (const connectedSocket of sockets) {
      const userId = connectedSocket.data.userId;
      const publicKey = connectedSocket.data.publicKey;
      if (!userId || !publicKey) {
        continue;
      }

      const current = byUserId.get(userId);
      const displayName = sanitizeDisplayName(connectedSocket.data.displayName);
      if (!current) {
        byUserId.set(userId, {
          userId,
          publicKey,
          displayName,
          connections: 1,
        });
        continue;
      }

      current.connections += 1;
      if (!current.displayName && displayName) {
        current.displayName = displayName;
      }
    }

    const users = Array.from(byUserId.values()).sort((a, b) => a.publicKey.localeCompare(b.publicKey));
    io.emit("danceoff:online-users", { users, count: users.length });
  };

  const broadcastDanceOffState = async (): Promise<void> => {
    const danceOffs = await listOpenDanceOffPayloads();
    io.emit("danceoff:list:update", { danceOffs });
    for (const danceOff of danceOffs) {
      if (danceOff.status !== "active") {
        continue;
      }
      if (notifiedActiveStarts.has(danceOff.id)) {
        continue;
      }
      await emitDanceOffToParticipants(io, danceOff, "danceoff:match:start");
      notifiedActiveStarts.add(danceOff.id);
    }
    const activeDanceOffIds = new Set(
      danceOffs.filter((danceOff) => danceOff.status === "active").map((danceOff) => danceOff.id)
    );
    for (const knownActiveId of Array.from(notifiedActiveStarts)) {
      if (!activeDanceOffIds.has(knownActiveId)) {
        notifiedActiveStarts.delete(knownActiveId);
      }
    }

    const sockets = (await io.fetchSockets()) as unknown as FetchedDanceOffSocket[];
    const userIds = Array.from(new Set(sockets.map((socket) => socket.data.userId).filter(Boolean)));
    for (const userId of userIds) {
      const danceOff = pickParticipantDanceOff(danceOffs, userId);
      if (!danceOff) {
        await emitToUser(io, userId, "danceoff:ready-check:cancelled", { reason: "waiting" });
        continue;
      }

      if (danceOff.status === "ready_check") {
        await emitToUser(io, userId, "danceoff:ready-check:start", {
          danceOff,
          remainingSeconds: remainingSeconds(danceOff.readyDeadlineAtIso),
        });
        continue;
      }
      if (danceOff.status === "countdown") {
        await emitToUser(io, userId, "danceoff:countdown:start", {
          danceOff,
          remainingSeconds: countdownRemainingSeconds(danceOff.countdownStartedAtIso),
        });
        continue;
      }
      if (danceOff.status === "active") {
        continue;
      }

      await emitToUser(io, userId, "danceoff:ready-check:cancelled", { reason: "waiting" });
    }
  };

  const broadcastEverything = async (): Promise<void> => {
    await Promise.all([broadcastOnlineUsers(), broadcastDanceOffState()]);
  };
  const notifiedActiveStarts = new Set<string>();

  const handleActionError = (callback: ((payload: Record<string, unknown>) => void) | undefined, error: unknown) => {
    const message = error instanceof Error ? error.message : "Action failed.";
    callback?.({ ok: false, error: message });
  };

  io.on("connection", (socket: DanceOffSocket) => {
    socket.on("danceoff:set-display-name", async (payload: { displayName?: string } | null | undefined) => {
      socket.data.displayName = sanitizeDisplayName(payload?.displayName);
      await broadcastOnlineUsers();
    });

    socket.on("danceoff:list", async (callback?: (payload: Record<string, unknown>) => void) => {
      try {
        const danceOffs = await listOpenDanceOffPayloads();
        callback?.({ ok: true, danceOffs });
      } catch (error) {
        handleActionError(callback, error);
      }
    });

    socket.on(
      "danceoff:create",
      async (
        payload: {
          beatEntryId?: string;
          gameMode?: "step_arrows" | "orb_beat";
          difficulty?: "easy" | "normal" | "hard";
          competitors?: number;
        } | null | undefined,
        callback?: (response: Record<string, unknown>) => void
      ) => {
        try {
          const beatEntryId = String(payload?.beatEntryId ?? "").trim();
          const gameMode = payload?.gameMode === "orb_beat" ? "orb_beat" : "step_arrows";
          const difficulty = payload?.difficulty === "easy" || payload?.difficulty === "hard" ? payload.difficulty : "normal";
          const competitors = Math.max(1, Math.min(3, Math.floor(Number(payload?.competitors ?? 1))));
          if (!beatEntryId) {
            throw new Error("beatEntryId is required.");
          }
          const danceOff = await createDanceOffWithOwner({
            ownerUserId: socket.data.userId,
            ownerPublicKey: socket.data.publicKey,
            ownerDisplayName: socket.data.displayName,
            beatEntryId,
            gameMode,
            difficulty,
            competitors,
          });
          callback?.({ ok: true, danceOff });
          await broadcastDanceOffState();
        } catch (error) {
          handleActionError(callback, error);
        }
      }
    );

    socket.on(
      "danceoff:join",
      async (payload: { danceOffId?: string } | null | undefined, callback?: (response: Record<string, unknown>) => void) => {
        try {
          const danceOffId = String(payload?.danceOffId ?? "").trim();
          if (!danceOffId) {
            throw new Error("danceOffId is required.");
          }
          const danceOff = await joinDanceOff({
            danceOffId,
            userId: socket.data.userId,
            publicKey: socket.data.publicKey,
            displayName: socket.data.displayName,
          });
          callback?.({ ok: true, danceOff });
          await broadcastDanceOffState();
        } catch (error) {
          handleActionError(callback, error);
        }
      }
    );

    socket.on(
      "danceoff:leave",
      async (payload: { danceOffId?: string } | null | undefined, callback?: (response: Record<string, unknown>) => void) => {
        try {
          const danceOffId = String(payload?.danceOffId ?? "").trim();
          if (!danceOffId) {
            throw new Error("danceOffId is required.");
          }
          const danceOff = await leaveWaitingDanceOff({
            danceOffId,
            userId: socket.data.userId,
          });
          callback?.({ ok: true, danceOff });
          await broadcastDanceOffState();
        } catch (error) {
          handleActionError(callback, error);
        }
      }
    );

    socket.on(
      "danceoff:cancel",
      async (
        payload: { danceOffId?: string; reason?: string } | null | undefined,
        callback?: (response: Record<string, unknown>) => void
      ) => {
        try {
          const danceOffId = String(payload?.danceOffId ?? "").trim();
          if (!danceOffId) {
            throw new Error("danceOffId is required.");
          }
          await cancelDanceOff({
            danceOffId,
            userId: socket.data.userId,
            reason: String(payload?.reason ?? "").trim() || undefined,
          });
          const danceOff = await getDanceOffPayloadById(danceOffId);
          if (danceOff) {
            await emitDanceOffToParticipants(io, danceOff, "danceoff:match:cancelled");
          }
          callback?.({ ok: true });
          await broadcastDanceOffState();
        } catch (error) {
          handleActionError(callback, error);
        }
      }
    );

    socket.on(
      "danceoff:ready",
      async (payload: { danceOffId?: string; ready?: boolean } | null | undefined, callback?: (response: Record<string, unknown>) => void) => {
        try {
          const danceOffId = String(payload?.danceOffId ?? "").trim();
          if (!danceOffId) {
            throw new Error("danceOffId is required.");
          }
          const ready = Boolean(payload?.ready);
          const danceOff = await setParticipantReady({
            danceOffId,
            userId: socket.data.userId,
            ready,
          });
          callback?.({ ok: true, danceOff });
          await broadcastDanceOffState();
        } catch (error) {
          handleActionError(callback, error);
        }
      }
    );

    socket.on(
      "danceoff:exit",
      async (payload: { danceOffId?: string } | null | undefined, callback?: (response: Record<string, unknown>) => void) => {
        try {
          const danceOffId = String(payload?.danceOffId ?? "").trim();
          if (!danceOffId) {
            throw new Error("danceOffId is required.");
          }
          const danceOff = await exitActiveDanceOff({
            danceOffId,
            userId: socket.data.userId,
          });
          await emitDanceOffToParticipants(io, danceOff, "danceoff:match:cancelled");
          callback?.({ ok: true, danceOff });
          await broadcastDanceOffState();
        } catch (error) {
          handleActionError(callback, error);
        }
      }
    );

    socket.on(
      "danceoff:submit-result",
      async (
        payload: { danceOffId?: string; score?: number; accuracy?: number } | null | undefined,
        callback?: (response: Record<string, unknown>) => void
      ) => {
        try {
          const danceOffId = String(payload?.danceOffId ?? "").trim();
          if (!danceOffId) {
            throw new Error("danceOffId is required.");
          }
          const danceOff = await submitDanceOffResult({
            danceOffId,
            userId: socket.data.userId,
            result: {
              score: Number(payload?.score ?? 0),
              accuracy: Number(payload?.accuracy ?? 0),
            },
          });
          if (danceOff.status === "completed") {
            await emitDanceOffToParticipants(io, danceOff, "danceoff:match:completed");
          }
          callback?.({ ok: true, danceOff });
          await broadcastDanceOffState();
        } catch (error) {
          handleActionError(callback, error);
        }
      }
    );

    void broadcastEverything();

    socket.on("disconnect", () => {
      void (async () => {
        const affectedIds = await handleUserDisconnectInDanceOff(socket.data.userId);
        for (const danceOffId of affectedIds) {
          const danceOff = await getDanceOffPayloadById(danceOffId);
          if (danceOff?.status === "cancelled") {
            await emitDanceOffToParticipants(io, danceOff, "danceoff:match:cancelled");
          }
        }
        await broadcastEverything();
      })();
    });
  });

  io.engine.on("connection_error", (error) => {
    console.warn("[danceoff] socket connection rejected", error.message);
  });

  setInterval(() => {
    void (async () => {
      const transitionedIds = await tickDanceOffTransitions();
      for (const danceOffId of transitionedIds) {
        const danceOff = await getDanceOffPayloadById(danceOffId);
        if (!danceOff) {
          continue;
        }
        if (danceOff.status === "cancelled") {
          await emitDanceOffToParticipants(io, danceOff, "danceoff:match:cancelled");
        }
        if (danceOff.status === "completed") {
          await emitDanceOffToParticipants(io, danceOff, "danceoff:match:completed");
        }
      }
      await broadcastDanceOffState();
    })();
  }, 1000);

  return io;
}
