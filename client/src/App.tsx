import { useEffect, useState } from "preact/hooks";
import { WalletAuthCard } from "./components/WalletAuthCard";
import { SubmissionCard } from "./components/SubmissionCard";
import { AdminConsoleCard } from "./components/AdminConsoleCard";
import { MySubmissionsCard } from "./components/MySubmissionsCard";
import { HeroSection } from "./components/HeroSection";
import { OverviewSection } from "./components/OverviewSection";
import { useSession } from "./hooks/useSession";
import { api, type SiteSettings } from "./lib/api";

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

export function App() {
  const { state, setState, refreshSession } = useSession();
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
              {state.authenticated ? (
                <div>
                  <span className="badge ok">Authenticated</span>{" "}
                  {state.isHolder ? <span className="badge ok">Verified Holder</span> : <span className="badge warn">Not a Holder</span>}{" "}
                  {state.isAdmin ? <span className="badge ok">Admin</span> : null}
                  <p className="small">Wallet: {state.publicKey}</p>
                  <div className="row">
                    <button type="button" className="secondary" onClick={() => refreshSession().catch(() => null)}>Refresh Session</button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => api.logout().then(() => setState({ loading: false, authenticated: false, publicKey: "", isHolder: false, isAdmin: false }))}
                    >
                      Logout
                    </button>
                  </div>
                </div>
              ) : (
                <span className="badge warn">Not Authenticated</span>
              )}
            </section>

            <WalletAuthCard onVerified={(session) => setState({ loading: false, ...session })} />
            <MySubmissionsCard enabled={state.authenticated} />
            <SubmissionCard enabled={state.authenticated && state.isHolder} />
            {state.authenticated && state.isAdmin ? (
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
