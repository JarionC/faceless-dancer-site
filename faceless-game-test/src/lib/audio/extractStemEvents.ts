import type { SourceEvent } from "../../types/beat";

export interface StemEventExtractionConfig {
  harmonicBands: number;
  transientBands: number;
  baseThreshold: number;
  transientBoost: number;
  sustainMinDurationSeconds: number;
  transientMinDurationSeconds: number;
  sustainReleaseSeconds: number;
  mergeGapSeconds: number;
  maxSourcesPerStem: number;
  minAverageStrengthPerSource: number;
  minEventsPerSource: number;
}

const defaultStemEventExtractionConfig: StemEventExtractionConfig = {
  harmonicBands: 3,
  transientBands: 2,
  baseThreshold: 0.2,
  transientBoost: 1.1,
  sustainMinDurationSeconds: 0.28,
  transientMinDurationSeconds: 0.06,
  sustainReleaseSeconds: 0.14,
  mergeGapSeconds: 0.2,
  maxSourcesPerStem: 4,
  minAverageStrengthPerSource: 0.14,
  minEventsPerSource: 3
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < channelCount; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / channelCount;
    }
  }
  return mono;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * clamp01(p);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) {
    return sorted[lo];
  }
  const w = pos - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function normalize(values: number[]): number[] {
  const max = Math.max(...values, 0);
  if (max <= 0) {
    return values.map(() => 0);
  }
  return values.map((value) => clamp01(value / max));
}

function buildBandStrengths(
  samples: Float32Array,
  sampleRate: number,
  windowSize: number,
  hopSize: number,
  bandCount: number
): { times: number[]; bands: number[][] } {
  const times: number[] = [];
  const bands = Array.from({ length: bandCount }, () => [] as number[]);
  const alphas = Array.from({ length: bandCount + 1 }, (_, i) => 0.0025 * Math.pow(1.7, i + 1));
  const cascaded = new Array<number>(bandCount + 1).fill(0);

  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    const energy = new Array<number>(bandCount).fill(0);
    for (let i = start; i < start + windowSize; i += 1) {
      const abs = Math.abs(samples[i]);
      for (let c = 0; c < cascaded.length; c += 1) {
        cascaded[c] += alphas[c] * (abs - cascaded[c]);
      }
      for (let b = 0; b < bandCount; b += 1) {
        const raw = Math.max(0, cascaded[b + 1] - cascaded[b]);
        energy[b] += raw * raw;
      }
    }
    times.push(start / sampleRate);
    for (let b = 0; b < bandCount; b += 1) {
      bands[b].push(Math.sqrt(energy[b] / windowSize));
    }
  }

  return {
    times,
    bands: bands.map((series) => normalize(series))
  };
}

function extractFromSeries(
  series: number[],
  times: number[],
  source: string,
  baseThreshold: number,
  minDurationSeconds: number,
  releaseSeconds: number
): SourceEvent[] {
  if (series.length === 0 || times.length === 0) {
    return [];
  }
  const p70 = percentile(series, 0.7);
  const p90 = percentile(series, 0.9);
  const openThreshold = Math.max(baseThreshold, p70 + 0.12 * (p90 - p70));
  const closeThreshold = Math.max(baseThreshold * 0.7, openThreshold * 0.72);

  const events: SourceEvent[] = [];
  let startIndex = -1;
  let peak = 0;
  let lastStrongIndex = -1;

  for (let i = 0; i < series.length; i += 1) {
    const value = series[i];
    if (startIndex < 0) {
      if (value >= openThreshold) {
        startIndex = i;
        lastStrongIndex = i;
        peak = value;
      }
      continue;
    }

    peak = Math.max(peak, value);
    if (value >= closeThreshold) {
      lastStrongIndex = i;
      continue;
    }

    const start = times[startIndex];
    const anchor = lastStrongIndex >= 0 ? times[lastStrongIndex] : times[i];
    const end = Math.max(start + minDurationSeconds, anchor + releaseSeconds);
    events.push({
      source,
      startSeconds: start,
      endSeconds: end,
      durationSeconds: end - start,
      strength: clamp01(peak)
    });
    startIndex = -1;
    peak = 0;
    lastStrongIndex = -1;
  }

  if (startIndex >= 0) {
    const start = times[startIndex];
    const last = times[times.length - 1] ?? start;
    const end = Math.max(start + minDurationSeconds, last + releaseSeconds);
    events.push({
      source,
      startSeconds: start,
      endSeconds: end,
      durationSeconds: end - start,
      strength: clamp01(peak)
    });
  }

  return events;
}

