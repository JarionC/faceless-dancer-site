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
  const [state, setState] = useState<SessionState>({
    loading: true,
    authenticated: false,
    publicKey: "",
    isHolder: false,
    isAdmin: false,
  });

  useEffect(() => {
    api.me()
      .then((data) => setState({ loading: false, ...data }))
      .catch(() => setState((prev) => ({ ...prev, loading: false })));
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
