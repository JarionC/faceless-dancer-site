import type { BeatPoint, SourceEvent, SourceName } from "../types/beat";
import { formatSourceLabel, getSourceColor, sortSourceLabels } from "../lib/visual/sourceColors";

interface BeatChartProps {
  points: BeatPoint[];
  peakIndices: number[];
  sourceEvents: SourceEvent[];
  currentTimeSeconds: number;
  durationSeconds: number;
}

const PADDING_LEFT = 56;
const PADDING_RIGHT = 20;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 36;
const MIN_CHART_WIDTH = 1800;
const PIXELS_PER_SECOND = 20;
const PIXELS_PER_POINT = 3;
const LANES_TOP = 32;

function toChartX(timeSeconds: number, durationSeconds: number, chartWidth: number): number {
  const safeDuration = durationSeconds > 0 ? durationSeconds : 1;
  const drawableWidth = chartWidth - PADDING_LEFT - PADDING_RIGHT;
  return PADDING_LEFT + (timeSeconds / safeDuration) * drawableWidth;
}

function toChartY(strength: number, chartHeight: number): number {
  const drawableHeight = chartHeight - PADDING_TOP - PADDING_BOTTOM;
  return PADDING_TOP + (1 - strength) * drawableHeight;
}

function laneY(source: SourceName, lanes: SourceName[]): number {
  const index = lanes.indexOf(source);
  const laneGap = lanes.length > 18 ? 22 : lanes.length > 10 ? 30 : 40;
  return LANES_TOP + Math.max(0, index) * laneGap;
}

export function BeatChart({
  points,
  peakIndices,
  sourceEvents,
  currentTimeSeconds,
  durationSeconds
}: BeatChartProps): JSX.Element {
  if (points.length === 0) {
    return (
      <section className="panel chart-panel">
        <h2>Beat Graph</h2>
        <p>No beat data loaded yet.</p>
      </section>
    );
  }

  const chartWidth = Math.max(
    MIN_CHART_WIDTH,
    Math.ceil(durationSeconds * PIXELS_PER_SECOND),
    points.length * PIXELS_PER_POINT + PADDING_LEFT + PADDING_RIGHT
  );
  const visibleSourceEvents = sourceEvents.filter(
    (event) => event.endSeconds >= 0 && event.startSeconds <= durationSeconds
  );
  const sourceLanes: SourceName[] = Array.from(new Set(visibleSourceEvents.map((event) => event.source)));
  const orderedSourceLanes = sortSourceLabels(sourceLanes);
  const laneGap = orderedSourceLanes.length > 18 ? 22 : orderedSourceLanes.length > 10 ? 30 : 40;
  const chartHeight = Math.max(
    280,
    PADDING_TOP + PADDING_BOTTOM + LANES_TOP + Math.max(1, orderedSourceLanes.length) * laneGap + 20
  );
  const segmentWidth = orderedSourceLanes.length > 18 ? 4 : orderedSourceLanes.length > 10 ? 5 : 7;

  const path = points
    .map((point, index) => {
      const x = toChartX(point.timeSeconds, durationSeconds, chartWidth);
      const y = toChartY(point.strength, chartHeight);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const safeCurrentTime = Math.max(0, Math.min(durationSeconds, currentTimeSeconds));
  const playheadX = toChartX(safeCurrentTime, durationSeconds, chartWidth);
  const peakPoints = peakIndices
    .map((index) => points[index])
    .filter((point): point is BeatPoint => point !== undefined)
    .map((point) => ({
      x: toChartX(point.timeSeconds, durationSeconds, chartWidth),
      y: toChartY(point.strength, chartHeight)
    }));

  return (
    <section className="panel chart-panel">
      <h2>Beat Graph</h2>
      <p className="chart-subtitle">Sources are color-coded and elongated by sustain duration.</p>
      <div className="source-legend">
        {orderedSourceLanes.map((source) => (
          <span
            key={source}
            className="source-chip"
            style={{ backgroundColor: getSourceColor(source) }}
          >
            {formatSourceLabel(source)}
          </span>
        ))}
      </div>
      <div className="chart-wrapper">
        <svg
          width={chartWidth}
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="Beat strength chart"
        >
          <line
            x1={PADDING_LEFT}
            y1={chartHeight - PADDING_BOTTOM}
            x2={chartWidth - PADDING_RIGHT}
            y2={chartHeight - PADDING_BOTTOM}
            className="axis"
          />
          <line
            x1={PADDING_LEFT}
            y1={PADDING_TOP}
            x2={PADDING_LEFT}
            y2={chartHeight - PADDING_BOTTOM}
            className="axis"
          />
          {orderedSourceLanes.map((source) => (
            <g key={source}>
              <line
                x1={PADDING_LEFT}
                y1={laneY(source, orderedSourceLanes)}
                x2={chartWidth - PADDING_RIGHT}
                y2={laneY(source, orderedSourceLanes)}
                className="source-lane"
              />
              <text
                x={PADDING_LEFT + 6}
                y={laneY(source, orderedSourceLanes) - 6}
                className="lane-label"
              >
                {formatSourceLabel(source)}
              </text>
            </g>
          ))}
          <path d={path} className="beat-line" />
          {visibleSourceEvents.map((event, index) => {
            const x1 = toChartX(event.startSeconds, durationSeconds, chartWidth);
            const x2 = toChartX(event.endSeconds, durationSeconds, chartWidth);
            const y = laneY(event.source, orderedSourceLanes);
            const isActive =
              currentTimeSeconds >= event.startSeconds && currentTimeSeconds <= event.endSeconds;

            return (
              <line
                key={`${event.source}-${event.startSeconds}-${index}`}
                x1={x1}
                y1={y}
                x2={Math.max(x2, x1 + 1)}
                y2={y}
                className={`source-segment${isActive ? " active" : ""}`}
                style={{
                  opacity: 0.25 + event.strength * 0.75,
                  stroke: getSourceColor(event.source),
                  strokeWidth: isActive ? segmentWidth + 2 : segmentWidth
                }}
              />
            );
          })}
          {peakPoints.map((peakPoint) => (
            <circle
              key={`${peakPoint.x}-${peakPoint.y}`}
              cx={peakPoint.x}
              cy={peakPoint.y}
              r={3.5}
              className="peak-dot"
            />
          ))}
          <line
            x1={playheadX}
            y1={PADDING_TOP}
            x2={playheadX}
            y2={chartHeight - PADDING_BOTTOM}
            className="playhead"
          />
          <text x={PADDING_LEFT} y={chartHeight - 8} className="axis-label">
            0s
          </text>
          <text x={chartWidth - PADDING_RIGHT - 56} y={chartHeight - 8} className="axis-label">
            {durationSeconds.toFixed(2)}s
          </text>
          <text x={8} y={PADDING_TOP + 8} className="axis-label">
            1.0
          </text>
          <text x={8} y={chartHeight - PADDING_BOTTOM + 4} className="axis-label">
            0.0
          </text>
        </svg>
      </div>
    </section>
  );
}
