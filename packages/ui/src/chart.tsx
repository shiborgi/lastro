import type { CSSProperties } from "react";

export type ChartDatum = {
  label: string;
  value: number;
  color?: string;
};

export type BarChartProps = {
  data: ChartDatum[];
  height?: number;
  ariaLabel: string;
};

export function BarChart({ data, height = 120, ariaLabel }: BarChartProps) {
  const max = Math.max(1, ...data.map((datum) => datum.value));

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "0.5rem",
        height,
      }}
    >
      {data.map((datum) => {
        const ratio = datum.value / max;
        const barStyle: CSSProperties = {
          width: "100%",
          background: datum.color ?? "var(--lastro-primary)",
          border: "2px solid var(--lastro-border)",
          height: `${Math.max(4, Math.round(ratio * (height - 24)))}px`,
        };
        return (
          <div
            key={datum.label}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              gap: "0.25rem",
              minWidth: 0,
            }}
          >
            <div style={barStyle} />
            <span
              style={{
                fontSize: "0.65rem",
                textAlign: "center",
                fontFamily: "var(--lastro-font-sans)",
                color: "var(--lastro-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {datum.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
