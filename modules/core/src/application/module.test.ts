/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  ForbiddenError,
  UnauthorizedError,
  composeModules,
  defineModule,
} from "@lastro/kernel";
import { coreOperations } from "../contracts";
import { memoryCore } from "../testing";
import { type CoreApi, createCore } from "./module";

/* The real core over the memory store, composed the way the host does it. */
async function setup() {
  const memory = memoryCore();
  const module = defineModule<null, object, CoreApi>({
    id: "core",
    dependsOn: [],
    operations: coreOperations,
    create: () => createCore(memory.store),
  });
  const host = composeModules({
    modules: [module],
    resources: null,
    envelope: (modules) => (modules.core as CoreApi).envelope,
  });
  const core = host.modules.core as CoreApi;

  const owner = await core.admin.createUser({
    id: "u-owner",
    email: "owner@lastro.test",
    name: "Owner",
  });
  const editor = await core.admin.createUser({
    id: "u-editor",
    email: "editor@lastro.test",
    name: "Editor",
  });
  const book = await core.admin.ensureBook({ key: "bar", name: "Bar" });
  await core.admin.setBookMember({
    bookId: book.id,
    userId: owner.id,
    role: "OWNER",
  });
  await core.admin.setBookMember({
    bookId: book.id,
    userId: editor.id,
    role: "EDITOR",
  });
  const context = async (userId: string) => {
    const resolved = await core.identity.contextForUser({
      userId,
      bookId: book.id,
    });
    if (!resolved) throw new Error("fixture");
    return resolved;
  };
  return { host, core, memory, book, owner, editor, context };
}

describe("core admin", () => {
  test("ensureBook finds the Book by key instead of creating a second", async () => {
    const { core, book } = await setup();
    expect(
      await core.admin.ensureBook({ key: "bar", name: "Renamed" }),
    ).toEqual(book);
  });

  test("a credential is issued only for a member, and audited", async () => {
    const { core, memory, book, editor } = await setup();
    await expect(
      core.admin.issueAgentCredential({
        bookId: book.id,
        principal: "agent:x",
        delegatedOperator: "nobody",
        issuedBy: "bootstrap",
      }),
    ).rejects.toThrow("not a member of the Book");

    const issued = await core.admin.issueAgentCredential({
      bookId: book.id,
      principal: "agent:example",
      delegatedOperator: editor.id,
      issuedBy: "bootstrap",
    });
    expect(issued.role).toBe("EDITOR");
    expect(issued.token.startsWith(`${issued.credential.id}.`)).toBe(true);
    expect(issued.credential.secretHash).not.toContain(
      issued.token.split(".")[1] ?? "",
    );
    expect(memory.audits.at(-1)).toMatchObject({
      action: "agent_credential.issued",
      actorType: "SYSTEM",
      resourceId: issued.credential.id,
    });
  });
});

describe("core identity", () => {
  test("a user's context carries the role of their membership, or is null", async () => {
    const { core, book, editor } = await setup();
    expect(
      await core.identity.contextForUser({
        userId: editor.id,
        bookId: book.id,
      }),
    ).toMatchObject({ actorId: editor.id, role: "EDITOR", source: "API" });
    expect(
      await core.identity.contextForUser({
        userId: "stranger",
        bookId: book.id,
      }),
    ).toBeNull();
  });

  test("an agent authenticates as its operator, with the operator's current role", async () => {
    const { core, book, editor } = await setup();
    const { credential, token } = await core.admin.issueAgentCredential({
      bookId: book.id,
      principal: "agent:example",
      delegatedOperator: editor.id,
      issuedBy: "bootstrap",
    });
    const secret = token.slice(credential.id.length + 1);
    const login = { credentialId: credential.id, secret };

    expect(
      (await core.identity.authenticateAgent(login))?.context,
    ).toMatchObject({
      actorId: editor.id,
      bookId: book.id,
      role: "EDITOR",
      source: "MCP",
      actorType: "ASSISTANT",
      agentPrincipal: "agent:example",
    });

    // Demoting the operator demotes the agent on its next request.
    await core.admin.setBookMember({
      bookId: book.id,
      userId: editor.id,
      role: "VIEWER",
    });
    expect((await core.identity.authenticateAgent(login))?.context.role).toBe(
      "VIEWER",
    );

    for (const wrong of [
      { ...login, secret: "wrong" },
      { ...login, credentialId: "unknown" },
      { ...login, bookId: "999" },
    ]) {
      expect(await core.identity.authenticateAgent(wrong)).toBeNull();
    }
  });
});

describe("core operations", () => {
  test("listBooks returns only the caller's Books", async () => {
    const { host, core, book, owner } = await setup();
    await core.admin.ensureBook({ key: "other", name: "Other" });
    expect(
      await host.execute(
        "core.listBooks",
        core.identity.userContext({ userId: owner.id }),
        {},
      ),
    ).toEqual({ items: [book] });
    expect(
      await host.execute(
        "core.listBooks",
        core.identity.userContext({ userId: "stranger" }),
        {},
      ),
    ).toEqual({ items: [] });
  });

  test("revoking a credential is an audited admin write that ends the agent's access", async () => {
    const { host, core, memory, book, owner, editor, context } = await setup();
    const { credential, token } = await core.admin.issueAgentCredential({
      bookId: book.id,
      principal: "agent:x",
      delegatedOperator: editor.id,
      issuedBy: "bootstrap",
    });
    const input = { credentialId: credential.id };

    await expect(
      host.execute(
        "core.revokeAgentCredential",
        await context(editor.id),
        input,
      ),
    ).rejects.toThrow(ForbiddenError);

    expect(
      await host.execute(
        "core.revokeAgentCredential",
        await context(owner.id),
        input,
      ),
    ).toEqual({ id: credential.id, revoked: true });
    expect(memory.audits.at(-1)).toMatchObject({
      operation: "core.revokeAgentCredential",
      action: "agent_credential.revoked",
      resourceId: credential.id,
    });
    expect(
      await core.identity.authenticateAgent({
        credentialId: credential.id,
        secret: token.slice(credential.id.length + 1),
      }),
    ).toBeNull();

    // Already revoked reads the same as unknown.
    await expect(
      host.execute(
        "core.revokeAgentCredential",
        await context(owner.id),
        input,
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  test("the audit trail lists oldest first, filters and pages", async () => {
    const { host, core, book, owner, editor, context } = await setup();
    for (const principal of ["agent:a", "agent:b", "agent:c"]) {
      await core.admin.issueAgentCredential({
        bookId: book.id,
        principal,
        delegatedOperator: editor.id,
        issuedBy: "bootstrap",
      });
    }
    const reader = await context(owner.id);

    const first = (await host.execute("core.listAuditEvents", reader, {
      limit: 2,
    })) as {
      items: { id: string; payload: { principal: string } }[];
      nextCursor: string | null;
    };
    expect(first.items.map((item) => item.payload.principal)).toEqual([
      "agent:a",
      "agent:b",
    ]);
    expect(first.nextCursor).toBe(first.items[1]?.id ?? "");

    const rest = (await host.execute("core.listAuditEvents", reader, {
      limit: 2,
      cursor: first.nextCursor,
    })) as typeof first;
    expect(rest.items.map((item) => item.payload.principal)).toEqual([
      "agent:c",
    ]);
    expect(rest.nextCursor).toBeNull();

    const none = (await host.execute("core.listAuditEvents", reader, {
      action: "agent_credential.revoked",
    })) as typeof first;
    expect(none.items).toEqual([]);
  });
});
