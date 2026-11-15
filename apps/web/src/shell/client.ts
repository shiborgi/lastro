/**
 * One client for every operation: it builds the request from the descriptor
 * and validates the answer with the descriptor's own output schema, the same
 * one the server answers with. Calls go through this app's proxy, which
 * attaches the session server-side; the browser never holds a credential.
 */
import type { OperationDescriptor } from "@lastro/kernel";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type CallOptions = {
  /** Required for a Book operation. */
  bookId?: string;
  /** Send one for every write a person might retry. */
  idempotencyKey?: string;
  fetch?: typeof fetch;
  /** Where the proxy is mounted. */
  base?: string;
};

/** The URL path and the rest of the input, as the HTTP adapter reads them. */
export function requestOf(
  descriptor: OperationDescriptor,
  input: Record<string, unknown>,
  bookId?: string,
): {
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | undefined;
} {
  const rest = { ...input };
  const path = descriptor.http.path
    .split("/")
    .map((part) => {
      if (!part.startsWith(":")) return part;
      const name = part.slice(1);
      const value = rest[name];
      if (value === undefined || value === null)
        throw new Error(`${descriptor.id} needs ${name}`);
      delete rest[name];
      return encodeURIComponent(String(value));
    })
    .join("/");
  if (descriptor.scope === "book" && !bookId)
    throw new Error(`${descriptor.id} needs a bookId`);
  const prefix =
    descriptor.scope === "book"
      ? `v1/books/${encodeURIComponent(bookId as string)}`
      : "v1";
  const query = new URLSearchParams();
  if (descriptor.http.method === "GET")
    for (const [key, value] of Object.entries(rest))
      if (value !== undefined && value !== null) query.set(key, String(value));
  return {
    path: `${prefix}${path}`,
    query,
    body: descriptor.http.method === "GET" ? undefined : rest,
  };
}

export async function call<D extends OperationDescriptor>(
  descriptor: D,
  input: z.input<D["input"]>,
  options: CallOptions = {},
): Promise<z.output<D["output"]>> {
  const { path, query, body } = requestOf(
    descriptor,
    (input ?? {}) as Record<string, unknown>,
    options.bookId,
  );
  const search = query.toString();
  const response = await (options.fetch ?? fetch)(
    `${options.base ?? "/api/backend"}/${path}${search ? `?${search}` : ""}`,
    {
      method: descriptor.http.method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    error?: {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
  } | null;
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ?? `request failed with ${response.status}`,
      payload?.error?.details,
    );
  return descriptor.output.parse(payload) as z.output<D["output"]>;
}

/** A fresh key for one intended write; keep it across retries of that write. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
