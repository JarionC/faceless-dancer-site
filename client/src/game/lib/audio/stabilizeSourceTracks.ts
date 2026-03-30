import type { SourceEvent } from "../../types/beat";

export interface SourceTrackStabilizeConfig {
  maxGapSeconds: number;
  bandWeight: number;
  stemSwitchPenalty: number;
  minEventsPerTrack: number;
}

interface ParsedSource {
  stem: string;
  branch: "h" | "t" | "u";
  band: number;
}

interface TrackState {
  id: number;
  stem: string;
  branch: "h" | "t" | "u";
  meanBand: number;
  meanDuration: number;
  meanStrength: number;
  lastEnd: number;
  firstStart: number;
  eventCount: number;
}

const DEFAULT_CONFIG: SourceTrackStabilizeConfig = {
  maxGapSeconds: 0.9,
  bandWeight: 0.08,
  stemSwitchPenalty: 0.22,
  minEventsPerTrack: 2
};

function parseSource(source: string): ParsedSource {
  const match = source.toLowerCase().match(/^(.*)_([ht])(\d{2})$/);
  if (!match) {
    return { stem: source.toLowerCase(), branch: "u", band: 0 };
  }
  return {
    stem: match[1],
    branch: match[2] as "h" | "t",
    band: Number.parseInt(match[3], 10) || 0
  };
}

function scoreAssignment(
  event: SourceEvent,
  parsed: ParsedSource,
  track: TrackState,
  config: SourceTrackStabilizeConfig
): number {
  const gap = Math.max(0, event.startSeconds - track.lastEnd);
  if (gap > config.maxGapSeconds) {
    return Number.POSITIVE_INFINITY;
  }
  let score = gap * 0.65;
  if (parsed.branch !== track.branch) {
    score += 0.35;
  }
  if (parsed.stem !== track.stem) {
    score += config.stemSwitchPenalty;
  }
  score += Math.abs(parsed.band - track.meanBand) * config.bandWeight;
  score += Math.abs(event.durationSeconds - track.meanDuration) * 0.22;
  score += Math.abs(event.strength - track.meanStrength) * 0.12;
  return score;
}

function updateTrack(track: TrackState, event: SourceEvent, parsed: ParsedSource): void {
  const nextCount = track.eventCount + 1;
  const wOld = track.eventCount / nextCount;
  const wNew = 1 / nextCount;
  track.meanBand = track.meanBand * wOld + parsed.band * wNew;
  track.meanDuration = track.meanDuration * wOld + event.durationSeconds * wNew;
  track.meanStrength = track.meanStrength * wOld + event.strength * wNew;
  track.lastEnd = Math.max(track.lastEnd, event.endSeconds);
  track.eventCount = nextCount;
}

export function stabilizeSourceTracks(
  events: SourceEvent[],
  config: Partial<SourceTrackStabilizeConfig> = {}
): SourceEvent[] {
  if (events.length === 0) {
    return events;
  }
  const cfg: SourceTrackStabilizeConfig = {
    ...DEFAULT_CONFIG,
    ...config
  };
  const sorted = [...events].sort((a, b) => {
    if (a.startSeconds !== b.startSeconds) {
      return a.startSeconds - b.startSeconds;
    }
    return a.endSeconds - b.endSeconds;
  });

  const tracks: TrackState[] = [];
  const assignments: Array<{ event: SourceEvent; trackId: number }> = [];

  for (const event of sorted) {
    const parsed = parseSource(event.source);
    let bestTrack: TrackState | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const track of tracks) {
      const score = scoreAssignment(event, parsed, track, cfg);
      if (score < bestScore) {
        bestScore = score;
        bestTrack = track;
      }
    }

    if (!bestTrack || bestScore > 0.95) {
      const created: TrackState = {
        id: tracks.length + 1,
        stem: parsed.stem,
        branch: parsed.branch,
        meanBand: parsed.band,
        meanDuration: event.durationSeconds,
        meanStrength: event.strength,
        lastEnd: event.endSeconds,
        firstStart: event.startSeconds,
        eventCount: 1
      };
      tracks.push(created);
      assignments.push({ event, trackId: created.id });
      continue;
    }

    updateTrack(bestTrack, event, parsed);
    assignments.push({ event, trackId: bestTrack.id });
  }

  const trackCounts = new Map<number, number>();
  for (const assignment of assignments) {
    trackCounts.set(assignment.trackId, (trackCounts.get(assignment.trackId) ?? 0) + 1);
  }

  const trackFirstStart = new Map<number, number>();
  for (const track of tracks) {
    trackFirstStart.set(track.id, track.firstStart);
  }

  const orderedTrackIds = tracks
    .map((track) => track.id)
    .sort((a, b) => (trackFirstStart.get(a) ?? 0) - (trackFirstStart.get(b) ?? 0));
  const remap = new Map<number, number>();
  orderedTrackIds.forEach((trackId, index) => {
    remap.set(trackId, index + 1);
  });

  return assignments
    .filter((assignment) => (trackCounts.get(assignment.trackId) ?? 0) >= cfg.minEventsPerTrack)
    .map((assignment) => ({
      ...assignment.event,
      source: `inst_${String(remap.get(assignment.trackId) ?? assignment.trackId).padStart(2, "0")}`
    }))
    .sort((a, b) => a.startSeconds - b.startSeconds);
}
