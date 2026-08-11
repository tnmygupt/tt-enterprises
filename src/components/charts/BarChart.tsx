"use client";

type Point = { label: string; value: number };

type Props = {
  data: Point[];
  height?: number;
  /** Max bars to show */
  maxBars?: number;
  className?: string;
};

/** Plain SVG bar chart using CSS brand tokens. */
export function BarChart({
  data,
  height = 180,
  maxBars = 8,
  className,
}: Props) {
  const rows = data.slice(0, maxBars);
  const max = Math.max(...rows.map((d) => Math.abs(d.value)), 1);
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 36;
  const width = Math.max(320, rows.length * 56);
  const innerH = height - padT - padB;
  const barW = Math.min(36, (width - padL - padR) / Math.max(rows.length, 1) - 8);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Bar chart"
      style={{ width: "100%", height: "auto", maxHeight: height }}
    >
      <line
        x1={padL}
        y1={padT + innerH}
        x2={width - padR}
        y2={padT + innerH}
        stroke="var(--line)"
        strokeWidth={1}
      />
      {rows.map((d, i) => {
        const slot =
          padL +
          ((width - padL - padR) / Math.max(rows.length, 1)) * (i + 0.5);
        const h = (Math.abs(d.value) / max) * innerH;
        const y = padT + innerH - h;
        const label =
          d.label.length > 10 ? `${d.label.slice(0, 9)}…` : d.label;
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              x={slot - barW / 2}
              y={y}
              width={barW}
              height={h}
              rx={4}
              fill="var(--brand)"
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
            <text
              x={slot}
              y={height - 10}
              textAnchor="middle"
              fontSize={10}
              fill="var(--ink-muted)"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
