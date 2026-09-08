/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { type AgentCredential, createAuthService } from "./index";

function memoryStore() {
  const credentials = new Map<string, AgentCredential>();
  return {
    credentials,
    async createAgentCredential(record: AgentCredential) {
      credentials.set(record.id, record);
      return record;
    },
    async getAgentCredential(id: string) {
      return credentials.get(id) ?? null;
    },
    async revokeAgentCredential(id: string, bookId: string) {
      const record = credentials.get(id);
      if (record?.bookId === bookId) record.revokedAt = new Date();
    },
    async getMembership() {
      return "EDITOR" as const;
    },
  };
}

describe("agent authentication", () => {
  test("hashes the secret and authenticates only in its Book", async () => {
    const store = memoryStore();
    const auth = createAuthService(store);
    const issued = await auth.issueAgentCredential({
      context: {
        actorId: "user-1",
        bookId: "1",
        role: "OWNER",
        source: "API",
        correlationId: "correlation-1",
      },
      bookId: "1",
      principal: "agent:demo",
      delegatedOperator: "user-1",
      secret: "top-secret",
    });

    expect(issued.credential.secretHash).not.toContain("top-secret");
    expect(issued.secret).toBe("top-secret");
    expect(
      await auth.authenticateAgent({
        credentialId: issued.credential.id,
        secret: "top-secret",
        bookId: "1",
      }),
    ).not.toBeNull();
    expect(
      await auth.authenticateAgent({
        credentialId: issued.credential.id,
        secret: "top-secret",
        bookId: "2",
      }),
    ).toBeNull();
  });

  test("revoked credentials fail generically", async () => {
    const store = memoryStore();
    const auth = createAuthService(store);
    const issued = await auth.issueAgentCredential({
      context: {
        actorId: "user-1",
        bookId: "1",
        role: "OWNER",
        source: "API",
        correlationId: "correlation-1",
      },
      bookId: "1",
      principal: "agent:demo",
      delegatedOperator: "user-1",
      secret: "top-secret",
    });
    await auth.revokeAgentCredential({
      id: issued.credential.id,
      bookId: "1",
      context: {
        actorId: "user-1",
        bookId: "1",
        role: "OWNER",
        source: "API",
        correlationId: "correlation-1",
      },
    });
    expect(
      await auth.authenticateAgent({
        credentialId: issued.credential.id,
        secret: "top-secret",
        bookId: "1",
      }),
    ).toBeNull();
  });
});
