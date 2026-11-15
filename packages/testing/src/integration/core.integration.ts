/// <reference types="bun-types" />
import { afterAll, describe, expect, test } from "bun:test";
import { createHost } from "@lastro/host";
import { ForbiddenError, UnauthorizedError } from "@lastro/kernel";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
const core = host.modules.core;
afterAll(() => closeDb(db));

describe("core through the composed host", () => {
  test("bootstrap path: user, Book, membership, credential, agent context", async () => {
    const { book, members } = await seedBook(db, ["OWNER", "EDITOR"]);
    expect(
      await core.admin.ensureBook({ key: book.key, name: "ignored" }),
    ).toEqual(book);

    const issued = await core.admin.issueAgentCredential({
      bookId: book.id,
      principal: "agent:example",
      delegatedOperator: members.EDITOR,
      issuedBy: "bootstrap",
    });
    const [credentialId, secret] = issued.token.split(".") as [string, string];

    const agent = await core.identity.authenticateAgent({
      credentialId,
      secret,
    });
    expect(agent?.context).toMatchObject({
      actorId: members.EDITOR,
      bookId: book.id,
      role: "EDITOR",
      actorType: "ASSISTANT",
      agentPrincipal: "agent:example",
    });
    expect(
      await core.identity.authenticateAgent({ credentialId, secret: "wrong" }),
    ).toBeNull();
  });

  test("listBooks answers with the caller's Books only", async () => {
    const mine = await seedBook(db, ["OWNER"]);
    await seedBook(db, ["OWNER"]);
    const result = await host.execute(
      "core.listBooks",
      core.identity.userContext({ userId: mine.members.OWNER }),
      {},
    );
    expect(result).toEqual({ items: [mine.book] });
  });

  test("revoke is admin-only, audited, idempotent by key, and ends access", async () => {
    const { book, members, as } = await seedBook(db, ["OWNER", "EDITOR"]);
    const issued = await core.admin.issueAgentCredential({
      bookId: book.id,
      principal: "agent:x",
      delegatedOperator: members.EDITOR,
      issuedBy: "bootstrap",
    });
    const [credentialId, secret] = issued.token.split(".") as [string, string];
    const input = { credentialId };

    await expect(
      host.execute("core.revokeAgentCredential", as("EDITOR"), input),
    ).rejects.toThrow(ForbiddenError);

    const owner = as("OWNER", { idempotencyKey: "revoke-1" });
    const first = await host.execute(
      "core.revokeAgentCredential",
      owner,
      input,
    );
    expect(first).toEqual({ id: credentialId, revoked: true });
    // The retry of a delivered-but-unacknowledged call gets the same answer.
    expect(
      await host.execute("core.revokeAgentCredential", owner, input),
    ).toEqual(first);
    // Without the key it is a new request, and the credential is already gone.
    await expect(
      host.execute("core.revokeAgentCredential", as("OWNER"), input),
    ).rejects.toThrow(UnauthorizedError);

    expect(
      await core.identity.authenticateAgent({ credentialId, secret }),
    ).toBeNull();

    const trail = (await host.execute("core.listAuditEvents", as("EDITOR"), {
      resourceId: credentialId,
    })) as {
      items: { action: string; operation: string; createdAt: string }[];
    };
    expect(trail.items.map((event) => event.action)).toEqual([
      "agent_credential.issued",
      "agent_credential.revoked",
    ]);
    expect(trail.items[1]?.operation).toBe("core.revokeAgentCredential");
    expect(trail.items[1]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("the audit trail of one Book is invisible from another", async () => {
    const mine = await seedBook(db, ["OWNER"]);
    const theirs = await seedBook(db, ["OWNER"]);
    await core.admin.issueAgentCredential({
      bookId: theirs.book.id,
      principal: "agent:theirs",
      delegatedOperator: theirs.members.OWNER,
      issuedBy: "bootstrap",
    });
    expect(
      await host.execute("core.listAuditEvents", mine.as("OWNER"), {}),
    ).toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(
      host.execute(
        "core.listAuditEvents",
        mine.as("OWNER", { bookId: theirs.book.id }),
        {},
      ),
    ).rejects.toThrow(UnauthorizedError);
  });
});
