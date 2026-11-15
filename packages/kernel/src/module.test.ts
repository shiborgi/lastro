/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { ExecutionContext } from "./context";
import { type ModuleDefinition, composeModules, defineModule } from "./module";
import {
  type AuditEntry,
  type Envelope,
  type OperationDescriptor,
  bind,
  defineOperation,
} from "./operation";

const context: ExecutionContext = {
  actorId: "u1",
  bookId: "1",
  role: "EDITOR",
  source: "API",
  correlationId: "c1",
};

/* The smallest envelope: no authorization or storage, only a scope. */
function recordingEnvelope() {
  const audits: AuditEntry[] = [];
  const envelope: Envelope = {
    run: (_descriptor, ctx, work) =>
      work({
        context: ctx,
        handle: null,
        audit: (entry) => audits.push(entry),
      }),
  };
  return { envelope, audits };
}

const listNotes = defineOperation({
  id: "notes.list",
  access: "read",
  input: z.object({}).strict(),
  output: z.object({ items: z.array(z.string()) }).strict(),
  http: { method: "GET", path: "/notes" },
  mcp: { name: "list_notes", description: "List the Book's notes." },
});

const addNote = defineOperation({
  id: "notes.add",
  access: "write",
  input: z.object({ text: z.string().min(1) }).strict(),
  output: z.object({ count: z.string() }).strict(),
  http: { method: "POST", path: "/notes" },
  mcp: { name: "add_note", description: "Add a note to the Book." },
});

type NotesApi = { count(): bigint };

function notesModule(
  overrides: Partial<ModuleDefinition<null, object, NotesApi>> = {},
) {
  return defineModule<null, object, NotesApi>({
    id: "notes",
    dependsOn: [],
    operations: [listNotes, addNote],
    create() {
      const notes: string[] = [];
      return {
        api: { count: () => BigInt(notes.length) },
        handlers: [
          bind(listNotes, async () => ({ items: notes })),
          bind(addNote, async ({ scope, input }) => {
            notes.push(input.text);
            scope.audit({ action: "note.added", resourceType: "note" });
            return { count: BigInt(notes.length) };
          }),
        ],
      };
    },
    ...overrides,
  });
}

const countNotes = defineOperation({
  id: "digest.count",
  access: "read",
  input: z.object({}).strict(),
  output: z.object({ count: z.string() }).strict(),
  http: { method: "GET", path: "/digest" },
  mcp: { name: "count_notes", description: "Count the Book's notes." },
});

function digestModule(dependsOn: readonly string[] = ["notes"]) {
  return defineModule<null, { notes: NotesApi }, object>({
    id: "digest",
    dependsOn,
    operations: [countNotes],
    create: ({ modules }) => ({
      api: {},
      handlers: [
        bind(countNotes, async () => ({ count: modules.notes.count() })),
      ],
    }),
  });
}

function compose(modules: readonly ModuleDefinition<null>[]) {
  const { envelope, audits } = recordingEnvelope();
  const host = composeModules({
    modules,
    resources: null,
    envelope: () => envelope,
  });
  return { host, audits };
}

describe("defineOperation", () => {
  const valid = {
    id: "notes.list",
    access: "read",
    input: z.object({}),
    output: z.object({}),
    http: { method: "GET", path: "/notes" },
    mcp: { name: "list_notes", description: "List." },
  } as const;

  test("defaults to a non-destructive Book operation", () => {
    const descriptor = defineOperation(valid);
    expect(descriptor.scope).toBe("book");
    expect(descriptor.destructive).toBe(false);
  });

  test.each([
    ["an id without a module prefix", { id: "list" }],
    [
      "a tool name that is not snake_case",
      { mcp: { name: "listNotes", description: "x" } },
    ],
    [
      "a blank tool description",
      { mcp: { name: "list_notes", description: " " } },
    ],
    [
      "a path without a leading slash",
      { http: { method: "GET", path: "notes" } },
    ],
    ["a write published as GET", { access: "write" }],
    ["a read published as POST", { http: { method: "POST", path: "/notes" } }],
    ["a destructive read", { destructive: true }],
  ] as const)("refuses %s", (_name, change) => {
    expect(() => defineOperation({ ...valid, ...change })).toThrow(
      /^operation /,
    );
  });

  test("refuses a user-scope write", () => {
    expect(() =>
      defineOperation({
        ...valid,
        scope: "user",
        access: "write",
        http: { method: "POST", path: "/notes" },
      }),
    ).toThrow("may only read");
  });
});

