import { useEffect, useMemo, useRef } from "preact/hooks";
import { createPlaybackClock } from "../lib/audio/playbackClock";
import { runtimeConfig } from "../config/runtime";

interface AudioPlayerProps {
  audioUrl: string;
  onTimeUpdate: (timeSeconds: number) => void;
  onDurationAvailable: (durationSeconds: number) => void;
}

export function AudioPlayer({
  audioUrl,
  onTimeUpdate,
  onDurationAvailable
}: AudioPlayerProps): JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const durationRef = useRef(0);

  const getAdjustedTime = (): number => {
    const element = audioRef.current;
    if (!element) {
      return 0;
    }
    const compensated = element.currentTime - runtimeConfig.audioOutputLatencySeconds;
    const duration = durationRef.current > 0 ? durationRef.current : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(duration, compensated));
  };

  const emitAdjustedTime = (): void => {
    onTimeUpdate(getAdjustedTime());
  };

  const clock = useMemo(
    () =>
      createPlaybackClock(
        () => getAdjustedTime(),
        (seconds) => onTimeUpdate(seconds)
      ),
    [onTimeUpdate]
  );

  useEffect(() => {
    return () => {
      clock.stop();
    };
  }, [clock]);

  return (
    <section className="panel player-panel">
      <h2>Playback</h2>
      <audio
        key={audioUrl}
        ref={audioRef}
        src={audioUrl}
        controls
        onPlaying={() => {
          emitAdjustedTime();
          clock.start();
        }}
        onPause={() => {
          clock.stop();
          emitAdjustedTime();
        }}
        onWaiting={() => {
          clock.stop();
          emitAdjustedTime();
        }}
        onEnded={() => {
          clock.stop();
          emitAdjustedTime();
        }}
        onSeeking={() => {
          clock.stop();
          emitAdjustedTime();
        }}
        onSeeked={() => {
          emitAdjustedTime();
        }}
        onLoadedMetadata={(event) => {
          durationRef.current = event.currentTarget.duration || 0;
          onDurationAvailable(durationRef.current);
          onTimeUpdate(0);
        }}
      />
    </section>
  );
}
