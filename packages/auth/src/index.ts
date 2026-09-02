import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  type ExecutionContext,
  type Role,
  type Source,
  assertAuthorized,
  assertExecutionContext,
  operations,
} from "@lastro/domain";

export type AgentCredential = {
  id: string;
  bookId: string;
  principal: string;
  delegatedOperator: string;
  secretHash: string;
  revokedAt: Date | null;
  createdAt?: Date;
};

export type Session = {
  id: string;
  userId: string;
  secretHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt?: Date;
};

export type AuthStore = {
  createAgentCredential: (
    credential: AgentCredential,
  ) => Promise<AgentCredential>;
  getAgentCredential: (id: string) => Promise<AgentCredential | null>;
  revokeAgentCredential: (id: string, bookId: string) => Promise<void>;
  getMembership: (userId: string, bookId: string) => Promise<Role | null>;
  createSession: (session: Session) => Promise<Session>;
  getSession: (id: string) => Promise<Session | null>;
  revokeSession: (id: string) => Promise<void>;
};

function required(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} is required`);
  return value;
}

export function hashSecret(
  secret: string,
  salt = randomBytes(16).toString("hex"),
): string {
  required(secret, "secret");
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

function active(record: { revokedAt: Date | null; expiresAt?: Date }): boolean {
  return (
    !record.revokedAt && (!record.expiresAt || record.expiresAt > new Date())
  );
}

export function createAuthService(store: AuthStore) {
  return {
    async issueAgentCredential(input: {
      context: unknown;
      bookId: string;
      principal: string;
      delegatedOperator: string;
      secret: string;
    }): Promise<{ credential: AgentCredential; secret: string }> {
      required(input.bookId, "bookId");
      required(input.principal, "principal");
      required(input.delegatedOperator, "delegatedOperator");
      required(input.secret, "secret");
      const context = assertExecutionContext(input.context);
      assertAuthorized(context, operations.manageAgentCredentials);
      if (context.bookId !== input.bookId) {
        throw new Error("credential Book does not match context Book");
      }
      const credential: AgentCredential = {
        id: randomUUID(),
        bookId: input.bookId,
        principal: input.principal,
        delegatedOperator: input.delegatedOperator,
        secretHash: hashSecret(input.secret),
        revokedAt: null,
      };
      await store.createAgentCredential(credential);
      return { credential, secret: input.secret };
    },

    async authenticateAgent(input: {
      credentialId: string;
      secret: string;
      bookId?: string;
    }): Promise<{
      credential: AgentCredential;
      context: ExecutionContext;
    } | null> {
      if (!input.credentialId.trim() || !input.secret.trim()) return null;
      const credential = await store.getAgentCredential(input.credentialId);
      if (
        !credential ||
        !active(credential) ||
        (input.bookId !== undefined && credential.bookId !== input.bookId) ||
        !verifySecret(input.secret, credential.secretHash)
      ) {
        return null;
      }
      const role = await store.getMembership(
        credential.delegatedOperator,
        credential.bookId,
      );
      if (!role) return null;
      const context = assertExecutionContext({
        actorId: credential.delegatedOperator,
        bookId: credential.bookId,
        role,
        source: "MCP" satisfies Source,
        correlationId: randomUUID(),
        actorType: "ASSISTANT",
        agentPrincipal: credential.principal,
        delegatedOperator: credential.delegatedOperator,
      });
      return { credential, context };
    },

    async revokeAgentCredential(input: {
      id: string;
      bookId: string;
      context: unknown;
    }): Promise<void> {
      const context = assertExecutionContext(input.context);
      assertAuthorized(context, operations.manageAgentCredentials);
      if (context.bookId !== input.bookId) {
        throw new Error("credential Book does not match context Book");
      }
      await store.revokeAgentCredential(input.id, input.bookId);
    },

    async createSession(input: {
      userId: string;
      expiresAt: Date;
      secret: string;
    }): Promise<{ session: Session; secret: string }> {
      required(input.userId, "userId");
      required(input.secret, "secret");
      const session: Session = {
        id: randomUUID(),
        userId: input.userId,
        secretHash: hashSecret(input.secret),
        expiresAt: input.expiresAt,
        revokedAt: null,
      };
      await store.createSession(session);
      return { session, secret: input.secret };
    },

    async authenticateSession(input: {
      sessionId: string;
      secret: string;
      bookId: string;
      source?: Source;
      correlationId?: string;
    }): Promise<ExecutionContext | null> {
      if (!input.sessionId.trim() || !input.secret.trim()) return null;
      const session = await store.getSession(input.sessionId);
      if (
        !session ||
        !active(session) ||
        !verifySecret(input.secret, session.secretHash)
      ) {
        return null;
      }
      const role = await store.getMembership(session.userId, input.bookId);
      if (!role) return null;
      return assertExecutionContext({
        actorId: session.userId,
        bookId: input.bookId,
        role,
        source: input.source ?? "API",
        correlationId: input.correlationId ?? randomUUID(),
      });
    },

    async revokeSession(id: string): Promise<void> {
      await store.revokeSession(id);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

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

export async function authenticateMcpRequest(
  request: Request,
  auth: AuthService,
  bookId?: string,
) {
  const token = parseBearerCredential(request.headers.get("authorization"));
  if (!token) return null;
  return auth.authenticateAgent({ ...token, bookId });
}
