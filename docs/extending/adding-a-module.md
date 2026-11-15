# Adding a module

A business module owns a vertical slice: its rules, wire schemas, use cases,
persistence port, tables, triggers, operations and screens (ADR 11). Adding
one never edits another module. This guide builds a complete, minimal module,
`notes` (a Book's free-text notes), and lists every file it touches.

`modules/core` is the reference implementation for anything this example
leaves out, such as an envelope-level concern. `modules/finance` shows a
module other modules call, and `modules/sales` shows a module that calls one.

## What you will touch

| Where | What | Why |
|---|---|---|
| `modules/notes/` | New package: everything the module is | The slice itself |
| `packages/host/src/modules.ts` | Import the manifest, append it to `manifests` | Composition, init and fitness tests follow this list |
| `packages/host/package.json` | Depend on `@lastro/notes` | The host imports the manifest |
| `packages/host/drizzle/` | Regenerated | The single init now carries the new tables |
| `apps/web/src/modules/notes/` | The screens (only if it has any) | Screens live with the web app's UI kit |
| `apps/web/src/modules/index.ts` | Append the web module | Navigation follows this list |
| `apps/web/package.json` | Depend on `@lastro/notes` | Screens import its contracts |
| `packages/testing/package.json` | Depend on `@lastro/notes` (only for integration tests) | Tests import its `/db` |

The HTTP routes, the MCP tools, the web client and the audit trail come from
the operations' descriptors; the web proxy forwards the operations the web
module declares. There is nothing else to register.

## 1. The package

```text
modules/notes/
  package.json
  tsconfig.json
  README.md
  src/
    domain/          pure rules and types
    contracts/       zod schemas and operation descriptors (browser-safe)
    application/     port.ts and the use cases
    db/              schema.ts, triggers.sql, repository.ts, index.ts
    index.ts         the manifest
    testing.ts       a fake of the port
```

`package.json`. Its module dependencies must match the manifest's `dependsOn`
exactly; `packages/testing/src/fitness.test.ts` checks it.

```json
{
  "name": "@lastro/notes",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./contracts": "./src/contracts/index.ts",
    "./db": "./src/db/index.ts",
    "./testing": "./src/testing.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "test": "bun test --pass-with-no-tests",
    "build": "bun build ./src/index.ts --outdir dist --target bun --packages=external --external '@lastro/*'",
    "check": "bun run typecheck && bun run lint && bun run test && bun run build"
  },
  "dependencies": {
    "@lastro/core": "workspace:*",
    "@lastro/kernel": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "zod": "^4.5.4"
  },
  "devDependencies": { "@types/node": "^22.7.4", "typescript": "^5.6.3" }
}
```

`tsconfig.json`:

```json
{ "extends": "../../tsconfig.json", "compilerOptions": { "outDir": "./dist" }, "include": ["src/**/*"] }
```

## 2. The tables

`src/db/schema.ts`. Every table carries `book_id` in its primary key and in
every reference, so no record can point into another Book (ADR 3). A table
references only its own module's tables or a dependency's, imported from that
module's `/db`.

```ts
import { books } from "@lastro/core/db";
import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";

export const notes = pgTable(
  "notes",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ name: "notes_book_id_id_pk", columns: [table.bookId, table.id] }),
    bookForeignKey: foreignKey({
      name: "notes_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    textCheck: check("notes_text_not_blank", sql`length(trim(${table.text})) > 0`),
  }),
);
```

`src/db/triggers.sql` holds the rules a CHECK cannot express, with
`--> statement-breakpoint` between statements. A module with none still has
the file, with a comment:

```sql
-- notes: invariants a CHECK cannot express. None so far.
```

## 3. The vocabulary and the port

`src/domain/notes.ts`:

```ts
export type Note = { id: string; bookId: string; text: string; createdAt: Date };
```

`src/application/port.ts`. Every member is required. Each takes the scope's
`handle` first, so it runs on the caller's transaction.

```ts
import type { Note } from "../domain/notes";

export type NotesPort = {
  list(handle: unknown, bookId: string): Promise<Note[]>;
  insert(handle: unknown, bookId: string, text: string): Promise<Note>;
};
```

## 4. The operations

`src/contracts/index.ts` is browser-safe: zod, the kernel, domain *types* and
other modules' `/contracts`, nothing else. An operation's id is
`<module>.<camelCaseName>`; a read is a GET; a destructive operation sets
`destructive: true` and the MCP adapter then demands `confirmation`.

```ts
import { Id, IsoDate, defineOperation } from "@lastro/kernel";
import { z } from "zod";

export const NoteResource = z.object({ id: Id, bookId: Id, text: z.string(), createdAt: IsoDate }).strict();

export const listNotes = defineOperation({
  id: "notes.listNotes",
  access: "read",
  input: z.object({}).strict(),
  output: z.object({ items: z.array(NoteResource) }).strict(),
  http: { method: "GET", path: "/notes" },
  mcp: { name: "list_notes", description: "List the Book's notes, oldest first." },
});

export const addNote = defineOperation({
  id: "notes.addNote",
  access: "write",
  input: z.object({ text: z.string().trim().min(1).max(2000) }).strict(),
  output: NoteResource,
  http: { method: "POST", path: "/notes" },
  mcp: { name: "add_note", description: "Add a free-text note to the Book." },
});

export const notesOperations = [listNotes, addNote] as const;
```

That is the whole surface. Both adapters publish them: `GET` and
`POST /v1/books/:bookId/notes`, MCP tools `list_notes` and `add_note`.

## 5. The use cases

`src/application/module.ts`. A handler returns domain values (`bigint`,
`Date`, string ids); the host converts and validates them against the output
schema. A write records at least one audit event, or the envelope refuses it.
Throw `LastroError` subclasses for refusals; a plain `Error` reaches callers
as `500 INTERNAL`.

```ts
import { type BoundOperation, bind } from "@lastro/kernel";
import { addNote, listNotes } from "../contracts";
import type { NotesPort } from "./port";

/* What other modules may call; nothing yet. */
export type NotesApi = Record<string, never>;

export function createNotes(port: NotesPort): { api: NotesApi; handlers: readonly BoundOperation[] } {
  return {
    api: {},
    handlers: [
      bind(listNotes, async ({ scope }) => ({ items: await port.list(scope.handle, scope.context.bookId) })),
      bind(addNote, async ({ scope, input }) => {
        const note = await port.insert(scope.handle, scope.context.bookId, input.text);
        scope.audit({ action: "note.added", resourceType: "note", resourceId: note.id });
        return note;
      }),
    ],
  };
}
```

Authorization, the transaction, idempotent replay and the audit insert are
the envelope's (`modules/core/README.md`). A module never does them itself.

## 6. The adapter

`src/db/repository.ts` implements the port. `idNumber` turns a decimal id
into the serial PostgreSQL holds and refuses anything else.

```ts
import { type Db, idNumber } from "@lastro/core/db";
import { asc, eq } from "drizzle-orm";
import type { NotesPort } from "../application/port";
import type { Note } from "../domain/notes";
import { notes } from "./schema";

const on = (handle: unknown) => handle as Db;
const fromRow = (row: typeof notes.$inferSelect): Note => ({
  id: String(row.id),
  bookId: String(row.bookId),
  text: row.text,
  createdAt: row.createdAt,
});

export function createNotesRepository(): NotesPort {
  return {
    async list(handle, bookId) {
      const rows = await on(handle).select().from(notes).where(eq(notes.bookId, idNumber(bookId, "bookId"))).orderBy(asc(notes.id));
      return rows.map(fromRow);
    },
    async insert(handle, bookId, text) {
      const [row] = await on(handle).insert(notes).values({ bookId: idNumber(bookId, "bookId"), text }).returning();
      if (!row) throw new Error("note insert returned no row");
      return fromRow(row);
    },
  };
}
```

`src/db/index.ts`:

```ts
export { createNotesRepository } from "./repository";
export * from "./schema";
```

## 7. The manifest

`src/index.ts`. `dependsOn` names every module this one uses, and only those;
a module may reach another only through what it declares.

```ts
import { defineModule } from "@lastro/kernel";
import { type NotesApi, createNotes } from "./application/module";
import { notesOperations } from "./contracts";
import { createNotesRepository } from "./db";

export const notesModule = defineModule<unknown, object, NotesApi>({
  id: "notes",
  dependsOn: ["core"],
  operations: notesOperations,
  create: () => createNotes(createNotesRepository()),
});

export { type NotesApi, createNotes } from "./application/module";
export type { Note } from "./domain/notes";
```

## 8. Register it with the host

In `packages/host/src/modules.ts`, import `notesModule` and append it to
`manifests` after every module it depends on. Add `"@lastro/notes":
"workspace:*"` to `packages/host/package.json`, then:

```bash
bun install
bun run db:regenerate    # rebuilds packages/host/drizzle/0000_init.sql
```

Commit the regenerated `packages/host/drizzle/`. A deployed database is
recreated, never migrated (`docs/operating/runbook.md`).

## 9. Tests

A unit test composes the module with the in-memory core, so it runs through
the real envelope without PostgreSQL. `src/testing.ts` gives the fake port:

```ts
import type { NotesPort } from "./application/port";
import type { Note } from "./domain/notes";

export function memoryNotesPort(): NotesPort {
  const rows: Note[] = [];
  return {
    list: async (_handle, bookId) => rows.filter((row) => row.bookId === bookId),
    async insert(_handle, bookId, text) {
      const note = { id: String(rows.length + 1), bookId, text, createdAt: new Date() };
      rows.push(note);
      return note;
    },
  };
}
```

`src/application/module.test.ts`:

```ts
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { type CoreApi, createCore } from "@lastro/core";
import { coreOperations } from "@lastro/core/contracts";
import { memoryCore } from "@lastro/core/testing";
import { ForbiddenError, composeModules, defineModule } from "@lastro/kernel";
import { notesOperations } from "../contracts";
import { memoryNotesPort } from "../testing";
import { createNotes } from "./module";

function host() {
  const memory = memoryCore({ "1:editor": "EDITOR", "1:viewer": "VIEWER" });
  return composeModules({
    modules: [
      defineModule({ id: "core", dependsOn: [], operations: coreOperations, create: () => createCore(memory.store) }),
      defineModule({ id: "notes", dependsOn: ["core"], operations: notesOperations, create: () => createNotes(memoryNotesPort()) }),
    ],
    resources: null,
    envelope: (modules) => (modules.core as CoreApi).envelope,
  });
}

const as = (actorId: string) => ({ actorId, bookId: "1", role: "VIEWER", source: "API", correlationId: "c" }) as const;

describe("notes", () => {
  test("an editor adds a note and everyone reads it", async () => {
    const notes = host();
    await notes.execute("notes.addNote", as("editor"), { text: "call the landlord" });
    expect(await notes.execute("notes.listNotes", as("viewer"), {})).toMatchObject({ items: [{ text: "call the landlord" }] });
    await expect(notes.execute("notes.addNote", as("viewer"), { text: "x" })).rejects.toThrow(ForbiddenError);
  });
});
```

Integration tests go in `packages/testing/src/integration/*.integration.ts`
and run against PostgreSQL through `createHost(db)` with `seedBook` from
`fixtures.ts`; see `finance-catalog.integration.ts`. Rules in
`triggers.sql` are tested there, with plain inserts.

## 10. A screen

Screens go in `apps/web/src/modules/<id>/`. They may import only their own
folder, `@/shell/*`, `@/components/ui/*`, `@/lib/*`, `@lastro/kernel`, and
the `/contracts` of their own module and of the modules it depends on;
`apps/web/src/__tests__/modules-architecture.test.ts` refuses anything else. `call(descriptor, input, { bookId })` from
`@/shell/client` reaches any operation and validates its answer.

`apps/web/src/modules/notes/module.tsx`:

```tsx
"use client";

import { addNote, listNotes, notesOperations } from "@lastro/notes/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { call, newIdempotencyKey } from "@/shell/client";
import { ErrorNote, TextField, failure, useList } from "@/shell/forms";
import type { WebModule } from "@/shell/registry";

function NotesScreen({ bookId }: { bookId: string }) {
  const [version, setVersion] = useState(0);
  const list = useList(listNotes, bookId, {}, version);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Notas" className="space-y-4">
      <h1 className="text-lg font-semibold">Notas</h1>
      <form
        className="flex items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await call(addNote, { text }, { bookId, idempotencyKey: newIdempotencyKey() });
            setText("");
            setVersion((value) => value + 1);
          } catch (cause) {
            setError(failure(cause));
          }
        }}
      >
        <TextField id="note-text" label="Nota" required value={text} onChange={setText} />
        <Button type="submit">Anotar</Button>
      </form>
      <ErrorNote text={error ?? list.error} />
      <ul>{list.items?.map((note) => <li key={note.id}>{String(note.text)}</li>)}</ul>
    </section>
  );
}

export const notesWebModule: WebModule = {
  id: "notes",
  label: "Notas",
  // What the screens call: the proxy forwards these and nothing else.
  operations: notesOperations,
  views: [{ id: "notes", label: "Notas", render: ({ bookId }) => <NotesScreen key={bookId} bookId={bookId} /> }],
};
```

Append `notesWebModule` in `apps/web/src/modules/index.ts` and add
`"@lastro/notes": "workspace:*"` to `apps/web/package.json`. A catalog that
is plain list/create/update/delete is a declaration over
`@/shell/resource-screen` instead; see `apps/web/src/modules/finance/catalogs.tsx`.

A module that adds something to another module's view, rather than a view
of its own, declares `actions` keyed by that view's id; the view receives
them in its `actions` and renders them. That is how an import module puts its
upload on the review screen it fills (`apps/web/src/modules/finance-imports/module.tsx`).
The registry refuses an action on a view no registered module has.

A module that extends another module's behaviour, such as a parser for an
import module, declares `contributes` in its manifest instead of an
operation; see `docs/extending/adding-an-import-flow.md`.

## 11. Verify

```bash
bun run check              # typecheck, lint, unit, fitness, builds
bun run test:integration   # Docker: the init, both adapters, PostgreSQL
bun run smoke              # Docker: install path, agent over MCP, web sign-in
```

Then fill `modules/notes/README.md`: what it owns, what it depends on, its
public interface, operations, tables and invariants. The existing module
READMEs are the template.

## When something does not work

- **"module notes declares operations without a handler"** at start-up: an
  operation is in `notesOperations` but not bound, or the reverse.
- **"wrote without an audit event"**: a write handler did not call
  `scope.audit`.
- **A ZodError on a result**: the handler returned a field the output schema
  does not declare. Output schemas are strict; return only what they name.
- **The fitness test names a file**: an import crosses a module's interface.
  Reach the other module through its package root or `/contracts`, and
  declare it in `dependsOn` and `package.json`.
- **Query strings**: a GET's input arrives as text. Use `z.coerce.number()`
  for numbers and an explicit `"true" | "false"` transform for booleans,
  never `z.coerce.boolean()`.
