import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Socket } from "socket.io-client";
import type { SessionState } from "../../hooks/useSession";
import {
  createDanceOffPresenceSocket,
  type DanceOffOnlineUser,
  type DanceOffPayload,
} from "../../lib/danceOffSocket";

interface DanceOffPresencePanelProps {
  open: boolean;
  session: SessionState;
  apiBaseUrl: string;
  onClose: () => void;
}

interface CreateRequestDetail {
  beatEntryId: string;
  gameMode: "step_arrows" | "orb_beat" | "laser_shoot";
  difficulty: "easy" | "normal" | "hard";
}

interface MatchResultDetail {
  danceOffId: string;
  score: number;
  accuracy: number;
}

interface MatchAbortDetail {
  danceOffId: string;
}

interface SocketActionResponse {
  ok?: boolean;
  error?: string;
  danceOff?: DanceOffPayload;
  danceOffs?: DanceOffPayload[];
}

const DISPLAY_NAME_STORAGE_KEY = "danceoff_display_name";

function shortenWallet(value: string): string {
  const trimmed = String(value || "").trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function sanitizeDisplayName(input: string): string {
  return input.trim().replace(/\s+/g, " ").slice(0, 32);
}

function toConnectionLabel(status: "idle" | "connecting" | "connected" | "error", errorText: string | null): string {
  if (status === "connecting") return "Connecting...";
  if (status === "connected") return "Connected";
  if (status === "error") return errorText ? `Error: ${errorText}` : "Connection failed";
  return "Idle";
}

function getCountdownSeconds(targetIso: string | null): number {
  if (!targetIso) {
    return 0;
  }
  const remaining = Math.ceil((new Date(targetIso).getTime() - Date.now()) / 1000);
  return Math.max(0, remaining);
}

function formatClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function findSelfParticipant(danceOff: DanceOffPayload, publicKey: string) {
  return danceOff.participants.find((participant) => participant.publicKey === publicKey) ?? null;
}

function formatGameMode(gameMode: CreateRequestDetail["gameMode"]): string {
  if (gameMode === "orb_beat") return "Orb Beat";
  if (gameMode === "laser_shoot") return "Laser Shoot";
  return "Step Arrows";
}

export function DanceOffPresencePanel({ open, session, apiBaseUrl, onClose }: DanceOffPresencePanelProps): JSX.Element | null {
  const socketRef = useRef<Socket | null>(null);
  const completionRetryTimeoutRef = useRef<number | null>(null);
  const [users, setUsers] = useState<DanceOffOnlineUser[]>([]);
  const [danceOffs, setDanceOffs] = useState<DanceOffPayload[]>([]);
  const [songTitlesById, setSongTitlesById] = useState<Record<string, string>>({});
  const [songTitlesLoaded, setSongTitlesLoaded] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [createRequest, setCreateRequest] = useState<CreateRequestDetail | null>(null);
  const [competitors, setCompetitors] = useState(1);
  const [lifecycleModal, setLifecycleModal] = useState<{
    type: "ready_check" | "countdown" | "active" | "completed" | "cancelled";
    danceOff: DanceOffPayload;
    remainingSeconds?: number;
    message?: string;
  } | null>(null);

  useEffect(() => {
    const remembered = sanitizeDisplayName(window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) ?? "");
    if (remembered) {
      setDisplayNameInput(remembered);
    }
  }, []);

  useEffect(() => {
    if (!session.authenticated) {
      setSongTitlesById({});
      setSongTitlesLoaded(false);
      return;
    }
    setSongTitlesLoaded(false);
    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/public/songs/enabled`, { credentials: "include" });
        if (!response.ok) {
          setSongTitlesLoaded(true);
          return;
        }
        const payload = (await response.json()) as { songs?: Array<{ beatEntryId: string; title: string }> };
        const titles: Record<string, string> = {};
        for (const song of payload.songs ?? []) {
          const id = String(song.beatEntryId ?? "").trim();
          const title = String(song.title ?? "").trim();
          if (!id || !title) {
            continue;
          }
          titles[id] = title;
        }
        setSongTitlesById(titles);
      } catch {
        // Keep best-effort behavior if public song list is unavailable.
      } finally {
        setSongTitlesLoaded(true);
      }
    })();
  }, [apiBaseUrl, session.authenticated]);

  useEffect(() => {
    const onCreateRequest = (event: Event) => {
      const detail = (event as CustomEvent<CreateRequestDetail>).detail;
      if (!detail?.beatEntryId) {
        return;
      }
      setCreateRequest(detail);
      setCompetitors(1);
    };

    const onMatchResult = (event: Event) => {
      const detail = (event as CustomEvent<MatchResultDetail>).detail;
      if (!detail?.danceOffId || !socketRef.current) {
        return;
      }
      setErrorText(null);
      socketRef.current.emit(
        "danceoff:submit-result",
        {
          danceOffId: detail.danceOffId,
          score: Math.floor(detail.score),
          accuracy: Number(detail.accuracy),
        },
        (response: SocketActionResponse) => {
          if (!response?.ok) {
            setErrorText(response?.error ?? "Failed to submit Dance-Off result.");
          }
        }
      );
    };

    const onMatchAbort = (event: Event) => {
      const detail = (event as CustomEvent<MatchAbortDetail>).detail;
      if (!detail?.danceOffId || !socketRef.current) {
        return;
      }
      setErrorText(null);
      socketRef.current.emit(
        "danceoff:exit",
        { danceOffId: detail.danceOffId },
        (response: SocketActionResponse) => {
          if (!response?.ok) {
            setErrorText(response?.error ?? "Failed to exit Dance-Off.");
          }
        }
      );
    };

    window.addEventListener("danceoff:create-request", onCreateRequest as EventListener);
    window.addEventListener("danceoff:match-result", onMatchResult as EventListener);
    window.addEventListener("danceoff:match-abort", onMatchAbort as EventListener);

    return () => {
      window.removeEventListener("danceoff:create-request", onCreateRequest as EventListener);
      window.removeEventListener("danceoff:match-result", onMatchResult as EventListener);
      window.removeEventListener("danceoff:match-abort", onMatchAbort as EventListener);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (completionRetryTimeoutRef.current !== null) {
        window.clearTimeout(completionRetryTimeoutRef.current);
        completionRetryTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!session.authenticated) {
      setConnectionStatus("idle");
      setUsers([]);
      setDanceOffs([]);
      setErrorText(null);
      setLifecycleModal(null);
      return;
    }

    const displayName = sanitizeDisplayName(displayNameInput);
    const socket = createDanceOffPresenceSocket(displayName || null);
    socketRef.current = socket;

    setConnectionStatus("connecting");
    setErrorText(null);

    const onConnect = () => {
      setConnectionStatus("connected");
      setErrorText(null);
      socket.emit("danceoff:list", (response: { ok?: boolean; danceOffs?: DanceOffPayload[]; error?: string }) => {
        if (!response?.ok) {
          setErrorText(response?.error ?? "Failed to load Dance-Off list.");
          return;
        }
        setDanceOffs(Array.isArray(response?.danceOffs) ? response.danceOffs : []);
      });
    };

    const onConnectError = (error: Error) => {
      setConnectionStatus("error");
      setErrorText(error.message || "Connection failed.");
    };

    const onOnlineUsers = (payload: { users?: DanceOffOnlineUser[] }) => {
      const nextUsers = Array.isArray(payload?.users) ? payload.users : [];
      setUsers(nextUsers);
    };

    const onDanceOffList = (payload: { danceOffs?: DanceOffPayload[] }) => {
      const nextDanceOffs = Array.isArray(payload?.danceOffs) ? payload.danceOffs : [];
      setDanceOffs(nextDanceOffs);
      setLifecycleModal((current) => {
        if (!current) {
          return current;
        }
        const latest = nextDanceOffs.find((danceOff) => danceOff.id === current.danceOff.id);
        if (!latest && (current.type === "ready_check" || current.type === "countdown" || current.type === "active")) {
          return null;
        }
        if (!latest) {
          return current;
        }
        return { ...current, danceOff: latest };
      });
    };

    const onReadyCheckStart = (payload: { danceOff?: DanceOffPayload; remainingSeconds?: number }) => {
      if (!payload?.danceOff) {
        return;
      }
      setLifecycleModal((current) => {
        if (current?.type === "ready_check" && current.danceOff.id === payload.danceOff!.id) {
          return {
            ...current,
            danceOff: payload.danceOff!,
          };
        }
        return {
          type: "ready_check",
          danceOff: payload.danceOff!,
          remainingSeconds: getCountdownSeconds(payload.danceOff!.readyDeadlineAtIso),
        };
      });
    };

    const onReadyCheckCancelled = () => {
      setLifecycleModal((current) => (current?.type === "ready_check" || current?.type === "countdown" ? null : current));
    };

    const onCountdownStart = (payload: { danceOff?: DanceOffPayload; remainingSeconds?: number }) => {
      if (!payload?.danceOff) {
        return;
      }
      setLifecycleModal((current) => {
        if (current?.type === "countdown" && current.danceOff.id === payload.danceOff!.id) {
          return {
            ...current,
            danceOff: payload.danceOff!,
          };
        }
        return {
          type: "countdown",
          danceOff: payload.danceOff!,
          remainingSeconds: getCountdownSeconds(
            payload.danceOff!.countdownStartedAtIso
              ? new Date(new Date(payload.danceOff!.countdownStartedAtIso).getTime() + 10_000).toISOString()
              : null
          ),
        };
      });
    };

    const onMatchStart = (payload: { danceOff?: DanceOffPayload }) => {
      if (!payload?.danceOff) {
        return;
      }
      setLifecycleModal({ type: "active", danceOff: payload.danceOff, message: "Dance-Off is live. Finish your run!" });
      window.dispatchEvent(new CustomEvent("danceoff:match-start", { detail: payload.danceOff }));
    };

    const resolveCompletedPayload = (danceOffId: string, attempt = 0) => {
      const socketClient = socketRef.current;
      if (!socketClient) {
        return;
      }
      if (completionRetryTimeoutRef.current !== null) {
        window.clearTimeout(completionRetryTimeoutRef.current);
        completionRetryTimeoutRef.current = null;
      }
      socketClient.emit("danceoff:get", { danceOffId }, (response: SocketActionResponse) => {
        const resolved = response?.danceOff;
        const participants = resolved?.participants ?? [];
        const isComplete =
          resolved?.status === "completed" &&
          participants.length > 0 &&
          participants.every((participant) => participant.joinStatus === "finished" && participant.finalScore !== null && participant.finalAccuracy !== null);
        if (isComplete && resolved) {
          window.dispatchEvent(
            new CustomEvent("danceoff:match-completed", {
              detail: { danceOffId: resolved.id, danceOff: resolved },
            })
          );
          return;
        }
        if (attempt >= 12) {
          return;
        }
        completionRetryTimeoutRef.current = window.setTimeout(() => resolveCompletedPayload(danceOffId, attempt + 1), 500);
      });
    };

    const onMatchCompleted = (payload: { danceOff?: DanceOffPayload }) => {
      if (!payload?.danceOff) {
        return;
      }
      resolveCompletedPayload(payload.danceOff.id);
    };

    const onMatchCancelled = (payload: { danceOff?: DanceOffPayload }) => {
      if (!payload?.danceOff) {
        return;
      }
      window.dispatchEvent(
        new CustomEvent("danceoff:match-cancelled", {
          detail: {
            danceOffId: payload.danceOff.id,
            message: payload.danceOff.cancelReason ?? "Dance-Off was cancelled.",
            danceOff: payload.danceOff,
          },
        })
      );
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("danceoff:online-users", onOnlineUsers);
    socket.on("danceoff:list:update", onDanceOffList);
    socket.on("danceoff:ready-check:start", onReadyCheckStart);
    socket.on("danceoff:ready-check:cancelled", onReadyCheckCancelled);
    socket.on("danceoff:countdown:start", onCountdownStart);
    socket.on("danceoff:match:start", onMatchStart);
    socket.on("danceoff:match:completed", onMatchCompleted);
    socket.on("danceoff:match:cancelled", onMatchCancelled);

    return () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("danceoff:online-users", onOnlineUsers);
      socket.off("danceoff:list:update", onDanceOffList);
      socket.off("danceoff:ready-check:start", onReadyCheckStart);
      socket.off("danceoff:ready-check:cancelled", onReadyCheckCancelled);
      socket.off("danceoff:countdown:start", onCountdownStart);
      socket.off("danceoff:match:start", onMatchStart);
      socket.off("danceoff:match:completed", onMatchCompleted);
      socket.off("danceoff:match:cancelled", onMatchCancelled);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session.authenticated]);

  useEffect(() => {
    if (!lifecycleModal || lifecycleModal.type !== "ready_check") {
      return;
    }
    const interval = window.setInterval(() => {
      setLifecycleModal((current) => {
        if (!current || current.type !== "ready_check") {
          return current;
        }
        return {
          ...current,
          remainingSeconds: getCountdownSeconds(current.danceOff.readyDeadlineAtIso),
        };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [lifecycleModal?.type]);

  useEffect(() => {
    if (!lifecycleModal || lifecycleModal.type !== "countdown") {
      return;
    }
    const interval = window.setInterval(() => {
      setLifecycleModal((current) => {
        if (!current || current.type !== "countdown") {
          return current;
        }
        return {
          ...current,
          remainingSeconds: getCountdownSeconds(
            current.danceOff.countdownStartedAtIso
              ? new Date(new Date(current.danceOff.countdownStartedAtIso).getTime() + 10_000).toISOString()
              : null
          ),
        };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [lifecycleModal?.type]);

  useEffect(() => {
    const linkedDanceOff =
      danceOffs.find((danceOff) => danceOff.participants.some((participant) => participant.publicKey === session.publicKey)) ?? null;
    window.dispatchEvent(
      new CustomEvent("danceoff:self-link-state", {
        detail: {
          linked: Boolean(linkedDanceOff),
          danceOffId: linkedDanceOff?.id ?? null,
          status: linkedDanceOff?.status ?? null,
        },
      })
    );
  }, [danceOffs, session.publicKey]);

  const saveDisplayName = (event: Event) => {
    event.preventDefault();
    const nextDisplayName = sanitizeDisplayName(displayNameInput);
    if (nextDisplayName) {
      window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, nextDisplayName);
    } else {
      window.localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
    }

    if (socketRef.current) {
      socketRef.current.emit("danceoff:set-display-name", { displayName: nextDisplayName });
    }
  };

  const createDanceOff = () => {
    if (!createRequest || !socketRef.current) {
      return;
    }
    setErrorText(null);
    socketRef.current.emit(
      "danceoff:create",
      {
        beatEntryId: createRequest.beatEntryId,
        gameMode: createRequest.gameMode,
        difficulty: createRequest.difficulty,
        competitors,
      },
      (response: SocketActionResponse) => {
        if (!response?.ok) {
          setErrorText(response?.error ?? "Failed to create Dance-Off.");
          return;
        }
        if (response.danceOff) {
          setDanceOffs((current) => {
            const filtered = current.filter((entry) => entry.id !== response.danceOff!.id);
            return [response.danceOff!, ...filtered];
          });
        }
      }
    );
    setCreateRequest(null);
  };

  const setReady = (danceOffId: string, ready: boolean) => {
    if (!socketRef.current) {
      return;
    }
    setErrorText(null);
    socketRef.current.emit("danceoff:ready", { danceOffId, ready }, (response: SocketActionResponse) => {
      if (!response?.ok) {
        setErrorText(response?.error ?? "Failed to update ready state.");
      }
    });
  };

  const joinDanceOff = (danceOffId: string) => {
    if (!socketRef.current) {
      return;
    }
    setErrorText(null);
    socketRef.current.emit("danceoff:join", { danceOffId }, (response: SocketActionResponse) => {
      if (!response?.ok) {
        setErrorText(response?.error ?? "Failed to join Dance-Off.");
        return;
      }
      if (response.danceOff) {
        setDanceOffs((current) => {
          const filtered = current.filter((entry) => entry.id !== response.danceOff!.id);
          return [response.danceOff!, ...filtered];
        });
      }
    });
  };

  const leaveDanceOff = (danceOffId: string) => {
    if (!socketRef.current) {
      return;
    }
    setErrorText(null);
    socketRef.current.emit("danceoff:leave", { danceOffId }, (response: SocketActionResponse) => {
      if (!response?.ok) {
        setErrorText(response?.error ?? "Failed to leave Dance-Off.");
        return;
      }
      if (response.danceOff) {
        setDanceOffs((current) => {
          const filtered = current.filter((entry) => entry.id !== response.danceOff!.id);
          return [response.danceOff!, ...filtered];
        });
      }
    });
  };

  const cancelDanceOff = (danceOffId: string) => {
    if (!socketRef.current) {
      return;
    }
    setErrorText(null);
    socketRef.current.emit(
      "danceoff:cancel",
      { danceOffId, reason: "cancelled_by_owner" },
      (response: SocketActionResponse) => {
        if (!response?.ok) {
          setErrorText(response?.error ?? "Failed to cancel Dance-Off.");
          return;
        }
        setDanceOffs((current) => current.filter((entry) => entry.id !== danceOffId));
      }
    );
  };

  const closeLifecycleModal = () => {
    setLifecycleModal(null);
  };

  const onlineCount = useMemo(() => users.length, [users]);
  const selfLinkedDanceOffId = useMemo(
    () =>
      (
        danceOffs.find((danceOff) => danceOff.participants.some((participant) => participant.publicKey === session.publicKey)) ?? null
      )?.id ?? null,
    [danceOffs, session.publicKey]
  );

  if (!open) {
    return null;
  }

  return (
    <section className="danceoff-panel" aria-live="polite">
      <div className="danceoff-panel__header">
        <h3>Dance-Off</h3>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>

      {!session.authenticated ? (
        <p className="small">Connect your wallet first to enter Dance-Off presence.</p>
      ) : (
        <>
          <form className="danceoff-panel__display-name" onSubmit={saveDisplayName}>
            <label>
              Display Name (optional)
              <input
                type="text"
                maxLength={32}
                value={displayNameInput}
                onInput={(event) => setDisplayNameInput(sanitizeDisplayName((event.target as HTMLInputElement).value))}
                placeholder="Your dancer alias"
              />
            </label>
            <button type="submit">Save Name</button>
          </form>

          <div className="danceoff-panel__meta">
            <span className="badge ok">Online: {onlineCount}</span>
            <span className="badge ok">Dance-Offs: {danceOffs.length}</span>
            <span className={connectionStatus === "connected" ? "badge ok" : "badge warn"}>
              {toConnectionLabel(connectionStatus, errorText)}
            </span>
          </div>
          {connectionStatus === "connected" && errorText ? <p className="error">{errorText}</p> : null}

          <div className="danceoff-panel__sections">
            <section className="danceoff-section">
              <h4>Available Dance-Offs</h4>
              <div className="danceoff-panel__list">
                {danceOffs.length === 0 ? <p className="small">No open Dance-Offs.</p> : null}
                {danceOffs.map((danceOff) => {
                  const self = findSelfParticipant(danceOff, session.publicKey);
                  const isOwner = self?.role === "owner";
                  const isParticipant = danceOff.participants.some((participant) => participant.publicKey === session.publicKey);
                  const canLeaveWaitingRoom = Boolean(self && !isOwner && danceOff.status === "waiting");
                  const songTitle = songTitlesById[danceOff.beatEntryId] ?? (songTitlesLoaded ? "Unknown song" : "Loading song title...");
                  return (
                    <article key={danceOff.id} className="danceoff-user danceoff-offer">
                      <div className="danceoff-user__title-row">
                        <strong>{formatGameMode(danceOff.gameMode)} | {danceOff.difficulty}</strong>
                        <span className="badge ok">{danceOff.status}</span>
                      </div>
                      <p className="small">Song: {songTitle}</p>
                      <p className="small">Players: {danceOff.participants.length}/{danceOff.requiredPlayerCount}</p>
                      <div className="danceoff-actions-row">
                        {!isParticipant && !selfLinkedDanceOffId && danceOff.status === "waiting" ? (
                          <button type="button" className="secondary" onClick={() => joinDanceOff(danceOff.id)}>Join</button>
                        ) : null}
                        {canLeaveWaitingRoom ? (
                          <button type="button" className="secondary" onClick={() => leaveDanceOff(danceOff.id)}>Leave</button>
                        ) : null}
                        {isOwner && (danceOff.status === "waiting" || danceOff.status === "ready_check" || danceOff.status === "countdown") ? (
                          <button type="button" className="secondary" onClick={() => cancelDanceOff(danceOff.id)}>Cancel</button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="danceoff-section">
              <h4>Online Users</h4>
              <div className="danceoff-panel__list">
                {users.length === 0 ? <p className="small">No players online yet.</p> : null}
                {users.map((user) => {
                  const isSelf = user.publicKey === session.publicKey;
                  return (
                    <article key={user.userId} className={`danceoff-user${isSelf ? " self" : ""}`}>
                      <div className="danceoff-user__title-row">
                        <strong>{user.displayName || "Unnamed Dancer"}</strong>
                        {isSelf ? <span className="badge ok">You</span> : null}
                      </div>
                      <p className="small">{shortenWallet(user.publicKey)}</p>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        </>
      )}

      {createRequest ? (
        <div className="danceoff-modal" role="dialog" aria-modal="true" onClick={() => setCreateRequest(null)}>
          <div className="danceoff-modal__card" onClick={(event) => event.stopPropagation()}>
            <h3>Create Dance-Off</h3>
            <p className="small">{formatGameMode(createRequest.gameMode)} | {createRequest.difficulty}</p>
            <label>
              Competitors (1-3)
              <input
                type="number"
                min={1}
                max={3}
                value={competitors}
                onInput={(event) => setCompetitors(Math.max(1, Math.min(3, Number((event.target as HTMLInputElement).value || 1))))}
              />
            </label>
            <div className="danceoff-actions-row">
              <button type="button" onClick={createDanceOff}>Create</button>
              <button type="button" className="secondary" onClick={() => setCreateRequest(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {lifecycleModal ? (
        <div
          className="danceoff-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (lifecycleModal.type === "completed" || lifecycleModal.type === "cancelled") {
              closeLifecycleModal();
            }
          }}
        >
          <div className="danceoff-modal__card" onClick={(event) => event.stopPropagation()}>
            {lifecycleModal.type === "ready_check" ? (
              <>
                <h3>Ready Check</h3>
                <p className="small">All players must click Ready in {formatClock(lifecycleModal.remainingSeconds ?? 0)}.</p>
                <div className="danceoff-results-list">
                  {lifecycleModal.danceOff.participants.map((participant) => (
                    <p key={participant.userId} className="small">
                      {participant.displayName || shortenWallet(participant.publicKey)}: {participant.joinStatus === "ready" ? "Ready" : "Not Ready"}
                    </p>
                  ))}
                </div>
                <div className="danceoff-actions-row">
                  <button type="button" onClick={() => setReady(lifecycleModal.danceOff.id, true)}>Ready</button>
                  <button type="button" className="secondary" onClick={() => setReady(lifecycleModal.danceOff.id, false)}>Not Ready</button>
                </div>
              </>
            ) : null}
            {lifecycleModal.type === "countdown" ? (
              <>
                <h3>Starting Soon</h3>
                <p className="small">Dance-Off begins in {formatClock(lifecycleModal.remainingSeconds ?? 0)}.</p>
              </>
            ) : null}
            {lifecycleModal.type === "active" ? (
              <>
                <h3>Dance-Off Live</h3>
                <p className="small">Finish your run. Results publish when all players finish.</p>
              </>
            ) : null}
            {lifecycleModal.type === "completed" ? (
              <>
                <h3>Dance-Off Complete</h3>
                <div className="danceoff-results-list">
                  {lifecycleModal.danceOff.participants.map((participant) => (
                    <p key={participant.userId} className="small">
                      {participant.displayName || shortenWallet(participant.publicKey)}: {participant.finalScore ?? 0}
                    </p>
                  ))}
                </div>
                <p className="small">
                  {lifecycleModal.danceOff.isDraw
                    ? "Result: Draw"
                    : lifecycleModal.danceOff.winnerUserId
                      ? `Winner: ${
                          lifecycleModal.danceOff.participants.find((participant) => participant.userId === lifecycleModal.danceOff.winnerUserId)
                            ?.displayName || "Unknown"
                        }`
                      : "No winner"}
                </p>
                <button type="button" onClick={closeLifecycleModal}>Close</button>
              </>
            ) : null}
            {lifecycleModal.type === "cancelled" ? (
              <>
                <h3>Dance-Off Cancelled</h3>
                <p className="small">{lifecycleModal.message ?? "A player disconnected or exited."}</p>
                <button type="button" onClick={closeLifecycleModal}>Close</button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
