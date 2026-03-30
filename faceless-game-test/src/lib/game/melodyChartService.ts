import type { BeatPoint, SavedBeatEntry } from "../../types/beat";

export type GameLane = "left" | "up" | "down" | "right";
export type GameNoteType = "tap" | "hold";

export interface MelodyNote {
  id: string;
  timeSeconds: number;
  endSeconds: number;
  lane: GameLane;
  strength: number;
  type: GameNoteType;
}

const laneOrder: GameLane[] = ["left", "down", "up", "right"];

function laneFromBeat(beat: BeatPoint, index: number, previousLane: GameLane | null): GameLane {
  const seed = Math.floor(beat.timeSeconds * 1000) + Math.floor(beat.strength * 1000) + index * 31;
  let lane = laneOrder[Math.abs(seed) % laneOrder.length];
  if (previousLane && lane === previousLane) {
    lane = laneOrder[(laneOrder.indexOf(lane) + 1) % laneOrder.length];
  }
  return lane;
}

function laneFromSource(source: string | undefined, index: number, previousLane: GameLane | null): GameLane {
  const normalized = String(source ?? "").toLowerCase();
  const sourceSeed = normalized
    .split("")
    .reduce((sum, char, i) => sum + char.charCodeAt(0) * (i + 1), 0);
  let lane = laneOrder[Math.abs(sourceSeed + index * 17) % laneOrder.length];
  if (previousLane && lane === previousLane) {
    lane = laneOrder[(laneOrder.indexOf(lane) + 1) % laneOrder.length];
  }
  return lane;
}

function rotateLane(base: GameLane, offset: number): GameLane {
  const start = laneOrder.indexOf(base);
  return laneOrder[(start + offset + laneOrder.length * 10) % laneOrder.length];
}

export function buildMelodyNotesFromMajorBeats(entry: SavedBeatEntry): MelodyNote[] {
  const gameNotes = Array.isArray(entry.gameNotes) ? entry.gameNotes : [];
  if (gameNotes.length > 0) {
    const sorted = [...gameNotes].sort((a, b) => a.timeSeconds - b.timeSeconds);
    let previousLane: GameLane | null = null;
    const chordIndexByBucket = new Map<number, number>();
    return sorted.map((note, index) => {
      const baseLane = laneFromSource(note.source, index, previousLane);
      const bucket = Math.round(note.timeSeconds * 20);
      const inBucketIndex = chordIndexByBucket.get(bucket) ?? 0;
      chordIndexByBucket.set(bucket, inBucketIndex + 1);
      let lane = rotateLane(baseLane, inBucketIndex);
      if (previousLane && lane === previousLane) {
        lane = rotateLane(lane, 1);
      }
      previousLane = lane;
      const timeSeconds = Math.max(0, note.timeSeconds);
      const endSeconds = Math.max(timeSeconds, note.endSeconds);
      const durationSeconds = endSeconds - timeSeconds;
      return {
        id: `${entry.id}-game-${index}-${Math.round(timeSeconds * 1000)}`,
        timeSeconds,
        endSeconds,
        lane,
        strength: Math.max(0, Math.min(1, note.strength)),
        type: durationSeconds >= 0.14 ? "hold" : "tap"
      };
    });
  }

  const beats = Array.isArray(entry.majorBeats) ? entry.majorBeats : [];
  const sorted = [...beats].sort((a, b) => a.timeSeconds - b.timeSeconds);
  let previousLane: GameLane | null = null;
  return sorted.map((beat, index) => {
    const lane = laneFromBeat(beat, index, previousLane);
    previousLane = lane;
    const timeSeconds = Math.max(0, beat.timeSeconds);
    return {
      id: `${entry.id}-${index}-${Math.round(timeSeconds * 1000)}`,
      timeSeconds,
      endSeconds: timeSeconds,
      lane,
      strength: Math.max(0, Math.min(1, beat.strength)),
      type: "tap"
    };
  });
}