describe("composeModules", () => {
  test("two modules compose and execute through the envelope", async () => {
    const { host, audits } = compose([notesModule(), digestModule()]);

    expect(host.operations.map((o: OperationDescriptor) => o.id)).toEqual([
      "notes.list",
      "notes.add",
      "digest.count",
    ]);
    expect(await host.execute("notes.add", context, { text: "a" })).toEqual({
      count: "1",
    });
    expect(await host.execute("digest.count", context, {})).toEqual({
      count: "1",
    });
    expect(audits).toEqual([{ action: "note.added", resourceType: "note" }]);
  });

  test("execute validates the input, the context and the operation id", async () => {
    const { host } = compose([notesModule()]);
    await expect(
      host.execute("notes.add", context, { text: "" }),
    ).rejects.toThrow();
    await expect(
      host.execute("notes.add", { ...context, bookId: "" }, { text: "a" }),
    ).rejects.toThrow("bookId is required");
    await expect(host.execute("notes.remove", context, {})).rejects.toThrow(
      "unknown operation: notes.remove",
    );
  });

  test("a handler's result must match the declared output", async () => {
    const broken = notesModule({
      create: () => ({
        api: { count: () => 0n },
        handlers: [
          bind(listNotes, async () => ({ items: [1] })),
          bind(addNote, async () => ({ count: 0n })),
        ],
      }),
    });
    const { host } = compose([broken]);
    await expect(host.execute("notes.list", context, {})).rejects.toThrow();
  });

  test("refuses a duplicate module", () => {
    expect(() => compose([notesModule(), notesModule()])).toThrow(
      "duplicate module: notes",
    );
  });

  test("refuses a dependency that is missing or composed later", () => {
    expect(() => compose([digestModule()])).toThrow(
      "module digest depends on notes, which is not composed before it",
    );
    expect(() => compose([digestModule(), notesModule()])).toThrow(
      "not composed before it",
    );
  });

  test("delivers what later modules contribute to the module they depend on", async () => {
    let received: readonly unknown[] = [];
    const notes = notesModule({
      create: (context) => {
        received = context.contributions;
        return notesModule().create(context);
      },
    });
    const contributor = (id: string, items: string[]) =>
      defineModule<null, { notes: NotesApi }, object>({
        id,
        dependsOn: ["notes"],
        operations: [],
        contributes: { notes: items },
        create: () => ({ api: {}, handlers: [] }),
      });
    compose([notes, contributor("one", ["a"]), contributor("two", ["b", "c"])]);
    expect(received).toEqual(["a", "b", "c"]);
  });

  test("refuses a contribution to a module not depended on or not composed", () => {
    expect(() =>
      defineModule({
        id: "stray",
        dependsOn: [],
        operations: [],
        contributes: { notes: ["a"] },
        create: () => ({ api: {}, handlers: [] }),
      }),
    ).toThrow("module stray contributes to notes without depending on it");
    const orphan = defineModule({
      id: "orphan",
      dependsOn: ["notes"],
      operations: [],
      contributes: { notes: ["a"] },
      create: () => ({ api: {}, handlers: [] }),
    });
    expect(() => compose([orphan])).toThrow(
      "module orphan contributes to notes, which is not composed",
    );
  });

  test("refuses access to a module that was not declared", () => {
    expect(() => compose([notesModule(), digestModule([])])).not.toThrow();
    const { host } = compose([notesModule(), digestModule([])]);
    expect(host.execute("digest.count", context, {})).rejects.toThrow(
      "undeclared module dependency: digest -> notes",
    );
  });

  test("refuses a declared operation without a handler", () => {
    const partial = notesModule({
      create: () => ({
        api: { count: () => 0n },
        handlers: [bind(listNotes, async () => ({ items: [] }))],
      }),
    });
    expect(() => compose([partial])).toThrow(
      "module notes declares operations without a handler: notes.add",
    );
  });

  test("refuses a handler for an operation the module does not declare", () => {
    const extra = notesModule({ operations: [listNotes] });
    expect(() => compose([extra])).toThrow(
      "module notes binds notes.add, which it does not declare or binds twice",
    );
  });

  test("refuses a module declaring another module's operation", () => {
    expect(() =>
      defineModule({
        id: "digest",
        dependsOn: [],
        operations: [listNotes],
        create: () => ({ api: {}, handlers: [] }),
      }),
    ).toThrow("module digest declares foreign operation notes.list");
  });

  const clash = (change: Partial<Parameters<typeof defineOperation>[0]>) =>
    defineOperation({
      id: "digest.count",
      access: "read",
      input: z.object({}),
      output: z.object({}),
      http: { method: "GET", path: "/digest" },
      mcp: { name: "count_notes", description: "Count." },
      ...change,
    });

  test.each([
    ["HTTP route", clash({ http: { method: "GET", path: "/notes" } })],
    ["MCP tool name", clash({ mcp: { name: "list_notes", description: "x" } })],
  ])("refuses two operations sharing an %s", (_name, descriptor) => {
    const other = defineModule({
      id: "digest",
      dependsOn: [],
      operations: [descriptor],
      create: () => ({
        api: {},
        handlers: [bind(descriptor, async () => ({}))],
      }),
    });
    expect(() => compose([notesModule(), other])).toThrow("collides with");
  });

  test("refuses one operation id declared twice", () => {
    const twice = notesModule({ operations: [listNotes, addNote, listNotes] });
    expect(() => compose([twice])).toThrow("collides with");
  });
});
