import type { CSSProperties } from "react";
import type { Status } from "./financial";

export function StatusBadge({ status }: { status: Status }) {
  const tone: CSSProperties = {
    OPEN: {
      background: "var(--lastro-warning)",
      color: "var(--lastro-primary-foreground)",
    },
    PARTIALLY_SETTLED: {
      background: "var(--lastro-info)",
      color: "var(--lastro-primary-foreground)",
    },
    SETTLED: {
      background: "var(--lastro-success)",
      color: "var(--lastro-primary-foreground)",
    },
  }[status];

  const label: Record<Status, string> = {
    OPEN: "Open",
    PARTIALLY_SETTLED: "Partial",
    SETTLED: "Settled",
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        fontFamily: "var(--lastro-font-sans)",
        fontSize: "0.75rem",
        fontWeight: 700,
        padding: "0.25rem 0.5rem",
        border: "2px solid var(--lastro-border)",
        borderRadius: 0,
        ...tone,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          display: "inline-block",
          background: "currentColor",
        }}
      />
      {label[status]}
    </span>
  );
}
