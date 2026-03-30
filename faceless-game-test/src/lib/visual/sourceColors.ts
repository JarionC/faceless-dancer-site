import type { SourceName } from "../../types/beat";

const NAMED_COLORS: Record<string, string> = {
  drums: "#e63946",
  bass: "#1d3557",
  vocals: "#ff7f11",
  guitar: "#2a9d8f",
  piano: "#6a4c93"
};

function hashLabel(label: string): number {
  let hash = 2166136261;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getSourceColor(source: SourceName): string {
  const normalized = source.toLowerCase();
  if (NAMED_COLORS[normalized]) {
    return NAMED_COLORS[normalized];
  }

  const hash = hashLabel(normalized);
  const hue = hash % 360;
  const saturation = 68 + (hash % 18); // 68..85
  const lightness = 38 + (hash % 16); // 38..53
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function formatSourceLabel(source: SourceName): string {
  return source.replace(/_/g, " ");
}

const PRIORITY_ORDER = ["drums", "bass", "vocals", "guitar", "piano"];

function sourceRank(label: string): [number, number, string] {
  const normalized = label.toLowerCase();
  const priority = PRIORITY_ORDER.indexOf(normalized);
  if (priority >= 0) {
    return [0, priority, normalized];
  }
  const match = normalized.match(/^source_(\d+)$/);
  if (match) {
    return [1, Number.parseInt(match[1], 10), normalized];
  }
  return [2, 0, normalized];
}

export function sortSourceLabels(sources: SourceName[]): SourceName[] {
  return [...sources].sort((a, b) => {
    const ra = sourceRank(a);
    const rb = sourceRank(b);
    if (ra[0] !== rb[0]) {
      return ra[0] - rb[0];
    }
    if (ra[1] !== rb[1]) {
      return ra[1] - rb[1];
    }
    return ra[2].localeCompare(rb[2]);
  });
}
