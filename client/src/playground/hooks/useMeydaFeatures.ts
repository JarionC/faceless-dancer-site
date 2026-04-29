import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import Meyda from "meyda";
import type { MeydaFrame } from "../types";

interface UseMeydaFeaturesOptions {
  bufferSize: number;
  smoothing: number;
}

interface MeydaRuntimeStats {
  frameCount: number;
  lastFrameAtMs: number;
  analyzerRunning: boolean;
  lastFeatureRms: number;
  lastFeatureFlux: number;
  hasReceivedFrame: boolean;
  analyzerCreated: boolean;
  initError: string | null;
  pollingActive: boolean;
  requestedFeatures: string[];
  availableFeatures: string[];
  enabledFeatures: string[];
  missingFeatures: string[];
}

const EMPTY_FRAME: MeydaFrame = {
  rms: 0,
  zcr: 0,
  spectralCentroid: 0,
  spectralFlatness: 0,
  spectralRolloff: 0,
  spectralFlux: 0,
  loudnessTotal: 0,
  energyBass: 0,
  energyMid: 0,
  energyTreble: 0,
  amplitudeSpectrum: [],
};

interface MeydaAnalyzerLike {
  start: (features?: string | string[]) => void;
  stop: () => void;
  setSource?: (source: AudioNode) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getAudioContextCtor():
  | (new (contextOptions?: AudioContextOptions) => AudioContext)
  | null {
  const WindowWithWebkit = window as typeof window & {
    webkitAudioContext?: new (contextOptions?: AudioContextOptions) => AudioContext;
  };
  return window.AudioContext ?? WindowWithWebkit.webkitAudioContext ?? null;
}

function normalizeFrame(raw: Record<string, unknown>): MeydaFrame {
  const amplitudeSpectrum = Array.isArray(raw.amplitudeSpectrum)
    ? raw.amplitudeSpectrum.filter((value): value is number => typeof value === "number")
    : [];

  const loudness = raw.loudness as { total?: number; specific?: number[] } | undefined;
  const specific = Array.isArray(loudness?.specific)
    ? loudness.specific.filter((value): value is number => typeof value === "number")
    : [];
  const bucket = Math.max(1, Math.floor(specific.length / 3));
  const bass =
    specific.slice(0, bucket).reduce((sum, value) => sum + value, 0) / Math.max(1, bucket);
  const mid =
    specific.slice(bucket, bucket * 2).reduce((sum, value) => sum + value, 0) /
    Math.max(1, bucket);
  const treble =
    specific.slice(bucket * 2).reduce((sum, value) => sum + value, 0) /
    Math.max(1, specific.length - bucket * 2);

  const spectrumBucket = Math.max(1, Math.floor(amplitudeSpectrum.length / 3));
  const spectrumBass =
    amplitudeSpectrum.slice(0, spectrumBucket).reduce((sum, value) => sum + value, 0) /
    Math.max(1, spectrumBucket);
  const spectrumMid =
    amplitudeSpectrum
      .slice(spectrumBucket, spectrumBucket * 2)
      .reduce((sum, value) => sum + value, 0) / Math.max(1, spectrumBucket);
  const spectrumTreble =
    amplitudeSpectrum
      .slice(spectrumBucket * 2)
      .reduce((sum, value) => sum + value, 0) /
    Math.max(1, amplitudeSpectrum.length - spectrumBucket * 2);
  const fallbackLoudnessTotal = spectrumBass + spectrumMid + spectrumTreble;
  const hasLoudnessSpecific = specific.length > 0;

  return {
    rms: clamp(Number(raw.rms) || 0, 0, 1),
    zcr: clamp(Number(raw.zcr) || 0, 0, 1),
    spectralCentroid: Math.max(0, Number(raw.spectralCentroid) || 0),
    spectralFlatness: clamp(Number(raw.spectralFlatness) || 0, 0, 1),
    spectralRolloff: Math.max(0, Number(raw.spectralRolloff) || 0),
    spectralFlux: Math.max(0, Number(raw.spectralFlux) || 0),
    loudnessTotal: Math.max(
      0,
      hasLoudnessSpecific ? Number(loudness?.total) || 0 : fallbackLoudnessTotal
    ),
    energyBass: Math.max(0, hasLoudnessSpecific ? bass : spectrumBass),
    energyMid: Math.max(0, hasLoudnessSpecific ? mid : spectrumMid),
    energyTreble: Math.max(0, hasLoudnessSpecific ? treble : spectrumTreble),
    amplitudeSpectrum,
  };
}

function computeSpectralFlux(
  currentSpectrum: readonly number[],
  previousSpectrum: readonly number[] | null
): number {
  if (!previousSpectrum || previousSpectrum.length === 0 || currentSpectrum.length === 0) {
    return 0;
  }

  const len = Math.min(currentSpectrum.length, previousSpectrum.length);
  let flux = 0;
  for (let i = 0; i < len; i += 1) {
    const delta = Math.abs(currentSpectrum[i] ?? 0) - Math.abs(previousSpectrum[i] ?? 0);
    if (delta > 0) flux += delta;
  }
  return Math.max(0, flux);
}

function smoothFrame(previous: MeydaFrame, next: MeydaFrame, smoothing: number): MeydaFrame {
  const keep = clamp(smoothing, 0, 0.999);
  const take = 1 - keep;
  const len = Math.max(previous.amplitudeSpectrum.length, next.amplitudeSpectrum.length);
  const spectrum: number[] = new Array<number>(len);

  for (let i = 0; i < len; i += 1) {
    const prev = previous.amplitudeSpectrum[i] ?? 0;
    const curr = next.amplitudeSpectrum[i] ?? 0;
    spectrum[i] = prev * keep + curr * take;
  }

  return {
    rms: previous.rms * keep + next.rms * take,
    zcr: previous.zcr * keep + next.zcr * take,
    spectralCentroid: previous.spectralCentroid * keep + next.spectralCentroid * take,
    spectralFlatness: previous.spectralFlatness * keep + next.spectralFlatness * take,
    spectralRolloff: previous.spectralRolloff * keep + next.spectralRolloff * take,
    spectralFlux: previous.spectralFlux * keep + next.spectralFlux * take,
    loudnessTotal: previous.loudnessTotal * keep + next.loudnessTotal * take,
    energyBass: previous.energyBass * keep + next.energyBass * take,
    energyMid: previous.energyMid * keep + next.energyMid * take,
    energyTreble: previous.energyTreble * keep + next.energyTreble * take,
    amplitudeSpectrum: spectrum,
  };
}

export function useMeydaFeatures(
  audioElement: HTMLAudioElement | null,
  options: UseMeydaFeaturesOptions
): {
  featuresRef: { current: MeydaFrame };
  statsRef: { current: MeydaRuntimeStats };
  resumeAudio: () => Promise<void>;
  startAnalyzing: () => void;
  stopAnalyzing: () => void;
} {
  const featuresRef = useRef<MeydaFrame>(EMPTY_FRAME);
  const statsRef = useRef<MeydaRuntimeStats>({
    frameCount: 0,
    lastFrameAtMs: 0,
    analyzerRunning: false,
    lastFeatureRms: 0,
    lastFeatureFlux: 0,
    hasReceivedFrame: false,
    analyzerCreated: false,
    initError: null,
    pollingActive: false,
    requestedFeatures: [],
    availableFeatures: [],
    enabledFeatures: [],
    missingFeatures: [],
  });
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyzerRef = useRef<MeydaAnalyzerLike | null>(null);
  const analysisNodeRef = useRef<AnalyserNode | null>(null);
  const loopRef = useRef<number | null>(null);
  const prevSignalRef = useRef<Float32Array | null>(null);
  const prevSpectrumRef = useRef<number[] | null>(null);
  const bufferRef = useRef<Float32Array | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const linkedElementRef = useRef<HTMLAudioElement | null>(null);
  const outputConnectedRef = useRef(false);

  const featureExtractors = useMemo(
    () => [
      "rms",
      "zcr",
      "amplitudeSpectrum",
      "spectralCentroid",
      "spectralFlatness",
      "spectralRolloff",
    ],
    []
  );

  const resumeAudio = useCallback(async (): Promise<void> => {
    const context = contextRef.current;
    if (!context) return;
    if (context.state !== "running") {
      await context.resume();
    }
  }, []);

  const startAnalyzing = useCallback((): void => {
    const context = contextRef.current;
    if (context && context.state !== "running") {
      void context.resume();
    }
    const analysisNode = analysisNodeRef.current;
    if (!analysisNode) {
      statsRef.current.initError = "Analysis node was not initialized.";
      statsRef.current.analyzerRunning = false;
      return;
    }
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
    statsRef.current.pollingActive = true;
    const meydaAny = Meyda as any;
    const meydaObject =
      typeof meydaAny?.extract === "function"
        ? meydaAny
        : typeof meydaAny?.default?.extract === "function"
          ? meydaAny.default
          : null;

    if (!meydaObject || typeof meydaObject.extract !== "function") {
      statsRef.current.initError = "Meyda extract API not found.";
      statsRef.current.analyzerRunning = false;
      statsRef.current.pollingActive = false;
      return;
    }
    const availableFeatureExtractorsRaw =
      typeof meydaObject.listAvailableFeatureExtractors === "function"
        ? (meydaObject.listAvailableFeatureExtractors.call(meydaObject) as unknown)
        : null;
    const availableSet = new Set(
      Array.isArray(availableFeatureExtractorsRaw)
        ? availableFeatureExtractorsRaw.filter(
            (value): value is string => typeof value === "string" && value.length > 0
          )
        : []
    );
    const enabledFeatureExtractors =
      availableSet.size > 0
        ? featureExtractors.filter((feature) => availableSet.has(feature))
        : featureExtractors;
    const availableFeatures = Array.from(availableSet);
    const missingFeatures = featureExtractors.filter((feature) => !availableSet.has(feature));
    statsRef.current.requestedFeatures = [...featureExtractors];
    statsRef.current.availableFeatures = availableFeatures;
    statsRef.current.enabledFeatures = [...enabledFeatureExtractors];
    statsRef.current.missingFeatures = availableSet.size > 0 ? missingFeatures : [];
    if (enabledFeatureExtractors.length === 0) {
      statsRef.current.initError = "No supported Meyda feature extractors enabled.";
      statsRef.current.analyzerRunning = false;
      statsRef.current.pollingActive = false;
      return;
    }

    const poll = () => {
      const ctx = contextRef.current;
      if (!ctx || ctx.state !== "running") {
        return;
      }
      const node = analysisNodeRef.current;
      if (!node) {
        return;
      }
      const fftSize = node.fftSize;
      if (!bufferRef.current || bufferRef.current.length !== fftSize) {
        bufferRef.current = new Float32Array(fftSize);
      }
      const rawBuffer = bufferRef.current;
      node.getFloatTimeDomainData(rawBuffer);

      const targetLength = Math.min(options.bufferSize, rawBuffer.length);
      const signal = rawBuffer.subarray(0, targetLength);
      const previousSignal = prevSignalRef.current;

      try {
        if (typeof meydaObject === "object" && meydaObject !== null) {
          meydaObject.bufferSize = targetLength;
          meydaObject.sampleRate = ctx.sampleRate;
        }
        const extracted = meydaObject.extract(
          enabledFeatureExtractors as unknown as string[],
          signal,
          previousSignal ?? undefined
        ) as Record<string, unknown> | null;
        statsRef.current.frameCount += 1;
        statsRef.current.lastFrameAtMs = performance.now();
        statsRef.current.hasReceivedFrame = true;
        if (extracted && typeof extracted === "object") {
          const normalized = normalizeFrame(extracted);
          const computedFlux = computeSpectralFlux(
            normalized.amplitudeSpectrum,
            prevSpectrumRef.current
          );
          normalized.spectralFlux = Math.max(normalized.spectralFlux, computedFlux);
          prevSpectrumRef.current = normalized.amplitudeSpectrum.slice();
          featuresRef.current = smoothFrame(featuresRef.current, normalized, options.smoothing);
          statsRef.current.lastFeatureRms = featuresRef.current.rms;
          statsRef.current.lastFeatureFlux = featuresRef.current.spectralFlux;
          statsRef.current.initError = null;
        }
      } catch (error) {
        statsRef.current.initError = error instanceof Error ? error.message : "Meyda extract failed.";
      }

      prevSignalRef.current = new Float32Array(signal);
    };

    poll();
    loopRef.current = window.setInterval(poll, 34);
    statsRef.current.analyzerRunning = true;
  }, [featureExtractors, options.bufferSize, options.smoothing]);

  const stopAnalyzing = useCallback((): void => {
    analyzerRef.current?.stop();
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
    statsRef.current.analyzerRunning = false;
    statsRef.current.pollingActive = false;
  }, []);

  useEffect(() => {
    if (!audioElement) {
      return;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      return;
    }

    if (!contextRef.current) {
      contextRef.current = new AudioContextCtor();
    }

    const audioContext = contextRef.current;
    if (!audioContext) {
      return;
    }

    if (linkedElementRef.current !== audioElement || !sourceRef.current) {
      try {
        sourceRef.current = audioContext.createMediaElementSource(audioElement);
        statsRef.current.initError = null;
      } catch (error) {
        statsRef.current.initError =
          error instanceof Error ? error.message : "Failed to create MediaElementAudioSourceNode.";
        return;
      }
      linkedElementRef.current = audioElement;
    }
    if (!gainRef.current) {
      gainRef.current = audioContext.createGain();
      gainRef.current.gain.value = 1;
    }
    if (!analysisNodeRef.current) {
      const safeFftSize = Math.max(
        64,
        Math.min(
          32768,
          2 ** Math.round(Math.log2(Math.max(64, options.bufferSize * 2)))
        )
      );
      analysisNodeRef.current = audioContext.createAnalyser();
      analysisNodeRef.current.fftSize = safeFftSize;
      analysisNodeRef.current.smoothingTimeConstant = 0.12;
    }

    if (!outputConnectedRef.current) {
      sourceRef.current.connect(gainRef.current);
      gainRef.current.connect(audioContext.destination);
      sourceRef.current.connect(analysisNodeRef.current);
      outputConnectedRef.current = true;
    }

    if (!analyzerRef.current) {
      const createMeydaAnalyzer =
        (Meyda as any)?.createMeydaAnalyzer ??
        (Meyda as any)?.default?.createMeydaAnalyzer;
      if (typeof createMeydaAnalyzer !== "function") {
        statsRef.current.initError = "Meyda createMeydaAnalyzer API not found.";
        return;
      }
      const analyzer = createMeydaAnalyzer({
        audioContext,
        source: sourceRef.current,
        bufferSize: options.bufferSize,
        featureExtractors,
        callback: (features: Record<string, unknown> | null | undefined) => {
          statsRef.current.frameCount += 1;
          statsRef.current.lastFrameAtMs = performance.now();
          statsRef.current.hasReceivedFrame = true;
          if (!features || typeof features !== "object") {
            statsRef.current.initError = "Meyda callback returned empty features.";
            return;
          }
          const normalized = normalizeFrame(features);
          const computedFlux = computeSpectralFlux(
            normalized.amplitudeSpectrum,
            prevSpectrumRef.current
          );
          normalized.spectralFlux = Math.max(normalized.spectralFlux, computedFlux);
          prevSpectrumRef.current = normalized.amplitudeSpectrum.slice();
          featuresRef.current = smoothFrame(
            featuresRef.current,
            normalized,
            options.smoothing
          );
          statsRef.current.lastFeatureRms = featuresRef.current.rms;
          statsRef.current.lastFeatureFlux = featuresRef.current.spectralFlux;
          statsRef.current.initError = null;
        },
      }) as MeydaAnalyzerLike | null;

      if (analyzer) {
        analyzerRef.current = analyzer;
        statsRef.current.analyzerCreated = true;
        statsRef.current.initError = null;
      } else {
        statsRef.current.analyzerCreated = false;
        statsRef.current.initError = "Meyda analyzer creation returned no analyzer instance.";
      }
    }

    const startAnalyzer = () => startAnalyzing();
    const stopAnalyzer = () => stopAnalyzing();

    audioElement.addEventListener("play", startAnalyzer);
    audioElement.addEventListener("pause", stopAnalyzer);
    audioElement.addEventListener("ended", stopAnalyzer);

    if (!audioElement.paused) {
      startAnalyzing();
    }

    return () => {
      audioElement.removeEventListener("play", startAnalyzer);
      audioElement.removeEventListener("pause", stopAnalyzer);
      audioElement.removeEventListener("ended", stopAnalyzer);
      stopAnalyzing();
    };
  }, [
    audioElement,
    featureExtractors,
    options.bufferSize,
    options.smoothing,
    startAnalyzing,
    stopAnalyzing,
  ]);

  useEffect(() => {
    return () => {
      stopAnalyzing();
      if (gainRef.current) {
        gainRef.current.disconnect();
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      const context = contextRef.current;
      if (context && context.state !== "closed") {
        void context.close();
      }
      analyzerRef.current = null;
      analysisNodeRef.current?.disconnect();
      analysisNodeRef.current = null;
      gainRef.current = null;
      sourceRef.current = null;
      contextRef.current = null;
      linkedElementRef.current = null;
      outputConnectedRef.current = false;
      statsRef.current.analyzerCreated = false;
      prevSignalRef.current = null;
      prevSpectrumRef.current = null;
      bufferRef.current = null;
    };
  }, [stopAnalyzing]);

  return { featuresRef, statsRef, resumeAudio, startAnalyzing, stopAnalyzing };
}
