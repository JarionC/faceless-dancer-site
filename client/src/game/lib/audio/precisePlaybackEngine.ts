export interface PrecisePlaybackEngine {
  loadFromArrayBuffer: (audioBytes: ArrayBuffer) => Promise<void>;
  unlock: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (timeSeconds: number) => void;
  getCurrentHeardTime: () => number;
  getDurationSeconds: () => number;
  isPlaying: () => boolean;
  dispose: () => Promise<void>;
  setOnEnded: (handler: (() => void) | null) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createPrecisePlaybackEngine(): PrecisePlaybackEngine {
  const context = new AudioContext({ latencyHint: "interactive" });
  let buffer: AudioBuffer | null = null;
  let source: AudioBufferSourceNode | null = null;
  let startedAtContextTime = 0;
  let startedAtOffset = 0;
  let pauseOffset = 0;
  let playing = false;
  let onEnded: (() => void) | null = null;

  const stopSource = (): void => {
    if (!source) {
      return;
    }
    source.onended = null;
    source.stop();
    source.disconnect();
    source = null;
  };

  const getRenderedContextTime = (): number => {
    // `getOutputTimestamp()` has been observed to stall on some environments,
    // which freezes gameplay time even while audio is audible.
    // Use context.currentTime as the primary clock for stable note sync.
    const outputLatency = Number.isFinite(context.outputLatency) ? context.outputLatency : 0;
    const baseLatency = Number.isFinite(context.baseLatency) ? context.baseLatency : 0;
    const latencyCompensation = outputLatency || baseLatency || 0;
    return Math.max(0, context.currentTime - latencyCompensation);
  };

  const getDurationSeconds = (): number => buffer?.duration ?? 0;

  const getCurrentHeardTime = (): number => {
    const duration = getDurationSeconds();
    if (duration === 0) {
      return 0;
    }
    if (!playing) {
      return clamp(pauseOffset, 0, duration);
    }

    const renderedContextTime = getRenderedContextTime();
    const elapsed = Math.max(0, renderedContextTime - startedAtContextTime);
    return clamp(startedAtOffset + elapsed, 0, duration);
  };

  const startSourceAtOffset = (offset: number): void => {
    if (!buffer) {
      return;
    }
    stopSource();
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);

    const scheduleDelaySeconds = 0.005;
    const startWhen = context.currentTime + scheduleDelaySeconds;
    node.start(startWhen, offset);

    startedAtContextTime = startWhen;
    startedAtOffset = offset;
    source = node;
    playing = true;

    node.onended = () => {
      const reachedEnd = getCurrentHeardTime() >= getDurationSeconds() - 0.005;
      stopSource();
      if (reachedEnd) {
        pauseOffset = getDurationSeconds();
        startedAtOffset = pauseOffset;
      }
      playing = false;
      if (reachedEnd && onEnded) {
        onEnded();
      }
    };
  };

  return {
    loadFromArrayBuffer: async (audioBytes: ArrayBuffer) => {
      stopSource();
      playing = false;
      pauseOffset = 0;
      startedAtOffset = 0;
      const decoded = await context.decodeAudioData(audioBytes.slice(0));
      buffer = decoded;
    },
    unlock: async () => {
      if (context.state === "suspended") {
        await context.resume();
      }
    },
    play: async () => {
      if (!buffer || playing) {
        return;
      }
      if (context.state === "suspended") {
        await context.resume();
      }
      const duration = getDurationSeconds();
      const offset = clamp(pauseOffset, 0, duration);
      startSourceAtOffset(offset);
    },
    pause: () => {
      if (!buffer || !playing) {
        return;
      }
      pauseOffset = getCurrentHeardTime();
      stopSource();
      playing = false;
    },
    seek: (timeSeconds: number) => {
      if (!buffer) {
        return;
      }
      const duration = getDurationSeconds();
      const target = clamp(timeSeconds, 0, duration);
      pauseOffset = target;
      startedAtOffset = target;
      if (playing) {
        startSourceAtOffset(target);
      } else {
        stopSource();
      }
    },
    getCurrentHeardTime,
    getDurationSeconds,
    isPlaying: () => playing,
    dispose: async () => {
      stopSource();
      playing = false;
      await context.close();
    },
    setOnEnded: (handler) => {
      onEnded = handler;
    }
  };
}
