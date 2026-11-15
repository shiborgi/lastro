/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { ExecutionContext } from "./context";
import { type CrudStore, bindCrud, defineCrudOperations } from "./crud";
import { UnauthorizedError } from "./errors";
import { composeModules, defineModule } from "./module";
import type { AuditEntry } from "./operation";

type Tag = { id: string; name: string; weight: bigint | null };

const operations = defineCrudOperations({
  module: "tags",
  name: "Tag",
  plural: "Tags",
  path: "/tags",
  tool: "tag",
  tools: "tags",
  resource: z
    .object({ id: z.string(), name: z.string(), weight: z.string().nullable() })
    .strict(),
  create: z.object({ name: z.string().min(1) }).strict(),
  update: z.object({ name: z.string().min(1).optional() }),
  filter: z.object({ name: z.string().optional() }),
  describe: {
    list: "List tags.",
    create: "Create a tag.",
    update: "Rename a tag.",
    remove: "Delete a tag.",
  },
});

function setup() {
  const tags: Tag[] = [];
  const audits: AuditEntry[] = [];
  const store: CrudStore<
    Tag,
    { name: string },
    { name?: string },
    { name?: string }
  > = {
    list: async (_scope, filter) =>
      tags.filter((tag) => !filter.name || tag.name === filter.name),
    async create(_scope, input) {
      const tag = { id: String(tags.length + 1), name: input.name, weight: 5n };
      tags.push(tag);
      return tag;
    },
    async update(_scope, id, patch) {
      const tag = tags.find((each) => each.id === id);
      if (!tag) return null;
      Object.assign(tag, patch);
      return tag;
    },
    async remove(_scope, id) {
      const index = tags.findIndex((each) => each.id === id);
      if (index === -1) return false;
      tags.splice(index, 1);
      return true;
    },
  };
  const host = composeModules({
    modules: [
      defineModule({
        id: "tags",
        dependsOn: [],
        operations: Object.values(operations),
        create: () => ({
          api: {},
          handlers: bindCrud(operations, store, "tag"),
        }),
      }),
    ],
    resources: null,
    envelope: () => ({
      run: (_descriptor, context, work) =>
        work({ context, handle: null, audit: (entry) => audits.push(entry) }),
    }),
  });
  const context: ExecutionContext = {
    actorId: "u",
    bookId: "1",
    role: "EDITOR",
    source: "API",
    correlationId: "c",
  };
  return {
    host,
    audits,
    run: (id: string, input: unknown) => host.execute(id, context, input),
  };
}

describe("crud operations", () => {
  test("declare the four routes and tools of a resource", () => {
    expect(
      Object.values(operations).map((o) => [
        o.id,
        o.access,
        o.destructive,
        `${o.http.method} ${o.http.path}`,
        o.mcp.name,
      ]),
    ).toEqual([
      ["tags.listTags", "read", false, "GET /tags", "list_tags"],
      ["tags.createTag", "write", false, "POST /tags", "create_tag"],
      ["tags.updateTag", "write", false, "PATCH /tags/:id", "update_tag"],
      ["tags.deleteTag", "write", true, "DELETE /tags/:id", "delete_tag"],
    ]);
  });

  test("create, list, update and delete, each write audited", async () => {
    const { run, audits } = setup();
    const created = await run("tags.createTag", { name: "a" });
    expect(created).toEqual({ id: "1", name: "a", weight: "5" });
    expect(await run("tags.listTags", { name: "a" })).toEqual({
      items: [created],
    });
    expect(await run("tags.listTags", { name: "z" })).toEqual({ items: [] });
    expect(await run("tags.updateTag", { id: "1", name: "b" })).toMatchObject({
      name: "b",
    });
    expect(await run("tags.deleteTag", { id: "1" })).toEqual({
      id: "1",
      deleted: true,
    });
    expect(audits).toEqual([
      {
        action: "tag.created",
        resourceType: "tag",
        resourceId: "1",
        payload: { name: "a" },
      },
      {
        action: "tag.updated",
        resourceType: "tag",
        resourceId: "1",
        payload: { name: "b" },
      },
      { action: "tag.deleted", resourceType: "tag", resourceId: "1" },
    ]);
  });

  test("an update names at least one field, and unknown fields are refused", async () => {
    const { run } = setup();
    await run("tags.createTag", { name: "a" });
    await expect(run("tags.updateTag", { id: "1" })).rejects.toThrow(
      "at least one field must be provided",
    );
    await expect(
      run("tags.updateTag", { id: "1", color: "red" }),
    ).rejects.toThrow();
    await expect(run("tags.listTags", { color: "red" })).rejects.toThrow();
  });

  test("a record the Book does not have is one answer for update and delete", async () => {
    const { run, audits } = setup();
    await expect(run("tags.updateTag", { id: "9", name: "b" })).rejects.toThrow(
      UnauthorizedError,
    );
    await expect(run("tags.deleteTag", { id: "9" })).rejects.toThrow(
      UnauthorizedError,
    );
    expect(audits).toEqual([]);
  });
});
