/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  ConflictError,
  type ExecutionContext,
  ForbiddenError,
  UnauthorizedError,
  defineOperation,
} from "@lastro/kernel";
import { z } from "zod";
import { memoryEnvelope } from "../testing";

const shape = { input: z.object({}), output: z.object({}) };
const read = defineOperation({
  ...shape,
  id: "notes.list",
  access: "read",
  http: { method: "GET", path: "/notes" },
  mcp: { name: "list_notes", description: "List notes." },
});
const write = defineOperation({
  ...shape,
  id: "notes.add",
  access: "write",
  http: { method: "POST", path: "/notes" },
  mcp: { name: "add_note", description: "Add a note." },
});
const otherWrite = defineOperation({
  ...shape,
  id: "notes.rename",
  access: "write",
  http: { method: "PATCH", path: "/notes" },
  mcp: { name: "rename_note", description: "Rename a note." },
});
const admin = defineOperation({
  ...shape,
  id: "notes.purge",
  access: "admin",
  destructive: true,
  http: { method: "DELETE", path: "/notes" },
  mcp: { name: "purge_notes", description: "Remove every note." },
});
const whoAmI = defineOperation({
  ...shape,
  id: "notes.whoAmI",
  scope: "user",
  access: "read",
  http: { method: "GET", path: "/me" },
  mcp: { name: "who_am_i", description: "Name the caller." },
});

const members = {
  "1:owner": "OWNER",
  "1:editor": "EDITOR",
  "1:viewer": "VIEWER",
} as const;

function as(actorId: string, extra: Partial<ExecutionContext> = {}) {
  return {
    actorId,
    bookId: "1",
    role: "OWNER",
    source: "MCP",
    correlationId: "c1",
    ...extra,
  } satisfies ExecutionContext;
}

const note = { action: "note.added", resourceType: "note", resourceId: "7" };

describe("the write envelope", () => {
  test("a read runs for every member, outside a transaction", async () => {
    const memory = memoryEnvelope(members);
    const result = await memory.envelope.run(
      read,
      as("viewer"),
      async (scope) => {
        expect(scope.context).toMatchObject({
          actorId: "viewer",
          role: "VIEWER",
        });
        return "ok";
      },
    );
    expect(result).toBe("ok");
    expect(memory.transactions).toBe(0);
  });

  test("a read cannot record an audit event", async () => {
    const memory = memoryEnvelope(members);
    await expect(
      memory.envelope.run(read, as("owner"), async (scope) =>
        scope.audit(note),
      ),
    ).rejects.toThrow("is a read and cannot record an audit event");
  });

  test("a caller outside the Book is refused before any transaction opens", async () => {
    const memory = memoryEnvelope(members);
    let ran = false;
    for (const context of [as("stranger"), as("owner", { bookId: "2" })]) {
      await expect(
        memory.envelope.run(write, context, async () => {
          ran = true;
        }),
      ).rejects.toThrow(UnauthorizedError);
    }
    expect(ran).toBe(false);
    expect(memory.transactions).toBe(0);
  });

  test("the role comes from membership, whatever the caller claims", async () => {
    const memory = memoryEnvelope(members);
    await expect(
      memory.envelope.run(
        write,
        as("viewer", { role: "OWNER" }),
        async () => {},
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(memory.transactions).toBe(0);
  });

  test("an editor writes but does not administer", async () => {
    const memory = memoryEnvelope(members);
    await memory.envelope.run(write, as("editor"), async (scope) =>
      scope.audit(note),
    );
    await expect(
      memory.envelope.run(admin, as("editor"), async () => {}),
    ).rejects.toThrow(ForbiddenError);
    await memory.envelope.run(admin, as("owner"), async (scope) =>
      scope.audit(note),
    );
    expect(memory.audits).toHaveLength(2);
  });

  test("a write commits its audit events with who, where and which operation", async () => {
    const memory = memoryEnvelope(members);
    const agent = as("editor", {
      actorType: "ASSISTANT",
      agentPrincipal: "agent:example",
      delegatedOperator: "editor",
    });
    await memory.envelope.run(write, agent, async (scope) => {
      scope.audit({ ...note, payload: { text: "a" } });
    });
    expect(memory.audits).toMatchObject([
      {
        actorType: "ASSISTANT",
        actorPrincipal: "agent:example",
        delegatedOperator: "editor",
        bookId: "1",
        source: "MCP",
        correlationId: "c1",
        operation: "notes.add",
        action: "note.added",
        resourceType: "note",
        resourceId: "7",
        payload: { text: "a" },
      },
    ]);
  });

  test("a write without an audit event is a defect and rolls back", async () => {
    const memory = memoryEnvelope(members);
    await expect(
      memory.envelope.run(write, as("owner"), async () => "done"),
    ).rejects.toThrow("notes.add wrote without an audit event");
  });

  test("a failure inside the work leaves no audit and no idempotency record", async () => {
    const memory = memoryEnvelope(members);
    const context = as("owner", { idempotencyKey: "k1" });
    await expect(
      memory.envelope.run(write, context, async (scope) => {
        scope.audit(note);
        throw new Error("trigger refused");
      }),
    ).rejects.toThrow("trigger refused");
    expect(memory.audits).toEqual([]);

    // The key is still free: the retry runs and is recorded.
    let runs = 0;
    await memory.envelope.run(write, context, async (scope) => {
      runs += 1;
      scope.audit(note);
    });
    expect(runs).toBe(1);
  });

  test("a replayed key answers with the stored result and runs nothing", async () => {
    const memory = memoryEnvelope(members);
    const context = as("owner", { idempotencyKey: "k1" });
    let runs = 0;
    const work = async (scope: { audit(entry: typeof note): void }) => {
      runs += 1;
      scope.audit(note);
      return { id: "7", amount: "150" };
    };
    const first = await memory.envelope.run(write, context, work);
    const second = await memory.envelope.run(write, context, work);
    expect(second).toEqual(first);
    expect(runs).toBe(1);
    expect(memory.audits).toHaveLength(1);
  });

  test("a key already used for another operation is a conflict", async () => {
    const memory = memoryEnvelope(members);
    const context = as("owner", { idempotencyKey: "k1" });
    await memory.envelope.run(write, context, async (scope) =>
      scope.audit(note),
    );
    await expect(
      memory.envelope.run(otherWrite, context, async (scope) =>
        scope.audit(note),
      ),
    ).rejects.toThrow(ConflictError);
  });

  test("a user-scope operation runs without a Book", async () => {
    const memory = memoryEnvelope({});
    const caller = {
      actorId: "anyone",
      source: "API",
      correlationId: "c",
    } as const;
    expect(
      await memory.envelope.run(
        whoAmI,
        caller,
        async (scope) => scope.context.actorId,
      ),
    ).toBe("anyone");
    expect(memory.transactions).toBe(0);
  });
});
