import {
  type Database,
  account,
  session,
  user,
  verification,
} from "@lastro/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export type BetterAuth = ReturnType<typeof createBetterAuth>;

/*
 * Human identity only. Agent credentials for MCP stay in @lastro/auth: they
 * bind a principal to a delegated operator and a single Book, which is what the
 * audit trail records and what Better Auth deliberately does not model.
 */
export function createBetterAuth(
  db: Database,
  options: {
    /*
     * Public sign-up is off by default, which would otherwise make the first
     * account impossible to create. The bootstrap CLI already has direct
     * database access, so it opts in explicitly rather than the served API
     * loosening its own policy.
     */
    allowSignUp?: boolean;
  } = {},
) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 32",
    );
  }

  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
  const trustedOrigins = (process.env.LASTRO_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return betterAuth({
    secret,
    baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      // Self-hosted single-tenant install: there is no mail transport to send a
      // verification link through, so accounts are usable immediately. Sign-up
      // is gated by `disableSignUp` below rather than by email verification.
      requireEmailVerification: false,
      minPasswordLength: 12,
      disableSignUp:
        !options.allowSignUp && process.env.LASTRO_ALLOW_SIGNUP !== "true",
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
    advanced: {
      // The web app reaches the API through its own same-origin proxy, so the
      // cookie is first-party and never needs SameSite=None.
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
      },
    },
  });
}
