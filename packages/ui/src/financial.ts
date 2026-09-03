export type Status = "OPEN" | "PARTIALLY_SETTLED" | "SETTLED";

export const statusTone: Record<Status, "warning" | "info" | "success"> = {
  OPEN: "warning",
  PARTIALLY_SETTLED: "info",
  SETTLED: "success",
};

export function formatMinorUnits(minor: string, currency: string): string {
  const value = Number.parseInt(minor, 10);
  if (Number.isNaN(value)) return `${minor} ${currency}`;
  const major = value / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(major);
  return formatted;
}
