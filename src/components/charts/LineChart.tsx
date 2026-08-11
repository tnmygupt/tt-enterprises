"use client";

type Point = { label: string; value: number };

type Props = {
  data: Point[];
  height?: number;
  className?: string;
};

/** Plain SVG line chart using CSS brand tokens. */
export function LineChart({ data, height = 180, className }: Props) {
  const rows = data.length ? data : [{ label: "—", value: 0 }];
  const max = Math.max(...rows.map((d) => d.value), 1);
  const min = Math.min(...rows.map((d) => d.value), 0);
  const span = Math.max(max - min, 1);
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const width = Math.max(320, rows.length * 48);
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const pts = rows.map((d, i) => {
    const x =
      padL +
      (rows.length === 1 ? innerW / 2 : (innerW * i) / (rows.length - 1));
    const y = padT + innerH - ((d.value - min) / span) * innerH;
    return { x, y, ...d };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Line chart"
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
      <path
        d={path}
        fill="none"
        stroke="var(--brand-deep)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map((p, i) => (
        <g key={`${p.label}-${i}`}>
          <circle cx={p.x} cy={p.y} r={4} fill="var(--brand)">
            <title>{`${p.label}: ${p.value}`}</title>
          </circle>
          <text
            x={p.x}
            y={height - 8}
            textAnchor="middle"
            fontSize={10}
            fill="var(--ink-muted)"
          >
            {p.label.length > 7 ? p.label.slice(5) : p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
