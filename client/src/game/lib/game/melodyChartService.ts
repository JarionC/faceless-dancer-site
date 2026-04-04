import type { BeatPoint, SavedBeatEntry } from "../../types/beat";
import { type GameMode, normalizeGameMode } from "./difficultyCharts";

export type StepArrowLane = "left" | "up" | "down" | "right";
export type OrbBeatLane = "l1" | "l2" | "l3" | "r1" | "r2" | "r3";
export type GameLane = StepArrowLane | OrbBeatLane;
export type GameNoteType = "tap" | "hold";

export interface MelodyNote {
  id: string;
  timeSeconds: number;
  endSeconds: number;
  lane: GameLane;
  strength: number;
  type: GameNoteType;
}

const stepArrowLaneOrder: StepArrowLane[] = ["left", "down", "up", "right"];
const orbBeatLaneOrder: OrbBeatLane[] = ["l1", "l2", "l3", "r1", "r2", "r3"];

function hashString(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRng(seed: string): () => number {
  let state = hashString(seed) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickLane<TLane extends string>(
  rng: () => number,
  lanes: readonly TLane[],
  previousLane: TLane | null,
  previousPreviousLane: TLane | null,
  disallowed: Set<TLane>
): TLane {
  const candidates = lanes.filter((lane) => !disallowed.has(lane));
  const available = candidates.length > 0 ? candidates : [...lanes];
  const weighted = available.map((lane) => {
    let weight = 1;
    if (previousLane && lane === previousLane) {
      weight *= 0.08;
    }
    if (previousPreviousLane && lane === previousPreviousLane) {
      weight *= 0.55;
    }
    return { lane, weight };
  });
  const total = weighted.reduce((sum, row) => sum + row.weight, 0);
  let cursor = rng() * Math.max(0.0001, total);
  for (const row of weighted) {
    cursor -= row.weight;
    if (cursor <= 0) {
      return row.lane;
    }
  }
  return weighted[weighted.length - 1]?.lane ?? lanes[0];
}

function chooseSecondaryLane<TLane extends string>(
  rng: () => number,
  lanes: readonly TLane[],
  primary: TLane,
  occupiedAtTime: Set<TLane>
): TLane | null {
  const options = lanes.filter((lane) => lane !== primary && !occupiedAtTime.has(lane));
  if (options.length === 0) {
    return null;
  }
  return options[Math.floor(rng() * options.length)] ?? null;
}

function buildModeNotes<TLane extends string>(
  entry: SavedBeatEntry,
  lanes: readonly TLane[],
  noteIdPrefix: string
): MelodyNote[] {
  const rng = createSeededRng(`${entry.id}:${entry.savedAtIso}:${entry.entry?.name ?? ""}:${noteIdPrefix}`);
  const gameNotes = Array.isArray(entry.gameNotes) ? entry.gameNotes : [];
  if (gameNotes.length > 0) {
    const sorted = [...gameNotes].sort((a, b) => a.timeSeconds - b.timeSeconds);
    let previousLane: TLane | null = null;
    let previousPreviousLane: TLane | null = null;
    const occupiedByBucket = new Map<number, Set<TLane>>();
    const base = sorted.map((note, index) => {
      const timeSeconds = Math.max(0, note.timeSeconds);
      const bucket = Math.round(timeSeconds * 20);
      const occupied = occupiedByBucket.get(bucket) ?? new Set<TLane>();
      const lane = pickLane(rng, lanes, previousLane, previousPreviousLane, occupied);
      occupied.add(lane);
      occupiedByBucket.set(bucket, occupied);
      previousPreviousLane = previousLane;
      previousLane = lane;
      const endSeconds = Math.max(timeSeconds, note.endSeconds);
      const durationSeconds = endSeconds - timeSeconds;
      return {
        id: `${entry.id}-${noteIdPrefix}-${index}-${Math.round(timeSeconds * 1000)}`,
        timeSeconds,
        endSeconds,
        lane,
        strength: Math.max(0, Math.min(1, note.strength)),
        type: durationSeconds >= 0.14 ? "hold" : "tap"
      } satisfies MelodyNote;
    });
    const maxDoubleCount = lanes.length <= 4 ? Math.floor(base.length * 0.1) : 0;
    if (maxDoubleCount <= 0) {
      return base;
    }
    const byStrength = base
      .map((note, index) => ({ index, strength: note.strength }))
      .sort((a, b) => b.strength - a.strength || a.index - b.index)
      .slice(0, maxDoubleCount);
    const doubles: MelodyNote[] = [];
    for (const row of byStrength) {
      const note = base[row.index];
      const bucket = Math.round(note.timeSeconds * 20);
      const occupied = occupiedByBucket.get(bucket) ?? new Set<TLane>([note.lane as TLane]);
      const secondary = chooseSecondaryLane(rng, lanes, note.lane as TLane, occupied);
      if (!secondary) {
        continue;
      }
      occupied.add(secondary);
      occupiedByBucket.set(bucket, occupied);
      doubles.push({
        ...note,
        id: `${note.id}-dbl`,
        lane: secondary
      });
    }
    return [...base, ...doubles].sort((a, b) => a.timeSeconds - b.timeSeconds || a.id.localeCompare(b.id));
  }

  const beats = Array.isArray(entry.majorBeats) ? entry.majorBeats : [];
  const sorted = [...beats].sort((a, b) => a.timeSeconds - b.timeSeconds);
  let previousLane: TLane | null = null;
  let previousPreviousLane: TLane | null = null;
  const base = sorted.map((beat, index) => {
    const lane = pickLane(rng, lanes, previousLane, previousPreviousLane, new Set<TLane>());
    previousPreviousLane = previousLane;
    previousLane = lane;
    const timeSeconds = Math.max(0, beat.timeSeconds);
    return {
      id: `${entry.id}-${noteIdPrefix}-${index}-${Math.round(timeSeconds * 1000)}`,
      timeSeconds,
      endSeconds: timeSeconds,
      lane,
      strength: Math.max(0, Math.min(1, beat.strength)),
      type: "tap"
    } satisfies MelodyNote;
  });
  const maxDoubleCount = lanes.length <= 4 ? Math.floor(base.length * 0.1) : 0;
  if (maxDoubleCount <= 0) {
    return base;
  }
  const occupiedByBucket = new Map<number, Set<TLane>>();
  for (const note of base) {
    const bucket = Math.round(note.timeSeconds * 20);
    const occupied = occupiedByBucket.get(bucket) ?? new Set<TLane>();
    occupied.add(note.lane as TLane);
    occupiedByBucket.set(bucket, occupied);
  }
  const byStrength = base
    .map((note, index) => ({ index, strength: note.strength }))
    .sort((a, b) => b.strength - a.strength || a.index - b.index)
    .slice(0, maxDoubleCount);
  const doubles: MelodyNote[] = [];
  for (const row of byStrength) {
    const note = base[row.index];
    const bucket = Math.round(note.timeSeconds * 20);
    const occupied = occupiedByBucket.get(bucket) ?? new Set<TLane>([note.lane as TLane]);
    const secondary = chooseSecondaryLane(rng, lanes, note.lane as TLane, occupied);
    if (!secondary) {
      continue;
    }
    occupied.add(secondary);
    occupiedByBucket.set(bucket, occupied);
    doubles.push({
      ...note,
      id: `${note.id}-dbl`,
      lane: secondary
    });
  }
  return [...base, ...doubles].sort((a, b) => a.timeSeconds - b.timeSeconds || a.id.localeCompare(b.id));
}

export function buildStepArrowNotes(entry: SavedBeatEntry): MelodyNote[] {
  return buildModeNotes(entry, stepArrowLaneOrder, "step");
}

export function buildOrbBeatNotes(entry: SavedBeatEntry): MelodyNote[] {
  return buildModeNotes(entry, orbBeatLaneOrder, "orb");
}

export function buildGameNotesFromEntry(
  entry: SavedBeatEntry,
  modeValue: GameMode
): MelodyNote[] {
  const mode = normalizeGameMode(modeValue);
  if (mode === "orb_beat") {
    return buildOrbBeatNotes(entry);
  }
  return buildStepArrowNotes(entry);
}

export function buildMelodyNotesFromMajorBeats(entry: SavedBeatEntry): MelodyNote[] {
  const mode = normalizeGameMode(entry.gameBeatConfig?.gameMode);
  return buildGameNotesFromEntry(entry, mode);
}

export function buildFallbackEntryFromBeats(
  entry: SavedBeatEntry,
  beats: BeatPoint[],
  modeValue: GameMode
): SavedBeatEntry {
  return {
    ...entry,
    majorBeats: beats,
    gameBeatConfig: {
      ...(entry.gameBeatConfig ?? {}),
      gameMode: normalizeGameMode(modeValue)
    }
  };
}
