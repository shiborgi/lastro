/**
 * Better Auth over core's identity tables. Human sign-in only: agent
 * credentials are core's, because Better Auth has no notion of a principal
 * acting for an operator in one Book.
 */
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "@lastro/core/db";
import type { Database } from "@lastro/host";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createSessions(
  db: Database,
  options: { allowSignUp?: boolean } = {},
) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "BETTER_AUTH_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 32",
    );
  const trustedOrigins = (process.env.LASTRO_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return betterAuth({
    secret,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "pg",
      // Better Auth's model names, over Lastro's own table names.
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Self-hosted: no mail transport, so sign-up is gated, not verified.
      requireEmailVerification: false,
      minPasswordLength: 12,
      disableSignUp:
        !options.allowSignUp && process.env.LASTRO_ALLOW_SIGNUP !== "true",
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
    advanced: { defaultCookieAttributes: { sameSite: "lax", httpOnly: true } },
  });
}

export type Sessions = ReturnType<typeof createSessions>;

/** The signed-in user of a request, or null. */
export function sessionUserOf(sessions: Sessions) {
  return async (request: Request) =>
    (await sessions.api.getSession({ headers: request.headers }))?.user.id ??
    null;
}
