export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  level: LogLevel;
  message: string;
  correlationId?: string;
  durationMs?: number;
  failure?: string;
  idempotencyConflict?: boolean;
  accessViolation?: boolean;
  toolCost?: number;
  [key: string]: unknown;
};

const SENSITIVE_KEYS = new Set([
  "secret",
  "secrethash",
  "password",
  "token",
  "authorization",
  "bearer",
]);

function redact(value: unknown, key: string): unknown {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return "[REDACTED]";
  if (typeof value === "string" && /(ghp_|github_pat_|Bearer )/.test(value)) {
    return "[REDACTED]";
  }
  return value;
}

export function sanitize(entry: LogEntry): LogEntry {
  const result: LogEntry = { level: entry.level, message: entry.message };
  for (const [key, value] of Object.entries(entry)) {
    if (key === "level" || key === "message") continue;
    result[key] = redact(value, key);
  }
  return result;
}

export function formatLog(entry: LogEntry): string {
  const safe = sanitize(entry);
  return JSON.stringify(safe);
}

export function createLogger() {
  return {
    log(entry: LogEntry): string {
      const line = formatLog(entry);
      if (entry.level === "error") console.error(line);
      else if (entry.level === "warn") console.warn(line);
      else console.log(line);
      return line;
    },
  };
}
