import { useMemo } from "preact/hooks";
import type { EntryLyrics, LyricSegment } from "../types/beat";

interface LyricsSubtitleProps {
  lyrics?: EntryLyrics | null;
  currentTimeSeconds: number;
  className?: string;
}

type SubtitleState = "active" | "entering" | "leaving";

interface SubtitleViewModel {
  segment: LyricSegment;
  state: SubtitleState;
}

function normalizeSegments(lyrics: EntryLyrics | null | undefined): LyricSegment[] {
  if (!lyrics || !lyrics.enabled || !Array.isArray(lyrics.segments)) {
    return [];
  }
  return lyrics.segments
    .filter((segment) =>
      segment &&
      typeof segment.text === "string" &&
      Number.isFinite(segment.startSeconds) &&
      Number.isFinite(segment.endSeconds)
    )
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

function resolveSubtitleViewModel(segments: LyricSegment[], currentTimeSeconds: number): SubtitleViewModel | null {
  if (segments.length === 0) {
    return null;
  }

  const active = segments.find(
    (segment) =>
      currentTimeSeconds >= segment.startSeconds - 0.02 &&
      currentTimeSeconds <= segment.endSeconds + 0.08
  );
  if (active) {
    return { segment: active, state: "active" };
  }

  let previous: LyricSegment | null = null;
  for (const segment of segments) {
    if (segment.endSeconds < currentTimeSeconds) {
      previous = segment;
      continue;
    }
    break;
  }
  if (previous && currentTimeSeconds - previous.endSeconds <= 0.28) {
    return { segment: previous, state: "leaving" };
  }

  const upcoming = segments.find((segment) => segment.startSeconds > currentTimeSeconds);
  if (upcoming && upcoming.startSeconds - currentTimeSeconds <= 0.22) {
    return { segment: upcoming, state: "entering" };
  }

  return null;
}

export function LyricsSubtitle({ lyrics, currentTimeSeconds, className }: LyricsSubtitleProps): JSX.Element | null {
  const segments = useMemo(() => normalizeSegments(lyrics), [lyrics]);
  const viewModel = useMemo(
    () => resolveSubtitleViewModel(segments, currentTimeSeconds),
    [segments, currentTimeSeconds]
  );

  if (!viewModel) {
    return null;
  }

  const words = Array.isArray(viewModel.segment.words) ? viewModel.segment.words : [];
  const effectiveWords =
    words.length > 0
      ? words
      : [
          {
            text: viewModel.segment.text,
            startSeconds: viewModel.segment.startSeconds,
            endSeconds: viewModel.segment.endSeconds,
          },
        ];

  return (
    <div className={`lyrics-subtitle ${viewModel.state}${className ? ` ${className}` : ""}`}>
      <p className="lyrics-subtitle__line" aria-live="polite">
        {effectiveWords.map((word, index) => {
          const isActive =
            currentTimeSeconds >= word.startSeconds - 0.01 &&
            currentTimeSeconds <= word.endSeconds + 0.04;
          const isPast = currentTimeSeconds > word.endSeconds + 0.04;
          const toneClass = isActive ? "active" : isPast ? "past" : "idle";
          return (
            <span key={`${viewModel.segment.id}-${index}-${word.startSeconds}`} className={`lyrics-word ${toneClass}`}>
              {word.text}{index < effectiveWords.length - 1 ? " " : ""}
            </span>
          );
        })}
      </p>
    </div>
  );
}
