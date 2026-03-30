import type { SourceEvent, SourceName } from "../../types/beat";

export interface SourceExtractionConfig {
  windowSize: number;
  hopSize: number;
  drumsThreshold: number;
  bassThreshold: number;
  otherThreshold: number;
  drumsMinDurationSeconds: number;
  bassMinDurationSeconds: number;
  otherMinDurationSeconds: number;
  syntheticSourceCount: number;
  transientHopScale: number;
  adaptiveThresholdWindow: number;
  minInterOnsetSeconds: number;
  bassDominanceRatio: number;
  bassMaxSustainSeconds: number;
  drumTransientGain: number;
  drumTriggerFloor: number;
  reassignMargin: number;
}

interface EnvelopePoint {
  timeSeconds: number;
  drumsStrength: number;
  bassStrength: number;
  syntheticStrengths: number[];
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalize(values: number[]): number[] {
  let max = 0;
  for (const value of values) {
    if (value > max) {
      max = value;
    }
  }
  if (max <= 0) {
    return values.map(() => 0);
  }
  return values.map((value) => clampUnit(value / max));
}

function movingAverage(values: number[], radius: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const safeRadius = Math.max(1, radius);
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - safeRadius);
    const end = Math.min(values.length - 1, i + safeRadius);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= end; j += 1) {
      sum += values[j];
      count += 1;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * clampUnit(p);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function computeAdaptiveBaseThreshold(
  values: number[],
  floorThreshold: number,
  mode: "drum" | "sustain"
): number {
  if (values.length === 0) {
    return clampUnit(floorThreshold);
  }
  const p50 = percentile(values, 0.5);
  const p75 = percentile(values, 0.75);
  const p90 = percentile(values, 0.9);
  if (mode === "drum") {
    return clampUnit(Math.max(floorThreshold, p50 + 0.1 * (p90 - p50)));
  }
  return clampUnit(Math.max(floorThreshold, p75 + 0.15 * (p90 - p75)));
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

function buildEnvelopeSeries(
  monoSamples: Float32Array,
  sampleRate: number,
  windowSize: number,
  hopSize: number,
  syntheticSourceCount: number
): EnvelopePoint[] {
  const pointCount = Math.floor((monoSamples.length - windowSize) / hopSize) + 1;
  if (pointCount <= 0) {
    return [];
  }

  // Cascaded one-pole filters over absolute waveform provide coarse multi-band proxies.
  const cascaded = [0, 0, 0, 0, 0];
  const alphas = [0.003, 0.008, 0.02, 0.045, 0.09];
  let fullFast = 0;
  const alphaFullFast = 0.06;

  const rawBass: number[] = [];
  const rawDrums: number[] = [];
  const rawSynthetic: number[][] = Array.from(
    { length: Math.max(1, syntheticSourceCount) },
    () => []
  );
  const times: number[] = [];

  let previousFullRms = 0;
  for (let start = 0; start + windowSize <= monoSamples.length; start += hopSize) {
    let bassPower = 0;
    let otherPower = 0;
    let fullPower = 0;

    for (let i = start; i < start + windowSize; i += 1) {
      const sample = monoSamples[i];
      const abs = Math.abs(sample);
      for (let c = 0; c < cascaded.length; c += 1) {
        cascaded[c] += alphas[c] * (abs - cascaded[c]);
      }
      fullFast += alphaFullFast * (abs - fullFast);

      const band0 = cascaded[0];
      const band1 = Math.max(0, cascaded[1] - cascaded[0]);
      const band2 = Math.max(0, cascaded[2] - cascaded[1]);
      const band3 = Math.max(0, cascaded[3] - cascaded[2]);
      const band4 = Math.max(0, fullFast - cascaded[3]);

      const allBands = [band1, band2, band3, band4];
      for (let s = 0; s < rawSynthetic.length; s += 1) {
        const band = allBands[s % allBands.length];
        rawSynthetic[s].push(band);
        otherPower += band * band;
      }

      bassPower += band0 * band0;
      fullPower += abs * abs;
    }

    const bassRms = Math.sqrt(bassPower / windowSize);
    const fullRms = Math.sqrt(fullPower / windowSize);
    const transient = Math.max(0, fullRms - previousFullRms);
    previousFullRms = fullRms;

    rawBass.push(bassRms);
    rawDrums.push(transient);
    times.push(start / sampleRate);
  }

  const bass = normalize(rawBass);
  const drums = normalize(rawDrums);
  const synthetic = rawSynthetic.map((band) => normalize(band));

  const points: EnvelopePoint[] = [];
  for (let i = 0; i < times.length; i += 1) {
    points.push({
      timeSeconds: times[i],
      drumsStrength: drums[i],
      bassStrength: bass[i],
      syntheticStrengths: synthetic.map((series) => series[i] ?? 0)
    });
  }
  return points;
}

function extractSegmentsForSource(
  points: EnvelopePoint[],
  source: SourceName,
  baseThreshold: number,
  minDurationSeconds: number,
  readStrength: (point: EnvelopePoint) => number,
  adaptiveWindow: number,
  canTriggerAt?: (point: EnvelopePoint, index: number) => boolean
): SourceEvent[] {
  const strengths = points.map(readStrength);
  const baseline = movingAverage(strengths, adaptiveWindow);
  const segments: SourceEvent[] = [];
  let activeStart: number | null = null;
  let activePeak = 0;
  let lastAboveTime = 0;
  let lastBelowStrength = 0;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const strength = strengths[i];
    const adaptiveThreshold = clampUnit(Math.max(baseThreshold, baseline[i] * 0.8));
    const triggerThreshold = clampUnit(Math.max(baseThreshold * 0.8, adaptiveThreshold * 0.88));
    const above = strength >= adaptiveThreshold;
    const trigger = strength >= triggerThreshold;

    const allowed = canTriggerAt ? canTriggerAt(point, i) : true;
    if (allowed && (above || (activeStart === null && trigger))) {
      if (activeStart === null) {
        activeStart = point.timeSeconds;
        activePeak = strength;
      } else {
        activePeak = Math.max(activePeak, strength);
      }
      lastAboveTime = point.timeSeconds;
      lastBelowStrength = 0;
      continue;
    }

    if (activeStart !== null) {
      // Split long segments when a clear valley indicates note/sub-event changes.
      const valleyBreak =
        strength < activePeak * 0.45 && lastBelowStrength < activePeak * 0.45 && activePeak > 0.22;
      lastBelowStrength = strength;
      const canClose = valleyBreak || point.timeSeconds - lastAboveTime > minDurationSeconds * 0.8;
      if (!canClose) {
        continue;
      }
      const end = Math.max(lastAboveTime, activeStart + minDurationSeconds);
      segments.push({
        source,
        startSeconds: activeStart,
        endSeconds: end,
        durationSeconds: end - activeStart,
        strength: clampUnit(activePeak)
      });
      activeStart = null;
      activePeak = 0;
    }
  }

  if (activeStart !== null) {
    const end = Math.max(lastAboveTime, activeStart + minDurationSeconds);
    segments.push({
      source,
      startSeconds: activeStart,
      endSeconds: end,
      durationSeconds: end - activeStart,
      strength: clampUnit(activePeak)
    });
  }

  return segments;
}

function splitLongEvents(events: SourceEvent[], maxDurationSeconds: number): SourceEvent[] {
  if (maxDurationSeconds <= 0) {
    return events;
  }
  const out: SourceEvent[] = [];
  for (const event of events) {
    if (event.durationSeconds <= maxDurationSeconds || event.source !== "bass") {
      out.push(event);
      continue;
    }
    let cursor = event.startSeconds;
    while (cursor < event.endSeconds) {
      const end = Math.min(event.endSeconds, cursor + maxDurationSeconds);
      out.push({
        ...event,
        startSeconds: cursor,
        endSeconds: end,
        durationSeconds: end - cursor
      });
      cursor = end;
    }
  }
  return out;
}

function mergeNearbyEvents(events: SourceEvent[], minInterOnsetSeconds: number): SourceEvent[] {
  if (events.length <= 1) {
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
      event.startSeconds - previous.startSeconds < minInterOnsetSeconds
    ) {
      if (event.strength > previous.strength) {
        previous.startSeconds = event.startSeconds;
        previous.endSeconds = event.endSeconds;
        previous.durationSeconds = event.durationSeconds;
        previous.strength = event.strength;
      } else {
        previous.endSeconds = Math.max(previous.endSeconds, event.endSeconds);
        previous.durationSeconds = previous.endSeconds - previous.startSeconds;
      }
    } else {
      merged.push({ ...event });
    }
  }
  return merged.sort((a, b) => a.startSeconds - b.startSeconds);
}

