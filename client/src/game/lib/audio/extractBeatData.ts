import type { BeatPoint } from "../../types/beat";

export interface BeatExtractionConfig {
  windowSize: number;
  hopSize: number;
  smoothingAlpha: number;
}

export function clampStrength(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function extractBeatDataFromSamples(
  monoSamples: Float32Array,
  sampleRate: number,
  config: BeatExtractionConfig
): BeatPoint[] {
  if (monoSamples.length === 0 || sampleRate <= 0) {
    return [];
  }

  const windowSize = Math.max(1, config.windowSize);
  const hopSize = Math.max(1, config.hopSize);
  const alpha = Math.max(0, Math.min(1, config.smoothingAlpha));

  if (monoSamples.length < windowSize) {
    return [];
  }

  const rawPoints: BeatPoint[] = [];

  for (let start = 0; start + windowSize <= monoSamples.length; start += hopSize) {
    let sumSquares = 0;
    for (let i = start; i < start + windowSize; i += 1) {
      const sample = monoSamples[i];
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / windowSize);
    rawPoints.push({
      timeSeconds: start / sampleRate,
      strength: rms
    });
  }

  let smoothed = rawPoints.length > 0 ? rawPoints[0].strength : 0;
  for (let i = 1; i < rawPoints.length; i += 1) {
    smoothed = alpha * rawPoints[i].strength + (1 - alpha) * smoothed;
    rawPoints[i].strength = smoothed;
  }

  let maxStrength = 0;
  for (const point of rawPoints) {
    if (point.strength > maxStrength) {
      maxStrength = point.strength;
    }
  }

  if (maxStrength === 0) {
    return rawPoints.map((point) => ({
      ...point,
      strength: 0
    }));
  }

  return rawPoints.map((point) => ({
    ...point,
    strength: clampStrength(point.strength / maxStrength)
  }));
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = audioBuffer.getChannelData(channelIndex);
    for (let i = 0; i < length; i += 1) {
      mono[i] += channel[i] / channelCount;
    }
  }

  return mono;
}

export function extractBeatDataFromAudioBuffer(
  audioBuffer: AudioBuffer,
  config: BeatExtractionConfig
): BeatPoint[] {
  const mono = mixToMono(audioBuffer);
  return extractBeatDataFromSamples(mono, audioBuffer.sampleRate, config);
}
