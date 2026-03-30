import { useEffect, useState } from "preact/hooks";
import { GameView } from "../game/components/GameView";
import { runtimeConfig } from "../game/config/runtime";
import type { SessionState } from "../hooks/useSession";
import { WalletAuthCard } from "../components/WalletAuthCard";
import { refreshWalletConnectionStatus } from "../lib/walletConnection";

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
  refreshSession: () => Promise<void>;
}

export function GamePage({ session, setSession, refreshSession }: Props): JSX.Element {
  const [showWalletPanel, setShowWalletPanel] = useState(false);
  const [gameMode, setGameMode] = useState<"menu" | "play" | "scores">("menu");
  const [walletPublicKey, setWalletPublicKey] = useState("");

  useEffect(() => {
    let cancelled = false;

    const syncWalletConnection = async () => {
      const publicKey = await refreshWalletConnectionStatus();
      if (!cancelled) {
        setWalletPublicKey(publicKey);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncWalletConnection();
      }
    };

    void syncWalletConnection();
    window.addEventListener("focus", syncWalletConnection);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncWalletConnection);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const isWalletConnected = walletPublicKey.length > 0;
  const walletButtonLabel = isWalletConnected ? "Wallet Connected" : "Wallet Disconnected";

  return (
    <main className="game-page-root">
      <section className={`game-wallet-dock${gameMode === "play" ? " hidden" : ""}`}>
        <div className="game-wallet-dock__row">
          <span className={session.isHolder ? "badge ok" : "badge warn"}>
            {session.isHolder ? "Holder" : "Non-holder"}
          </span>
          <button
            type="button"
            className={isWalletConnected ? "secondary badge ok" : "secondary badge warn"}
            onClick={() => setShowWalletPanel((prev) => !prev)}
          >
            {showWalletPanel ? "Close Wallet" : walletButtonLabel}
          </button>
        </div>
        {showWalletPanel ? (
          <WalletAuthCard
            onVerified={(next) => {
              setSession({ loading: false, ...next });
              setWalletPublicKey(next.publicKey);
              void refreshSession().catch(() => null);
              setShowWalletPanel(false);
            }}
          />
        ) : null}
      </section>
      <GameView
        apiBaseUrl={runtimeConfig.beatApiBaseUrl}
        canSubmitHolderScore={session.authenticated && session.isHolder}
        holderPublicKey={session.publicKey}
        homeHref="/"
        onModeChange={setGameMode}
      />
    </main>
  );
}
