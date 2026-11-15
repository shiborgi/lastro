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
