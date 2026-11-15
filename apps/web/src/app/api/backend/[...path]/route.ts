import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isSameSite } from "@/lib/same-site";
import { webModules } from "@/modules";
import { createAllowlist } from "@/shell/allowlist";
import { createRegistry } from "@/shell/registry";

/*
 * The proxy to the API. The browser never holds a credential: the session
 * cookie is attached here, server-side. Only the paths the modules publish
 * are forwarded (the allowlist is derived from their operations), and a
 * cross-site write is refused.
 */
const isAllowed = createAllowlist(createRegistry(webModules).operations);

function apiUrl() {
  return (process.env.LASTRO_API_URL ?? "http://127.0.0.1:3001").replace(
    /\/$/,
    "",
  );
}

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const joined = path.join("/");
  if (!isAllowed(request.method, joined))
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "no such route" } },
      { status: 404 },
    );
  const isRead = request.method === "GET" || request.method === "HEAD";
  if (!isRead && !isSameSite(request))
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "cross-site write" } },
      { status: 403 },
    );
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader)
    return NextResponse.json(
      {
        error: { code: "UNAUTHORIZED", message: "authentication is required" },
      },
      { status: 401 },
    );

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
