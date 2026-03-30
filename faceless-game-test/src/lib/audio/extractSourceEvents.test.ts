import { describe, expect, it } from "vitest";
import {
  extractSourceEventsFromSamples,
  type SourceExtractionConfig
} from "./extractSourceEvents";

const config: SourceExtractionConfig = {
  windowSize: 128,
  hopSize: 64,
  drumsThreshold: 0.25,
  bassThreshold: 0.2,
  otherThreshold: 0.2,
  drumsMinDurationSeconds: 0.05,
  bassMinDurationSeconds: 0.15,
  otherMinDurationSeconds: 0.1,
  syntheticSourceCount: 4,
  transientHopScale: 2,
  adaptiveThresholdWindow: 12,
  minInterOnsetSeconds: 0.03,
  bassDominanceRatio: 1.2,
  bassMaxSustainSeconds: 0.9,
  drumTransientGain: 1.5,
  drumTriggerFloor: 0.08,
  reassignMargin: 0.08
};

describe("extractSourceEventsFromSamples", () => {
  it("returns empty for invalid input", () => {
    expect(extractSourceEventsFromSamples(new Float32Array(), 44100, config)).toEqual([]);
    expect(extractSourceEventsFromSamples(new Float32Array([0.1, 0.2]), 0, config)).toEqual([]);
  });

  it("detects sustained content and keeps valid ranges", () => {
    const sampleRate = 4000;
    const seconds = 2;
    const length = sampleRate * seconds;
    const samples = new Float32Array(length);

    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate;
      const bassTone = t > 0.3 && t < 1.4 ? Math.sin(2 * Math.PI * 80 * t) * 0.6 : 0;
      const otherTone = t > 1.0 && t < 1.8 ? Math.sin(2 * Math.PI * 420 * t) * 0.4 : 0;
      const transient = i % 350 === 0 ? 0.9 : 0;
      samples[i] = bassTone + otherTone + transient;
    }

    const events = extractSourceEventsFromSamples(samples, sampleRate, config);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.startSeconds).toBeGreaterThanOrEqual(0);
      expect(event.endSeconds).toBeGreaterThanOrEqual(event.startSeconds);
      expect(event.durationSeconds).toBeCloseTo(event.endSeconds - event.startSeconds, 5);
      expect(event.strength).toBeGreaterThanOrEqual(0);
      expect(event.strength).toBeLessThanOrEqual(1);
    }
  });
});
