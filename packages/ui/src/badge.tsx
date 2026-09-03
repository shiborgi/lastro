import type { CSSProperties, HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

const toneStyle: Record<BadgeTone, CSSProperties> = {
  neutral: {
    background: "var(--lastro-surface-muted)",
    color: "var(--lastro-text)",
  },
  success: {
    background: "var(--lastro-success)",
    color: "var(--lastro-primary-foreground)",
  },
  warning: {
    background: "var(--lastro-warning)",
    color: "var(--lastro-primary-foreground)",
  },
  danger: {
    background: "var(--lastro-danger)",
    color: "var(--lastro-primary-foreground)",
  },
  info: {
    background: "var(--lastro-info)",
    color: "var(--lastro-primary-foreground)",
  },
};

export function Badge({ tone = "neutral", style, ...props }: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        fontFamily: "var(--lastro-font-sans)",
        fontSize: "0.75rem",
        fontWeight: 700,
        lineHeight: 1,
        padding: "0.25rem 0.5rem",
        border: "2px solid var(--lastro-border)",
        borderRadius: 0,
        ...toneStyle[tone],
        ...style,
      }}
      {...props}
    />
  );
}
