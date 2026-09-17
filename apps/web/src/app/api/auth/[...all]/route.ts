import { NextResponse } from "next/server";

/*
 * Better Auth runs on the API service, but the browser must talk to it
 * same-origin so the session cookie is first-party. This forwards
 * /api/auth/* through to the API and passes Set-Cookie back untouched.
 */
function apiUrl() {
  return (process.env.LASTRO_API_URL ?? "http://127.0.0.1:3001").replace(
    /\/$/,
    "",
  );
}

async function proxy(
  request: Request,
  context: { params: Promise<{ all: string[] }> },
) {
  const { all } = await context.params;
  const url = new URL(`${apiUrl()}/api/auth/${all.join("/")}`);
  url.search = new URL(request.url).search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const isRead = request.method === "GET" || request.method === "HEAD";
  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body: isRead ? undefined : await request.text(),
    redirect: "manual",
    cache: "no-store",
  });

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "cache-control": "no-store" },
  });
  const contentType = upstream.headers.get("content-type");
  if (contentType) response.headers.set("content-type", contentType);
  for (const cookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  const location = upstream.headers.get("location");
  if (location) response.headers.set("location", location);
  return response;
}

export const GET = proxy;
export const POST = proxy;
