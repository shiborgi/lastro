/**
 * The paths the web proxy forwards, one per operation a registered module
 * declares. Anything else is refused before a request leaves this process.
 */
import type { HttpMethod, OperationDescriptor } from "@lastro/kernel";

const SEGMENT = "[A-Za-z0-9_.-]+";

function pattern(descriptor: OperationDescriptor): RegExp {
  const path = descriptor.http.path
    .split("/")
    .map((part) =>
      part.startsWith(":")
        ? SEGMENT
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(
    `^v1${descriptor.scope === "book" ? `/books/${SEGMENT}` : ""}${path}$`,
  );
}

/** `path` without the leading slash, as the catch-all route receives it. */
export function createAllowlist(operations: readonly OperationDescriptor[]) {
  const routes = operations.map((descriptor) => ({
    method: descriptor.http.method,
    pattern: pattern(descriptor),
  }));
  return function isAllowed(method: string, path: string): boolean {
    const wanted = (method === "HEAD" ? "GET" : method) as HttpMethod;
    return routes.some(
      (route) => route.method === wanted && route.pattern.test(path),
    );
  };
}