function resolveBassDrumConflicts(events: SourceEvent[], reassignMargin: number): SourceEvent[] {
  const drums = events.filter((event) => event.source === "drums");
  if (drums.length === 0) {
    return events;
  }
  return events.filter((event) => {
    if (event.source !== "bass") {
      return true;
    }
    for (const drum of drums) {
      const overlap =
        Math.min(event.endSeconds, drum.endSeconds) - Math.max(event.startSeconds, drum.startSeconds);
      if (overlap > 0 && drum.strength >= event.strength + reassignMargin) {
        return false;
      }
    }
    return true;
  });
}

export function extractSourceEventsFromAudioBuffer(
  audioBuffer: AudioBuffer,
  config: SourceExtractionConfig
): SourceEvent[] {
  const mono = mixToMono(audioBuffer);
  return extractSourceEventsFromSamples(mono, audioBuffer.sampleRate, config);
}

export function extractSourceEventsFromSamples(
  monoSamples: Float32Array,
  sampleRate: number,
  config: SourceExtractionConfig
): SourceEvent[] {
  if (monoSamples.length === 0 || sampleRate <= 0) {
    return [];
  }

  const windowSize = Math.max(64, config.windowSize);
  const hopSize = Math.max(16, config.hopSize);
  const transientScale = Math.max(1, config.transientHopScale);
  const transientHop = Math.max(8, Math.floor(hopSize / transientScale));
  const transientWindow = Math.max(32, Math.floor(windowSize / transientScale));
  const syntheticSourceCount = Math.max(1, Math.min(12, config.syntheticSourceCount));
  const pointsMain = buildEnvelopeSeries(
    monoSamples,
    sampleRate,
    windowSize,
    hopSize,
    syntheticSourceCount
  );
  const pointsTransient = buildEnvelopeSeries(
    monoSamples,
    sampleRate,
    transientWindow,
    transientHop,
    syntheticSourceCount
  );
  if (pointsMain.length === 0 && pointsTransient.length === 0) {
    return [];
  }
  const adaptiveWindow = Math.max(2, config.adaptiveThresholdWindow);
  const bassDominanceRatio = Math.max(1, config.bassDominanceRatio);
  const mainDrumValues = pointsMain.map((point) => clampUnit(point.drumsStrength * config.drumTransientGain));
  const transientDrumValues = pointsTransient.map((point) =>
    clampUnit(point.drumsStrength * config.drumTransientGain)
  );
  const drumsMainThreshold = computeAdaptiveBaseThreshold(
    mainDrumValues,
    Math.max(config.drumsThreshold, config.drumTriggerFloor),
    "drum"
  );
  const drumsTransientThreshold = computeAdaptiveBaseThreshold(
    transientDrumValues,
    Math.max(config.drumsThreshold * 0.75, config.drumTriggerFloor),
    "drum"
  );
  const bassMainThreshold = computeAdaptiveBaseThreshold(
    pointsMain.map((point) => point.bassStrength),
    config.bassThreshold,
    "sustain"
  );
  const bassTransientThreshold = computeAdaptiveBaseThreshold(
    pointsTransient.map((point) => point.bassStrength),
    config.bassThreshold * 0.9,
    "sustain"
  );

  const drums = [
    ...extractSegmentsForSource(
      pointsMain,
      "drums",
      drumsMainThreshold,
      Math.max(0.03, config.drumsMinDurationSeconds),
      (point) => clampUnit(point.drumsStrength * config.drumTransientGain),
      adaptiveWindow
    ),
    ...extractSegmentsForSource(
      pointsTransient,
      "drums",
      drumsTransientThreshold,
      Math.max(0.02, config.drumsMinDurationSeconds * 0.7),
      (point) => clampUnit(point.drumsStrength * config.drumTransientGain),
      Math.max(2, Math.floor(adaptiveWindow / 2))
    )
  ];
  const bass = [
    ...extractSegmentsForSource(
      pointsMain,
      "bass",
      bassMainThreshold,
      Math.max(0.08, config.bassMinDurationSeconds),
      (point) => point.bassStrength,
      adaptiveWindow,
      (point) => {
        const maxOther = point.syntheticStrengths.reduce((max, value) => Math.max(max, value), 0);
        return point.bassStrength >= maxOther * bassDominanceRatio;
      }
    ),
    ...extractSegmentsForSource(
      pointsTransient,
      "bass",
      bassTransientThreshold,
      Math.max(0.05, config.bassMinDurationSeconds * 0.6),
      (point) => point.bassStrength,
      Math.max(2, Math.floor(adaptiveWindow / 2)),
      (point) => {
        const maxOther = point.syntheticStrengths.reduce((max, value) => Math.max(max, value), 0);
        return point.bassStrength >= maxOther * bassDominanceRatio;
      }
    )
  ];
  const unlabeledSources: SourceEvent[] = [];
  for (let i = 0; i < syntheticSourceCount; i += 1) {
    const sourceLabel = `source_${String(i + 1).padStart(2, "0")}` as SourceName;
    const baseFloor = clampUnit(config.otherThreshold + i * 0.015);
    const mainThreshold = computeAdaptiveBaseThreshold(
      pointsMain.map((point) => point.syntheticStrengths[i] ?? 0),
      baseFloor,
      "sustain"
    );
    const transientThreshold = computeAdaptiveBaseThreshold(
      pointsTransient.map((point) => point.syntheticStrengths[i] ?? 0),
      baseFloor * 0.9,
      "sustain"
    );
    const segments = [
      ...extractSegmentsForSource(
        pointsMain,
        sourceLabel,
        mainThreshold,
        Math.max(0.08, config.otherMinDurationSeconds),
        (point) => point.syntheticStrengths[i] ?? 0,
        adaptiveWindow
      ),
      ...extractSegmentsForSource(
        pointsTransient,
        sourceLabel,
        transientThreshold,
        Math.max(0.045, config.otherMinDurationSeconds * 0.55),
        (point) => point.syntheticStrengths[i] ?? 0,
        Math.max(2, Math.floor(adaptiveWindow / 2))
      )
    ];
    if (segments.length > 0) {
      unlabeledSources.push(...segments);
    }
  }

  const rebalanced = resolveBassDrumConflicts(
    [...drums, ...splitLongEvents(bass, config.bassMaxSustainSeconds), ...unlabeledSources],
    clampUnit(config.reassignMargin)
  );

  return mergeNearbyEvents(rebalanced, Math.max(0.005, config.minInterOnsetSeconds));
}
