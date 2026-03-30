export interface PlaybackClock {
  start: () => void;
  stop: () => void;
}

export function createPlaybackClock(
  readCurrentTime: () => number,
  onTick: (seconds: number) => void
): PlaybackClock {
  let animationFrameId: number | null = null;

  const tick = (): void => {
    onTick(readCurrentTime());
    animationFrameId = window.requestAnimationFrame(tick);
  };

  return {
    start: () => {
      if (animationFrameId !== null) {
        return;
      }
      tick();
    },
    stop: () => {
      if (animationFrameId === null) {
        return;
      }
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };
}
