import { useEffect, useState } from "preact/hooks";
import { api, type SiteSettings } from "../lib/api";

interface Props {
  enabled: boolean;
  settings: SiteSettings;
  onSettingsSaved: (settings: SiteSettings) => void;
}

export function AdminConsoleCard({ enabled, settings, onSettingsSaved }: Props) {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [assetsBySubmission, setAssetsBySubmission] = useState<Record<string, any[]>>({});
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(settings);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("Idle");

  const load = async () => {
    const data = await api.adminSubmissions();
    setSubmissions(data.submissions);
  };

  useEffect(() => {
    if (enabled) {
      Promise.all([load(), api.adminSiteSettings()])
        .then(([, adminSettings]) => setSiteSettings(adminSettings))
        .catch((error) => setStatus(error.message));
    }
  }, [enabled]);

  useEffect(() => {
    setSiteSettings(settings);
  }, [settings]);

  const updateStatus = async (submissionId: string, nextStatus: string) => {
    setStatus("Updating status...");
    await api.adminSetStatus(
      submissionId,
      nextStatus,
      nextStatus === "rejected" ? rejectionReasons[submissionId] : undefined
    );
    await load();
    setStatus("Updated");
  };

  const loadAssets = async (submissionId: string) => {
    setStatus("Loading assets...");
    const detail = await api.adminSubmissionDetail(submissionId);
    setAssetsBySubmission((prev) => ({ ...prev, [submissionId]: detail.assets }));
    setStatus("Assets loaded");
  };

  const saveSettings = async () => {
    setStatus("Saving site settings...");
    const saved = await api.saveAdminSiteSettings(siteSettings);
    setSiteSettings(saved);
    onSettingsSaved(saved);
    setStatus("Site settings updated");
  };

  return (
    <section className="card">
      <h2>Admin Console</h2>
      {!enabled ? <span className="badge warn">Admin wallet required</span> : <span className="badge ok">Admin enabled</span>}
      <div className="small">{status}</div>
      {enabled && (
        <div>
          <div className="row">
            <label>
              Twitter URL
              <input value={siteSettings.twitterUrl} onInput={(e) => setSiteSettings((prev) => ({ ...prev, twitterUrl: (e.target as HTMLInputElement).value }))} />
            </label>
            <label>
              Show Twitter
              <select value={siteSettings.showTwitter ? "true" : "false"} onInput={(e) => setSiteSettings((prev) => ({ ...prev, showTwitter: (e.target as HTMLSelectElement).value === "true" }))}>
                <option value="true">Show</option>
                <option value="false">Hide</option>
              </select>
            </label>
            <label>
              YouTube URL
              <input value={siteSettings.youtubeUrl} onInput={(e) => setSiteSettings((prev) => ({ ...prev, youtubeUrl: (e.target as HTMLInputElement).value }))} />
            </label>
            <label>
              Show YouTube
              <select value={siteSettings.showYoutube ? "true" : "false"} onInput={(e) => setSiteSettings((prev) => ({ ...prev, showYoutube: (e.target as HTMLSelectElement).value === "true" }))}>
                <option value="true">Show</option>
                <option value="false">Hide</option>
              </select>
            </label>
            <label>
              Telegram URL
              <input value={siteSettings.telegramUrl} onInput={(e) => setSiteSettings((prev) => ({ ...prev, telegramUrl: (e.target as HTMLInputElement).value }))} />
            </label>
            <label>
              Show Telegram
              <select value={siteSettings.showTelegram ? "true" : "false"} onInput={(e) => setSiteSettings((prev) => ({ ...prev, showTelegram: (e.target as HTMLSelectElement).value === "true" }))}>
                <option value="true">Show</option>
                <option value="false">Hide</option>
              </select>
            </label>
            <label>
              DexScreener URL
              <input value={siteSettings.dexscreenerUrl} onInput={(e) => setSiteSettings((prev) => ({ ...prev, dexscreenerUrl: (e.target as HTMLInputElement).value }))} />
            </label>
            <label>
              Show DexScreener
              <select value={siteSettings.showDexscreener ? "true" : "false"} onInput={(e) => setSiteSettings((prev) => ({ ...prev, showDexscreener: (e.target as HTMLSelectElement).value === "true" }))}>
                <option value="true">Show</option>
                <option value="false">Hide</option>
              </select>
            </label>
            <label>
              pump.fun URL
              <input value={siteSettings.pumpFunUrl} onInput={(e) => setSiteSettings((prev) => ({ ...prev, pumpFunUrl: (e.target as HTMLInputElement).value }))} />
            </label>
            <label>
              Token Address
              <input value={siteSettings.tokenAddress} onInput={(e) => setSiteSettings((prev) => ({ ...prev, tokenAddress: (e.target as HTMLInputElement).value }))} />
            </label>
          </div>

          <button type="button" onClick={() => saveSettings().catch((e) => setStatus(e.message))}>
            Save Site Settings
          </button>

          <div style={{ overflow: "auto", marginTop: "18px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "10px" }}>
            <thead>
              <tr>
                <th align="left">ID</th>
                <th align="left">Title</th>
                <th align="left">Status</th>
                <th align="left">Assets</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((row) => (
                <tr key={row.id}>
                  <td>{row.id.slice(0, 8)}...</td>
                  <td>{row.title}</td>
                  <td>{row.status}</td>
                  <td>{row.asset_count}</td>
                  <td>
                    <label className="small">
                      Rejection Reason
                      <textarea
                        value={rejectionReasons[row.id] ?? row.rejection_reason ?? ""}
                        onInput={(event) =>
                          setRejectionReasons((prev) => ({
                            ...prev,
                            [row.id]: (event.target as HTMLTextAreaElement).value,
                          }))
                        }
                      />
                    </label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button type="button" className="secondary" onClick={() => updateStatus(row.id, "approved").catch((e) => setStatus(e.message))}>Approve</button>
                      <button type="button" className="secondary" onClick={() => updateStatus(row.id, "rejected").catch((e) => setStatus(e.message))}>Reject</button>
                      <button type="button" className="secondary" onClick={() => loadAssets(row.id).catch((e) => setStatus(e.message))}>View Assets</button>
                    </div>
                    {(assetsBySubmission[row.id] ?? []).map((asset) => (
                      <div key={asset.id} className="small">
                        {asset.asset_type} | {asset.original_name} | <a href={`/api/admin/assets/${asset.id}/download`} target="_blank" rel="noreferrer">Download</a>
                      </div>
                    ))}
                    {row.status === "rejected" && row.rejection_reason ? (
                      <div className="small">Reason: {row.rejection_reason}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </section>
  );
}
