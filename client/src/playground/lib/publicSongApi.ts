import type { SavedBeatEntry } from "../../game/types/beat";
import type { PlaygroundSongSummary } from "../types";

interface EnabledSongsResponse {
  songs: PlaygroundSongSummary[];
}

interface BeatEntryResponse {
  ok: boolean;
  entry: SavedBeatEntry;
}

function normalizeApiBase(baseUrl: string): string {
  const value = String(baseUrl || "").trim();
  if (!value) return "/api/game";
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.replace(/\/+$/, "");
  }
  if (!value.startsWith("/")) {
    return `/${value}`.replace(/\/+$/, "");
  }
  return value.replace(/\/+$/, "");
}

function buildCandidates(baseUrl: string, path: string): string[] {
  const normalizedBase = normalizeApiBase(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const primary = `${normalizedBase}${normalizedPath}`;
  const fallback = `/api/game${normalizedPath}`;
  if (primary === fallback) return [primary];
  return [primary, fallback];
}

async function fetchJsonFromCandidates<T>(urls: string[]): Promise<T> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: "include" });
      const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
      const rawText = await response.text();
      if (!contentType.includes("application/json")) {
        const snippet = rawText.slice(0, 80).replace(/\s+/g, " ").trim();
        throw new Error(
          `Expected JSON from ${url}, got ${contentType || "unknown"}: ${snippet || "[empty]"}`
        );
      }
      const body = JSON.parse(rawText) as T & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `Request failed (${response.status}) at ${url}`);
      }
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed.");
}

export async function fetchEnabledSongs(apiBaseUrl: string): Promise<PlaygroundSongSummary[]> {
  const payload = await fetchJsonFromCandidates<EnabledSongsResponse>(
    buildCandidates(apiBaseUrl, "/api/public/songs/enabled")
  );
  return payload.songs ?? [];
}

export async function fetchPublicBeatEntry(apiBaseUrl: string, entryId: string): Promise<SavedBeatEntry> {
  const payload = await fetchJsonFromCandidates<BeatEntryResponse>(
    buildCandidates(apiBaseUrl, `/api/public/beats/${encodeURIComponent(entryId)}`)
  );
  return payload.entry;
}

export function buildPublicAudioUrl(apiBaseUrl: string, entryId: string): string {
  return `${normalizeApiBase(apiBaseUrl)}/api/public/beats/${encodeURIComponent(entryId)}/audio`;
}

export function resolveAccentBeats(entry: SavedBeatEntry): Array<{ timeSeconds: number; strength: number }> {
  const fromGameBeats = Array.isArray(entry.gameBeats) ? entry.gameBeats : [];
  if (fromGameBeats.length > 0) {
    return fromGameBeats;
  }
  return Array.isArray(entry.majorBeats) ? entry.majorBeats : [];
}
