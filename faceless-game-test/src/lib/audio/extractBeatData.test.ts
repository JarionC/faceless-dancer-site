import { describe, expect, it } from "vitest";
import {
  clampStrength,
  extractBeatDataFromSamples,
  type BeatExtractionConfig
} from "./extractBeatData";

const config: BeatExtractionConfig = {
  windowSize: 4,
  hopSize: 2,
  smoothingAlpha: 0.5
};

describe("clampStrength", () => {
  it("clamps values between 0 and 1", () => {
    expect(clampStrength(-1)).toBe(0);
    expect(clampStrength(2)).toBe(1);
    expect(clampStrength(0.6)).toBe(0.6);
  });
});

describe("extractBeatDataFromSamples", () => {
  it("returns empty array for invalid inputs", () => {
    expect(extractBeatDataFromSamples(new Float32Array(), 44100, config)).toEqual([]);
    expect(extractBeatDataFromSamples(new Float32Array([1, 2, 3]), 0, config)).toEqual([]);
  });

  it("creates monotonically increasing timestamps", () => {
    const samples = new Float32Array([0, 1, 0.5, 0.2, 0.8, 0.1, 0.9, 0.4]);
    const points = extractBeatDataFromSamples(samples, 4, config);

    expect(points.length).toBeGreaterThan(1);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i].timeSeconds).toBeGreaterThan(points[i - 1].timeSeconds);
    }
  });

  it("normalizes strengths to 0..1 range", () => {
    const samples = new Float32Array([0.1, 0.4, 0.8, 1.0, 0.4, 0.2, 0.9, 0.7]);
    const points = extractBeatDataFromSamples(samples, 8, config);

    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.strength).toBeGreaterThanOrEqual(0);
      expect(point.strength).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...points.map((point) => point.strength))).toBeCloseTo(1, 8);
  });
});
