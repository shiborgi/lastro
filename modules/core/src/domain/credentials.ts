/**
 * Agent credentials: a principal acting for one member of one Book.
 *
 * The secret is shown once and stored only as a hash, so a credential can be
 * revoked but never recovered.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { InvalidRequestError } from "@lastro/kernel";

export type AgentCredential = {
  id: string;
  bookId: string;
  principal: string;
  delegatedOperator: string;
  secretHash: string;
  revokedAt: Date | null;
};

export function hashSecret(
  secret: string,
  salt = randomBytes(16).toString("hex"),
): string {
  if (!secret.trim()) throw new InvalidRequestError("secret is required");
  const hash = scryptSync(secret, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifySecret(secret: string, encoded: string): boolean {
  try {
    const [, salt, expectedHex] = encoded.split("$");
    if (!salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(secret, salt, expected.length);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

/** `Bearer <credentialId>.<secret>` → its two parts. */
export function parseBearerCredential(value: string | null): {
  credentialId: string;
  secret: string;
} | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length);
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;
  return {
    credentialId: token.slice(0, separator),
    secret: token.slice(separator + 1),
  };
}
