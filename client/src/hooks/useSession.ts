import { useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../lib/api";

export interface SessionState {
  loading: boolean;
  authenticated: boolean;
  publicKey: string;
  isHolder: boolean;
  isAdmin: boolean;
}

export function useSession() {
  const unauthenticatedState: SessionState = {
    loading: false,
    authenticated: false,
    publicKey: "",
    isHolder: false,
    isAdmin: false,
  };

  const [state, setState] = useState<SessionState>({
    loading: true,
    authenticated: false,
    publicKey: "",
    isHolder: false,
    isAdmin: false,
  });

  useEffect(() => {
    let cancelled = false;
    const hydrate = async (): Promise<void> => {
      try {
        const data = await api.me();
        if (!cancelled) {
          setState({ loading: false, ...data });
        }
        return;
      } catch {
        // Fall through to refresh retry.
      }

      try {
        await api.refresh();
        const data = await api.me();
        if (!cancelled) {
          setState({ loading: false, ...data });
        }
        return;
      } catch {
        // Refresh unavailable/expired -> unauthenticated.
      }

      if (!cancelled) {
        setState(unauthenticatedState);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => ({
    state,
    setState,
    refreshSession: async () => {
      const data = await api.me();
      setState({ loading: false, ...data });
    },
  }), [state]);
}
