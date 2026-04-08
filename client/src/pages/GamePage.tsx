import { useEffect, useState } from "preact/hooks";
import { GameView } from "../game/components/GameView";
import { runtimeConfig } from "../game/config/runtime";
import type { SessionState } from "../hooks/useSession";
import { WalletAuthCard } from "../components/WalletAuthCard";
import { refreshWalletConnectionStatus } from "../lib/walletConnection";
import { DanceOffPresencePanel } from "../game/components/DanceOffPresencePanel";

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
  refreshSession: () => Promise<void>;
}

export function GamePage({ session, setSession, refreshSession }: Props): JSX.Element {
  const [showWalletPanel, setShowWalletPanel] = useState(false);
  const [showDanceOffPanel, setShowDanceOffPanel] = useState(false);
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

  useEffect(() => {
    if (session.authenticated && session.publicKey) {
      setWalletPublicKey(session.publicKey);
    }
  }, [session.authenticated, session.publicKey]);

  useEffect(() => {
    if (gameMode === "play") {
      setShowDanceOffPanel(false);
    }
  }, [gameMode]);

  useEffect(() => {
    const onOpenDanceOffPanel = () => {
      setShowDanceOffPanel(true);
    };
    window.addEventListener("danceoff:panel:open", onOpenDanceOffPanel);
    return () => {
      window.removeEventListener("danceoff:panel:open", onOpenDanceOffPanel);
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
          <button
            type="button"
            className="secondary badge ok"
            onClick={() => setShowDanceOffPanel((prev) => !prev)}
          >
            {showDanceOffPanel ? "Close Dance-Off" : "Dance-Off Online"}
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
        <DanceOffPresencePanel
          open={showDanceOffPanel}
          session={session}
          apiBaseUrl={runtimeConfig.beatApiBaseUrl}
          onClose={() => setShowDanceOffPanel(false)}
        />
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
