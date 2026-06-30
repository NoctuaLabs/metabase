import { useRef, useState } from "react";
import { t } from "ttag";

import { Stack, Text, Title } from "metabase/ui";
import { color } from "metabase/ui/colors";

// Shape of the JSON returned by a "Retention projection" custom action service.
type CurvePoint = {
  day: number;
  retention: number;
  retention_pct: number;
  observed: boolean;
  projected: boolean;
};

type Milestone = { retention: number; retention_pct: number };

export type RetentionProjectionData = {
  game?: string;
  installs?: number;
  cohort_date?: string;
  prefix_last?: number;
  dropped_tail_days?: number[];
  trimmed_tail_days?: number[];
  milestones?: Record<string, Milestone>;
  curve?: CurvePoint[];
};

const MILESTONE_DAYS = [30, 60, 90, 120];

// Chart geometry.
const CHART_WIDTH = 1040;
const CHART_HEIGHT = 360;
const MARGIN = { top: 28, right: 24, bottom: 36, left: 48 };
// Log-scale y bounds (retention fraction). 100% .. 0.1%.
const Y_MAX = 1;
const Y_MIN = 0.001;

const OBSERVED_COLOR = color("brand");
const PROJECTED_COLOR = color("success");

function formatPct(pct: number | undefined): string {
  if (pct == null || !isFinite(pct)) {
    return "—";
  }
  return `${pct.toFixed(2)}%`;
}

function formatInstalls(n: number | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}

function formatCohortDate(iso: string | undefined): string {
  if (!iso) {
    return "—";
  }
  // Keep just the calendar date (the value is a midnight UTC timestamp).
  return iso.slice(0, 10);
}

// Builds the "observed d0–dN → projected to dM · dropped … · held back …" line.
function buildSubtitle(data: RetentionProjectionData): string {
  const parts: string[] = [];
  parts.push(t`${formatInstalls(data.installs)} installs`);
  parts.push(t`cohort ${formatCohortDate(data.cohort_date)}`);

  const curve = data.curve ?? [];
  const observedDays = curve.filter((p) => p.observed).map((p) => p.day);
  const lastDay = curve.length > 0 ? curve[curve.length - 1].day : undefined;
  if (observedDays.length > 0 && lastDay != null) {
    const lastObserved = Math.max(...observedDays);
    parts.push(t`observed d0–d${lastObserved} → projected to d${lastDay}`);
  }

  const dropped = data.dropped_tail_days ?? [];
  if (dropped.length > 0) {
    const lo = Math.min(...dropped);
    const hi = Math.max(...dropped);
    parts.push(t`dropped immature tail d${lo}–d${hi}`);
  }

  const trimmed = data.trimmed_tail_days ?? [];
  if (trimmed.length > 0) {
    const lo = Math.min(...trimmed);
    const hi = Math.max(...trimmed);
    parts.push(t`held back last ${trimmed.length} days (d${lo}–d${hi})`);
  }

  return parts.join(" · ");
}

// Renders the retention-projection report: title, subtitle, milestones table,
// and a log-scale retention curve (observed solid / projected dashed).
export function RetentionProjection({
  data,
}: {
  data: RetentionProjectionData;
}) {
  const title = data.game
    ? t`${data.game} — retention projection`
    : t`Retention projection`;

  return (
    <Stack gap="md" data-testid="pivot-retention-projection">
      <div>
        <Title order={2}>{title}</Title>
        <Text c="text-secondary" mt="xs">
          {buildSubtitle(data)}
        </Text>
      </div>
      <MilestonesTable milestones={data.milestones} />
      <RetentionCurve curve={data.curve ?? []} />
    </Stack>
  );
}

