import type { ReactNode } from "react";

export type FieldProps = {
  label: string;
  htmlFor: string;
  error?: string | null;
  children: ReactNode;
};

export function Field({ label, htmlFor, error, children }: FieldProps) {
  return (
    <div style={{ display: "grid", gap: "0.25rem" }}>
      <label htmlFor={htmlFor} style={{ fontSize: "0.75rem", fontWeight: 700 }}>
        {label}
      </label>
      {children}
      {error ? (
        <span
          role="alert"
          style={{ color: "var(--lastro-danger)", fontSize: "0.75rem" }}
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
