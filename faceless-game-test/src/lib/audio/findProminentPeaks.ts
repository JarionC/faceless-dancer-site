import type { BeatPoint } from "../../types/beat";

export interface PeakDetectionConfig {
  minProminence: number;
  minStrength: number;
  minDistancePoints: number;
}

function localBaselineStrength(points: BeatPoint[], centerIndex: number, radius: number): number {
  let minimum = Number.POSITIVE_INFINITY;
  const start = Math.max(0, centerIndex - radius);
  const end = Math.min(points.length - 1, centerIndex + radius);

  for (let i = start; i <= end; i += 1) {
    if (i === centerIndex) {
      continue;
    }
    if (points[i].strength < minimum) {
      minimum = points[i].strength;
    }
  }

  return Number.isFinite(minimum) ? minimum : 0;
}

export function findProminentPeakIndices(
  points: BeatPoint[],
  config: PeakDetectionConfig
): number[] {
  if (points.length < 3) {
    return [];
  }

  const minProminence = Math.max(0, Math.min(1, config.minProminence));
  const minStrength = Math.max(0, Math.min(1, config.minStrength));
  const minDistancePoints = Math.max(1, config.minDistancePoints);
  const neighborhoodRadius = Math.max(2, minDistancePoints);

  const candidates: number[] = [];

  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i].strength;
    const prev = points[i - 1].strength;
    const next = points[i + 1].strength;

    const isLocalMaximum = current > prev && current >= next;
    if (!isLocalMaximum || current < minStrength) {
      continue;
    }

    const baseline = localBaselineStrength(points, i, neighborhoodRadius);
    const prominence = current - baseline;
    if (prominence >= minProminence) {
      candidates.push(i);
    }
  }

  candidates.sort((a, b) => points[b].strength - points[a].strength);

  const accepted: number[] = [];
  for (const candidate of candidates) {
    const tooClose = accepted.some(
      (existing) => Math.abs(existing - candidate) < minDistancePoints
    );
    if (!tooClose) {
      accepted.push(candidate);
    }
  }

  return accepted.sort((a, b) => a - b);
}