function MilestonesTable({
  milestones,
}: {
  milestones: RetentionProjectionData["milestones"];
}) {
  const cellStyle: React.CSSProperties = {
    border: "1px solid var(--mb-color-border)",
    padding: "0.5rem 1rem",
    textAlign: "left",
  };

  return (
    <table style={{ borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {MILESTONE_DAYS.map((day) => (
            <th
              key={day}
              style={{
                ...cellStyle,
                backgroundColor: "var(--mb-color-bg-light)",
              }}
            >
              {`d${day}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {MILESTONE_DAYS.map((day) => (
            <td key={day} style={{ ...cellStyle, fontWeight: "bold" }}>
              {formatPct(milestones?.[String(day)]?.retention_pct)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

// Maps a cohort day and retention fraction to chart x/y pixels (log y-scale).
function makeScales(curve: CurvePoint[]) {
  const days = curve.map((p) => p.day);
  const minDay = days.length > 0 ? Math.min(...days, 0) : 0;
  const maxDay = days.length > 0 ? Math.max(...days, 1) : 1;
  const innerW = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const innerH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

  const x = (day: number) =>
    MARGIN.left +
    (maxDay === minDay ? 0 : ((day - minDay) / (maxDay - minDay)) * innerW);

  const logMax = Math.log10(Y_MAX);
  const logMin = Math.log10(Y_MIN);
  const y = (retention: number) => {
    const clamped = Math.max(Y_MIN, Math.min(Y_MAX, retention || Y_MIN));
    const f = (Math.log10(clamped) - logMin) / (logMax - logMin);
    return MARGIN.top + (1 - f) * innerH;
  };

  return { x, y, minDay, maxDay };
}

function toPath(points: { x: number; y: number }[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}

function RetentionCurve({ curve }: { curve: CurvePoint[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Hover state: the nearest curve point and the cursor position (in container
  // pixels) used to place the floating tooltip.
  const [hover, setHover] = useState<{
    point: CurvePoint;
    left: number;
    top: number;
  } | null>(null);

  const { x, y, minDay, maxDay } = makeScales(curve);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (svg == null || curve.length === 0) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }
    // The SVG is drawn in viewBox units (CHART_WIDTH wide) but rendered at
    // rect.width px, so convert the cursor's pixel x into a viewBox x.
    const scale = rect.width / CHART_WIDTH;
    const viewBoxX = (e.clientX - rect.left) / scale;
    // Nearest point by horizontal distance.
    let nearest = curve[0];
    let best = Infinity;
    for (const p of curve) {
      const d = Math.abs(x(p.day) - viewBoxX);
      if (d < best) {
        best = d;
        nearest = p;
      }
    }
    setHover({
      point: nearest,
      left: e.clientX - rect.left,
      top: e.clientY - rect.top,
    });
  };

  const handleLeave = () => setHover(null);

  if (curve.length === 0) {
    return null;
  }

  // Observed segment: points flagged observed. Projected segment: the rest,
  // but start it at the last observed point so the dashed line connects.
  const observedPts = curve.filter((p) => p.observed);
  const lastObserved = observedPts[observedPts.length - 1];
  const projectedPts = curve.filter(
    (p) => !p.observed || p === lastObserved, // include the join point
  );
  // Ensure the projected path starts at the boundary point.
  if (
    lastObserved &&
    projectedPts.length > 0 &&
    projectedPts[0] !== lastObserved
  ) {
    projectedPts.unshift(lastObserved);
  }

  const observedPath = toPath(
    observedPts.map((p) => ({ x: x(p.day), y: y(p.retention) })),
  );
  const projectedPath = toPath(
    projectedPts.map((p) => ({ x: x(p.day), y: y(p.retention) })),
  );

  const boundaryDay = lastObserved?.day;

  // Horizontal gridlines + y labels at 100%, 10%, 1%, 0.1%.
  const yTicks = [1, 0.1, 0.01, 0.001];
  // X axis ticks at round cohort days within range.
  const xTicks = [0, 30, 60, 90, 120].filter((d) => d >= minDay && d <= maxDay);

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        width="100%"
        role="img"
        aria-label={t`Retention curve`}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={{ display: "block" }}
      >
        {/* gridlines + y labels */}
        {yTicks.map((tick) => {
          const yy = y(tick);
          return (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={CHART_WIDTH - MARGIN.right}
                y1={yy}
                y2={yy}
                stroke="var(--mb-color-border)"
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 8}
                y={yy + 3}
                textAnchor="end"
                fontSize={11}
                fill="var(--mb-color-text-secondary)"
              >
                {tick >= 1
                  ? "100%"
                  : `${(tick * 100).toFixed(tick < 0.01 ? 1 : 0)}%`}
              </text>
            </g>
          );
        })}

        {/* x axis ticks/labels */}
        {xTicks.map((d) => (
          <text
            key={d}
            x={x(d)}
            y={CHART_HEIGHT - MARGIN.bottom + 18}
            textAnchor="middle"
            fontSize={11}
            fill="var(--mb-color-text-secondary)"
          >
            {d}
          </text>
        ))}
        <text
          x={(MARGIN.left + CHART_WIDTH - MARGIN.right) / 2}
          y={CHART_HEIGHT - 4}
          textAnchor="middle"
          fontSize={11}
          fill="var(--mb-color-text-secondary)"
        >
          {t`cohort day`}
        </text>

        {/* boundary divider between observed and projected */}
        {boundaryDay != null && (
          <line
            x1={x(boundaryDay)}
            x2={x(boundaryDay)}
            y1={MARGIN.top}
            y2={CHART_HEIGHT - MARGIN.bottom}
            stroke="var(--mb-color-border)"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}

        {/* projected (dashed green) then observed (solid blue) on top */}
        <path
          d={projectedPath}
          fill="none"
          stroke={PROJECTED_COLOR}
          strokeWidth={2}
          strokeDasharray="6,4"
        />
        <path
          d={observedPath}
          fill="none"
          stroke={OBSERVED_COLOR}
          strokeWidth={2}
        />

        {/* legend */}
        <g transform={`translate(${MARGIN.left + 8}, ${MARGIN.top - 14})`}>
          <line
            x1={0}
            x2={20}
            y1={0}
            y2={0}
            stroke={OBSERVED_COLOR}
            strokeWidth={2}
          />
          <text
            x={26}
            y={3}
            fontSize={11}
            fill="var(--mb-color-text-secondary)"
          >
            {t`observed`}
          </text>
          <line
            x1={90}
            x2={110}
            y1={0}
            y2={0}
            stroke={PROJECTED_COLOR}
            strokeWidth={2}
            strokeDasharray="6,4"
          />
          <text
            x={116}
            y={3}
            fontSize={11}
            fill="var(--mb-color-text-secondary)"
          >
            {t`projected`}
          </text>
        </g>

        {/* hover marker: vertical guide + dot on the nearest point */}
        {hover && (
          <g pointerEvents="none">
            <line
              x1={x(hover.point.day)}
              x2={x(hover.point.day)}
              y1={MARGIN.top}
              y2={CHART_HEIGHT - MARGIN.bottom}
              stroke="var(--mb-color-text-light)"
              strokeWidth={1}
            />
            <circle
              cx={x(hover.point.day)}
              cy={y(hover.point.retention)}
              r={4}
              fill={hover.point.observed ? OBSERVED_COLOR : PROJECTED_COLOR}
              stroke="var(--mb-color-bg-white)"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>
      {hover && <CurveTooltip hover={hover} />}
    </div>
  );
}

// Floating tooltip that follows the cursor, showing the hovered point's detail.
function CurveTooltip({
  hover,
}: {
  hover: { point: CurvePoint; left: number; top: number };
}) {
  const { point, left, top } = hover;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        // Offset from the cursor so it doesn't sit under the pointer.
        transform: "translate(12px, -50%)",
        pointerEvents: "none",
        background: "var(--mb-color-bg-black)",
        color: "var(--mb-color-text-white)",
        padding: "0.4rem 0.6rem",
        borderRadius: "0.4rem",
        fontSize: "12px",
        lineHeight: 1.5,
        whiteSpace: "nowrap",
        boxShadow: "0 2px 8px var(--mb-color-shadow)",
        zIndex: 1,
      }}
      data-testid="retention-curve-tooltip"
    >
      <div style={{ fontWeight: "bold" }}>{t`Day ${point.day}`}</div>
      <div>{t`Retention: ${formatPct(point.retention_pct)}`}</div>
      <div style={{ opacity: 0.8 }}>
        {point.observed ? t`Observed` : t`Projected`}
      </div>
    </div>
  );
}
