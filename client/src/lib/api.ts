const API_BASE = "/api";

export interface SiteSettings {
  twitterUrl: string;
  showTwitter: boolean;
  youtubeUrl: string;
  showYoutube: boolean;
  telegramUrl: string;
  showTelegram: boolean;
  dexscreenerUrl: string;
  showDexscreener: boolean;
  pumpFunUrl: string;
  tokenAddress: string;
}

export interface PublicScheduleSlot {
  submission_id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }

  return response.json();
}

export const api = {
  nonce: (publicKey: string) => apiFetch<{ nonce: string; message: string; expiresAt: string }>("/auth/nonce", {
    method: "POST",
    body: JSON.stringify({ publicKey }),
  }),

  verify: (payload: { publicKey: string; nonce: string; message: string; signature: string }) =>
    apiFetch<{ authenticated: boolean; publicKey: string; isHolder: boolean; isAdmin: boolean }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  me: () => apiFetch<{ authenticated: boolean; publicKey: string; isHolder: boolean; isAdmin: boolean }>("/auth/me"),

  refresh: () => apiFetch<{ refreshed: boolean }>("/auth/refresh", { method: "POST" }),

  logout: () => apiFetch<{ loggedOut: boolean }>("/auth/logout", { method: "POST" }),

  createSubmission: (payload: { title: string; notes?: string; desiredStart: string; desiredEnd: string }) =>
    apiFetch<{ submissionId: string; status: string }>("/submissions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  mySubmissions: () => apiFetch<{ submissions: any[] }>("/submissions/me"),

  siteSettings: () => apiFetch<SiteSettings>("/site-settings"),

  publicSchedule: () => apiFetch<{ slots: PublicScheduleSlot[] }>("/schedule/public"),

  adminSiteSettings: () => apiFetch<SiteSettings>("/site-settings/admin"),

  saveAdminSiteSettings: (payload: SiteSettings) =>
    apiFetch<SiteSettings>("/site-settings/admin", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  adminSubmissions: () => apiFetch<{ submissions: any[] }>("/admin/submissions"),

  adminSubmissionDetail: (submissionId: string) => apiFetch<{ submission: any; assets: any[] }>(`/admin/submissions/${submissionId}`),

  adminSetStatus: (submissionId: string, status: string, rejectionReason?: string) =>
    apiFetch<{ updated: boolean }>(`/admin/submissions/${submissionId}/status`, {
      method: "POST",
      body: JSON.stringify({ status, rejectionReason }),
    }),

  uploadAsset: async (assetType: string, file: File, submissionId?: string) => {
    const formData = new FormData();
    formData.set("assetType", assetType);
    formData.set("file", file);

    const path = submissionId ? `/submissions/${submissionId}/assets` : "/submissions/assets";
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Upload failed (${response.status})`);
    }

    return response.json() as Promise<{ submissionId: string; assetId: string; publicUrl: string }>;
  },
};
