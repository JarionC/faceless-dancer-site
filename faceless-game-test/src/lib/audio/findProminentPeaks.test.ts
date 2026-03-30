import { describe, expect, it } from "vitest";
import { findProminentPeakIndices, type PeakDetectionConfig } from "./findProminentPeaks";
import type { BeatPoint } from "../../types/beat";

const baseConfig: PeakDetectionConfig = {
  minProminence: 0.15,
  minStrength: 0.5,
  minDistancePoints: 2
};

function pointsFromStrengths(strengths: number[]): BeatPoint[] {
  return strengths.map((strength, index) => ({
    timeSeconds: index * 0.1,
    strength
  }));
}

describe("findProminentPeakIndices", () => {
  it("finds obvious local maxima", () => {
    const points = pointsFromStrengths([0.1, 0.8, 0.2, 0.7, 0.2, 0.85, 0.1]);
    expect(findProminentPeakIndices(points, baseConfig)).toEqual([1, 3, 5]);
  });

  it("respects minimum strength and prominence", () => {
    const points = pointsFromStrengths([0.1, 0.55, 0.5, 0.58, 0.52, 0.57, 0.5]);
    const strictConfig: PeakDetectionConfig = {
      ...baseConfig,
      minStrength: 0.6,
      minProminence: 0.2
    };
    expect(findProminentPeakIndices(points, strictConfig)).toEqual([]);
  });

  it("keeps strongest peaks when min distance is enforced", () => {
    const points = pointsFromStrengths([0.1, 0.8, 0.2, 0.78, 0.2, 0.82, 0.1]);
    const spreadConfig: PeakDetectionConfig = {
      ...baseConfig,
      minDistancePoints: 3
    };
    expect(findProminentPeakIndices(points, spreadConfig)).toEqual([1, 5]);
  });
});
