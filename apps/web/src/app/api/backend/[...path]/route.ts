import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/*
 * Server-side proxy to the Lastro API. It exists so the browser never holds an
 * API credential: the Better Auth session cookie is read here and forwarded
 * upstream. The allowlist below is the authoritative list of what the web app
 * may reach — anything else 404s before a request leaves this process.
 */
const RESOURCES = [
  "expenses",
  "payments",
  "expense-settlements",
  "revenues",
  "receipts",
  "revenue-settlements",
  "transfers",
  "institutions",
  "accounts",
  "parties",
  "card-descriptors",
  "account-reference-months",
  "account-descriptors",
  "categories",
  "position",
  "revenue-position",
  "cash-flow",
].join("|");

const ID = "[A-Za-z0-9_-]+";

/*
 * Reports read under a Book that are not collections of records. They have to
 * be named: the previous single-pattern regex could not tell `insights` from a
 * record id, so these two reached the API by accident, while
 * `movements/<kind>/<id>/post` — one segment longer than that pattern allowed —
 * was refused here, and the promote button on the review screen did nothing.
 */
const REPORTS = ["insights"].join("|");

/** The two review queues, and the staged rows behind them. */
const QUEUES = ["card-descriptors", "account-descriptors"].join("|");

/**
 * Every path shape the web app may reach, one branch per shape. Exported so a
 * test can assert each call in `lib/api.ts` still matches: the allowlist is a
 * string, so nothing else notices when the two drift apart.
 */
export const safePath = new RegExp(
  [
    "^v1/books$",
    `^v1/books/${ID}$`,
    `^v1/books/${ID}/(?:${REPORTS})$`,
    `^v1/books/${ID}/(?:${RESOURCES})$`,
    `^v1/books/${ID}/(?:${RESOURCES})/${ID}$`,
    `^v1/books/${ID}/(?:${RESOURCES})/${ID}/void$`,
    `^v1/books/${ID}/(?:${QUEUES})/pending$`,
    `^v1/books/${ID}/movements/(?:card|account)$`,
    `^v1/books/${ID}/movements/(?:card|account)/${ID}/post$`,
  ].join("|"),
);

function apiUrl() {
  return (process.env.LASTRO_API_URL ?? "http://127.0.0.1:3001").replace(
    /\/$/,
    "",
  );
}

/*
 * CSRF guard for mutations. Compares the browser-set `Origin` against the host
 * the request actually arrived on.
 *
 * Deliberately hostname-only. `request.url` is the server's own internal URL,
 * so behind any port mapping or TLS-terminating proxy — a published container
 * port, `tailscale serve`, any reverse proxy — its scheme and port never match
 * the browser's, and comparing them rejects every legitimate write. Port is
 * excluded for the same reason it carries no weight here: cookies are not
 * port-scoped, so a same-hostname attacker on another port already shares this
 * cookie jar and comparing ports would buy nothing.
 *
 * The hostname is the part that carries the security meaning: a browser will
 * never send our hostname in `Host` and an attacker's in `Origin`, and page
 * JavaScript cannot forge either header.
 */
export function isSameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  // Non-browser callers (curl, a server-side fetch) send no Origin at all;
  // there is no cross-site request to guard against in that case.
  if (!origin) return true;

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;

  try {
    // `Host` may or may not carry a port depending on the proxy in front;
    // parsing it as a URL normalises both shapes to a bare hostname.
    return new URL(origin).hostname === new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
}

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const joined = path.join("/");
  if (!safePath.test(joined))
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const isRead = request.method === "GET" || request.method === "HEAD";
  if (!isRead && !isSameSite(request)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(`${apiUrl()}/${joined}`);
  url.search = new URL(request.url).search;

  const headers = new Headers({ cookie: cookieHeader });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

  const body = isRead ? undefined : await request.text();
  if (body) headers.set("content-type", "application/json");

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