function mergeSmallGaps(events: SourceEvent[], gapSeconds: number): SourceEvent[] {
  if (events.length <= 1 || gapSeconds <= 0) {
    return events;
  }
  const sorted = [...events].sort((a, b) => {
    if (a.source !== b.source) {
      return a.source.localeCompare(b.source);
    }
    return a.startSeconds - b.startSeconds;
  });
  const merged: SourceEvent[] = [];
  for (const event of sorted) {
    const previous = merged.length > 0 ? merged[merged.length - 1] : null;
    if (
      previous &&
      previous.source === event.source &&
      event.startSeconds - previous.endSeconds <= gapSeconds
    ) {
      previous.endSeconds = Math.max(previous.endSeconds, event.endSeconds);
      previous.durationSeconds = previous.endSeconds - previous.startSeconds;
      previous.strength = Math.max(previous.strength, event.strength);
      continue;
    }
    merged.push({ ...event });
  }
  return merged.sort((a, b) => a.startSeconds - b.startSeconds);
}

function filterAndCapSources(events: SourceEvent[], cfg: StemEventExtractionConfig): SourceEvent[] {
  if (events.length === 0) {
    return events;
  }
  const bySource = new Map<string, SourceEvent[]>();
  for (const event of events) {
    const existing = bySource.get(event.source);
    if (existing) {
      existing.push(event);
    } else {
      bySource.set(event.source, [event]);
    }
  }

  const ranked = Array.from(bySource.entries())
    .map(([source, sourceEvents]) => {
      const avgStrength =
        sourceEvents.reduce((sum, event) => sum + event.strength, 0) / Math.max(1, sourceEvents.length);
      const coverage = sourceEvents.reduce((sum, event) => sum + event.durationSeconds, 0);
      return {
        source,
        avgStrength,
        coverage,
        eventCount: sourceEvents.length,
        score: avgStrength * 1.2 + coverage * 0.02 + Math.min(0.4, sourceEvents.length * 0.04)
      };
    })
    .filter(
      (row) =>
        row.avgStrength >= cfg.minAverageStrengthPerSource && row.eventCount >= cfg.minEventsPerSource
    )
    .sort((a, b) => b.score - a.score);

  const kept = new Set(ranked.slice(0, cfg.maxSourcesPerStem).map((row) => row.source));
  return events
    .filter((event) => kept.has(event.source))
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

export function extractStemEventsFromAudioBuffer(
  audioBuffer: AudioBuffer,
  sourceLabel: string,
  config: Partial<StemEventExtractionConfig> = {}
): SourceEvent[] {
  const cfg: StemEventExtractionConfig = {
    ...defaultStemEventExtractionConfig,
    ...config,
    maxSourcesPerStem: Math.max(
      1,
      Math.min(8, Math.floor(config.maxSourcesPerStem ?? defaultStemEventExtractionConfig.maxSourcesPerStem))
    ),
    minAverageStrengthPerSource: clamp01(
      config.minAverageStrengthPerSource ?? defaultStemEventExtractionConfig.minAverageStrengthPerSource
    ),
    minEventsPerSource: Math.max(
      1,
      Math.min(8, Math.floor(config.minEventsPerSource ?? defaultStemEventExtractionConfig.minEventsPerSource))
    )
  };
  const samples = mixToMono(audioBuffer);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = 1024;
  const hopSize = 256;
  if (samples.length < windowSize) {
    return [];
  }

  const events: SourceEvent[] = [];
  const harmonicCount = Math.max(1, Math.min(16, cfg.harmonicBands));
  const transientCount = Math.max(1, Math.min(16, cfg.transientBands));
  const bandCount = Math.max(harmonicCount, transientCount);
  const baseThreshold = clamp01(cfg.baseThreshold);
  const bandData = buildBandStrengths(samples, sampleRate, windowSize, hopSize, bandCount);
  if (bandData.times.length === 0) {
    return [];
  }

  for (let i = 0; i < harmonicCount; i += 1) {
    const series = bandData.bands[i] ?? [];
    const harmonic = new Array<number>(series.length).fill(0);
    let slow = 0;
    for (let j = 0; j < series.length; j += 1) {
      slow += 0.06 * (series[j] - slow);
      harmonic[j] = slow;
    }
    events.push(
      ...extractFromSeries(
        harmonic,
        bandData.times,
        `${sourceLabel}_h${String(i + 1).padStart(2, "0")}`,
        baseThreshold,
        Math.max(0.03, cfg.sustainMinDurationSeconds),
        Math.max(0, cfg.sustainReleaseSeconds)
      )
    );
  }

  for (let i = 0; i < transientCount; i += 1) {
    const series = bandData.bands[i] ?? [];
    const transient = new Array<number>(series.length).fill(0);
    let slow = 0;
    for (let j = 0; j < series.length; j += 1) {
      slow += 0.12 * (series[j] - slow);
      const attack = Math.max(0, series[j] - slow * 0.86);
      transient[j] = clamp01(attack * Math.max(0.5, cfg.transientBoost));
    }
    events.push(
      ...extractFromSeries(
        transient,
        bandData.times,
        `${sourceLabel}_t${String(i + 1).padStart(2, "0")}`,
        Math.max(0.02, baseThreshold * 0.82),
        Math.max(0.01, cfg.transientMinDurationSeconds),
        0.01
      )
    );
  }

  const merged = mergeSmallGaps(events, Math.max(0, cfg.mergeGapSeconds));
  return filterAndCapSources(merged, cfg);
}
