import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
} from "react";
import { Button } from "./button";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
};

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  initialFocusRef,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      initialFocusRef?.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      previous?.focus();
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  };

  const panelStyle: CSSProperties = {
    background: "var(--lastro-surface)",
    color: "var(--lastro-text)",
    border: "4px solid var(--lastro-border)",
    boxShadow: "var(--lastro-shadow-hard)",
    maxWidth: "32rem",
    width: "100%",
    maxHeight: "90vh",
    overflow: "auto",
    outline: "none",
  };

  return (
    <div style={overlayStyle}>
      <dialog open aria-label={title} style={panelStyle}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            borderBottom: "2px solid var(--lastro-border)",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--lastro-font-sans)",
              fontSize: "1rem",
              fontWeight: 700,
            }}
          >
            {title}
          </h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close dialog">
            x
          </Button>
        </header>
        <div style={{ padding: "1rem" }}>{children}</div>
        {footer ? (
          <footer
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.5rem",
              padding: "0.75rem 1rem",
              borderTop: "2px solid var(--lastro-border)",
            }}
          >
            {footer}
          </footer>
        ) : null}
      </dialog>
    </div>
  );
}
