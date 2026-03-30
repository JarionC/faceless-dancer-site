import { useEffect, useState } from "preact/hooks";
import { WalletAuthCard } from "../components/WalletAuthCard";
import { SubmissionCard } from "../components/SubmissionCard";
import { AdminConsoleCard } from "../components/AdminConsoleCard";
import { MySubmissionsCard } from "../components/MySubmissionsCard";
import { HeroSection } from "../components/HeroSection";
import { OverviewSection } from "../components/OverviewSection";
import { api, type SiteSettings } from "../lib/api";
import type { SessionState } from "../hooks/useSession";

const defaultSiteSettings: SiteSettings = {
  twitterUrl: "",
  showTwitter: true,
  youtubeUrl: "",
  showYoutube: true,
  youtubeLiveChannelId: "",
  telegramUrl: "",
  showTelegram: true,
  dexscreenerUrl: "",
  showDexscreener: true,
  pumpFunUrl: "",
  tokenAddress: "",
};

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
  refreshSession: () => Promise<void>;
}

export function HomePage({ session, setSession, refreshSession }: Props): JSX.Element {
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(defaultSiteSettings);

  useEffect(() => {
    api.siteSettings()
      .then((settings) => setSiteSettings(settings))
      .catch(() => null);
  }, []);

  return (
    <main>
      <div className="page-shell">
        <HeroSection settings={siteSettings} />
        <OverviewSection />

        <section className="tools-section">
          <div className="section-heading">
            <p className="section-kicker">Holder Tools</p>
            <h2 className="section-title">Utility and submission workflow</h2>
            <p className="section-copy">
              This lower section contains the existing wallet verification, submission,
              and admin tooling.
            </p>
          </div>

          <div className="page">
            <section className="card">
              <h1>The Faceless Dancer</h1>
              <p>
                Solana holder-gated requests for stream scheduling and asset submissions.
              </p>
              {session.authenticated ? (
                <div>
                  <span className="badge ok">Authenticated</span>{" "}
                  {session.isHolder ? <span className="badge ok">Verified Holder</span> : <span className="badge warn">Not a Holder</span>}{" "}
                  {session.isAdmin ? <span className="badge ok">Admin</span> : null}
                  <p className="small">Wallet: {session.publicKey}</p>
                  <div className="row">
                    <button type="button" className="secondary" onClick={() => refreshSession().catch(() => null)}>Refresh Session</button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => api.logout().then(() => setSession({ loading: false, authenticated: false, publicKey: "", isHolder: false, isAdmin: false }))}
                    >
                      Logout
                    </button>
                    {session.isAdmin ? (
                      <a className="ghost-link" href="/admin/game">Open Game Builder</a>
                    ) : null}
                  </div>
                </div>
              ) : (
                <span className="badge warn">Not Authenticated</span>
              )}
            </section>

            <WalletAuthCard onVerified={(next) => setSession({ loading: false, ...next })} />
            <MySubmissionsCard enabled={session.authenticated} />
            <SubmissionCard enabled={session.authenticated && session.isHolder} />
            {session.authenticated && session.isAdmin ? (
              <AdminConsoleCard
                enabled
                settings={siteSettings}
                onSettingsSaved={setSiteSettings}
              />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
