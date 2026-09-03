import { type ButtonHTMLAttributes, type CSSProperties, useState } from "react";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const variantStyle: Record<ButtonVariant, CSSProperties> = {
  default: {
    background: "var(--lastro-surface)",
    color: "var(--lastro-text)",
  },
  primary: {
    background: "var(--lastro-primary)",
    color: "var(--lastro-primary-foreground)",
  },
  danger: {
    background: "var(--lastro-danger)",
    color: "var(--lastro-primary-foreground)",
  },
  ghost: {
    background: "transparent",
    color: "var(--lastro-text)",
    borderColor: "transparent",
    boxShadow: "none",
  },
};

export function Button({
  variant = "default",
  type = "button",
  disabled,
  onFocus,
  onBlur,
  onMouseDown,
  onMouseUp,
  onMouseLeave,
  style,
  ...props
}: ButtonProps) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    fontFamily: "var(--lastro-font-sans)",
    fontSize: "0.875rem",
    lineHeight: 1,
    fontWeight: 600,
    border: "2px solid var(--lastro-border)",
    borderRadius: 0,
    cursor: disabled ? "not-allowed" : "pointer",
    userSelect: "none",
    padding: "0.5rem 0.75rem",
    opacity: disabled ? 0.5 : 1,
    boxShadow: pressed
      ? "var(--lastro-shadow-hard-small)"
      : "var(--lastro-shadow-hard)",
    transform: pressed ? "translate(2px, 2px)" : "none",
    transition: "transform 60ms ease, box-shadow 60ms ease",
    outline: focused ? "2px solid var(--lastro-focus)" : "none",
    outlineOffset: 2,
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      onMouseDown={(event) => {
        if (event.button === 0) setPressed(true);
        onMouseDown?.(event);
      }}
      onMouseUp={(event) => {
        setPressed(false);
        onMouseUp?.(event);
      }}
      onMouseLeave={(event) => {
        setPressed(false);
        onMouseLeave?.(event);
      }}
      style={{ ...baseStyle, ...variantStyle[variant], ...style }}
      {...props}
    />
  );
}
