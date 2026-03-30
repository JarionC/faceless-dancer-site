import type { BeatPoint } from "../../types/beat";

export interface ZeroSlopePeakConfig {
  smoothingWindow: number;
  minStrength: number;
  minProminence: number;
  minDistancePoints: number;
}

interface Candidate {
  index: number;
  strength: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function movingAverage(values: number[], windowSize: number): number[] {
  const safeWindow = Math.max(1, Math.floor(windowSize));
  const radius = Math.floor(safeWindow / 2);
  if (safeWindow <= 1 || values.length <= 2) {
    return [...values];
  }
  const smoothed = new Array<number>(values.length).fill(0);
  for (let i = 0; i < values.length; i += 1) {
    const from = Math.max(0, i - radius);
    const to = Math.min(values.length - 1, i + radius);
    let sum = 0;
    let count = 0;
    for (let j = from; j <= to; j += 1) {
      sum += values[j];
      count += 1;
    }
    smoothed[i] = count > 0 ? sum / count : values[i];
  }
  return smoothed;
}

function approximateProminence(series: number[], index: number, neighborhood: number): number {
  const from = Math.max(0, index - neighborhood);
  const to = Math.min(series.length - 1, index + neighborhood);
  let leftMin = series[index];
  let rightMin = series[index];
  for (let i = from; i <= index; i += 1) {
    leftMin = Math.min(leftMin, series[i]);
  }
  for (let i = index; i <= to; i += 1) {
    rightMin = Math.min(rightMin, series[i]);
  }
  const baseline = Math.max(leftMin, rightMin);
  return Math.max(0, series[index] - baseline);
}

function enforceDistance(candidates: Candidate[], minDistance: number): number[] {
  if (candidates.length === 0) {
    return [];
  }
  const safeDistance = Math.max(1, Math.floor(minDistance));
  const byStrength = [...candidates].sort((a, b) => b.strength - a.strength);
  const accepted: Candidate[] = [];
  for (const candidate of byStrength) {
    const tooClose = accepted.some(
      (picked) => Math.abs(picked.index - candidate.index) < safeDistance
    );
    if (!tooClose) {
      accepted.push(candidate);
    }
  }
  return accepted.map((row) => row.index).sort((a, b) => a - b);
}

export function findZeroSlopePeakIndices(
  points: BeatPoint[],
  config: Partial<ZeroSlopePeakConfig> = {}
): number[] {
  if (points.length < 3) {
    return [];
  }
  const smoothingWindow = Math.max(1, Math.floor(config.smoothingWindow ?? 3));
  const minStrength = clamp01(config.minStrength ?? 0.05);
  const minProminence = clamp01(config.minProminence ?? 0.01);
  const minDistancePoints = Math.max(1, Math.floor(config.minDistancePoints ?? 3));

  const raw = points.map((point) => point.strength);
  const smooth = movingAverage(raw, smoothingWindow);
  const neighborhood = Math.max(2, minDistancePoints);
  const candidates: Candidate[] = [];

  for (let i = 1; i < smooth.length - 1; i += 1) {
    const slopePrev = smooth[i] - smooth[i - 1];
    const slopeNext = smooth[i + 1] - smooth[i];
    const isZeroSlopeMax = slopePrev > 0 && slopeNext <= 0;
    if (!isZeroSlopeMax) {
      continue;
    }
    if (smooth[i] < minStrength) {
      continue;
    }
    const prominence = approximateProminence(smooth, i, neighborhood);
    if (prominence < minProminence) {
      continue;
    }
    candidates.push({ index: i, strength: smooth[i] + prominence * 0.5 });
  }

  return enforceDistance(candidates, minDistancePoints);
}
