/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createApplication } from "@lastro/application";
import {
  type AgentCredential,
  type Session,
  createAuthService,
} from "@lastro/auth";
import type { AuditEvent } from "@lastro/domain";
import { createMcp } from "./app";

function memoryAuth() {
  const credentials = new Map<string, AgentCredential>();
  return {
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
    async createSession(record: Session) {
      return record;
    },
    async getSession() {
      return null;
    },
    async revokeSession() {},
  };
}

describe("MCP authentication boundary", () => {
  test("rejects wrong-Book and revoked credentials generically", async () => {
    const store = memoryAuth();
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
      secret: "secret",
    });
    const application = createApplication({
      listBooks: async () => [],
    });
    const app = createMcp({ ping: async () => true, auth, application });
    const token = `Bearer ${issued.credential.id}.${issued.secret}`;

    const wrongBook = await app.request("/tools/list_books", {
      headers: { authorization: token, "x-book-id": "2" },
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
    const revoked = await app.request("/tools/list_books", {
      headers: { authorization: token, "x-book-id": "1" },
    });

    expect(wrongBook.status).toBe(404);
    expect(revoked.status).toBe(404);
    expect(await wrongBook.text()).toBe(await revoked.text());
  });

  test("authenticates before dispatch and records assistant audit context", async () => {
    const store = memoryAuth();
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
      secret: "secret",
    });
    let dispatched = false;
    let audit: AuditEvent | undefined;
    const application = createApplication({
      createExpense: async (_input, event) => {
        dispatched = true;
        audit = event;
        return {
          id: "1",
          bookId: "1",
          accountId: "1",
          partyId: "1",
          expenseCategoryId: "1",
        };
      },
    });
    const app = createMcp({ ping: async () => true, auth, application });
    const response = await app.request("/tools/create_expense", {
      method: "POST",
      headers: {
        authorization: `Bearer ${issued.credential.id}.${issued.secret}`,
        "x-book-id": "1",
        "x-correlation-id": "correlation-mcp",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId: "1",
        partyId: "1",
        expenseCategoryId: "1",
      }),
    });

    expect(response.status).toBe(201);
    expect(dispatched).toBe(true);
    expect(audit).toMatchObject({
      actorType: "ASSISTANT",
      actorPrincipal: "agent:demo",
      delegatedOperator: "user-1",
      bookId: "1",
      source: "MCP",
      correlationId: "correlation-mcp",
    });
  });
});
