/**
 * The four operations of a plain catalog resource, declared and bound once.
 *
 * Listing, creating, changing and removing a named record is the same shape
 * for every catalog, so it is written here and not per resource: the routes,
 * tool names, audit actions and "not found" answer cannot differ between two
 * catalogs by accident.
 */
import { z } from "zod";
import { UnauthorizedError } from "./errors";
import {
  type BoundOperation,
  type OperationDescriptor,
  type Scope,
  bind,
  defineOperation,
} from "./operation";
import { Id, toWire } from "./wire";

export type CrudOperations = {
  list: OperationDescriptor;
  create: OperationDescriptor;
  update: OperationDescriptor;
  remove: OperationDescriptor;
};

export function defineCrudOperations(spec: {
  /** The owning module's id. */
  module: string;
  /** Singular and plural in PascalCase: `Institution`, `Institutions`. */
  name: string;
  plural: string;
  /** Collection path under the Book: `/institutions`. */
  path: string;
  /** Singular and plural in snake_case: `institution`, `institutions`. */
  tool: string;
  tools: string;
  resource: z.ZodType;
  /** The body of a create. */
  create: z.ZodType;
  /** The changeable fields, each optional; an update names at least one. */
  update: z.ZodObject;
  /** Optional list filter fields. */
  filter?: z.ZodObject;
  describe: { list: string; create: string; update: string; remove: string };
}): CrudOperations {
  const { module, name, plural, path, tool, tools, describe } = spec;
  return {
    list: defineOperation({
      id: `${module}.list${plural}`,
      access: "read",
      input: (spec.filter ?? z.object({})).strict(),
      output: z.object({ items: z.array(spec.resource) }).strict(),
      http: { method: "GET", path },
      mcp: { name: `list_${tools}`, description: describe.list },
    }),
    create: defineOperation({
      id: `${module}.create${name}`,
      access: "write",
      input: spec.create,
      output: spec.resource,
      http: { method: "POST", path },
      mcp: { name: `create_${tool}`, description: describe.create },
    }),
    update: defineOperation({
      id: `${module}.update${name}`,
      access: "write",
      input: spec.update
        .extend({ id: Id })
        .strict()
        .refine(
          (value) =>
            Object.entries(value).some(
              ([key, member]) => key !== "id" && member !== undefined,
            ),
          "at least one field must be provided",
        ),
      output: spec.resource,
      http: { method: "PATCH", path: `${path}/:id` },
      mcp: { name: `update_${tool}`, description: describe.update },
    }),
    remove: defineOperation({
      id: `${module}.delete${name}`,
      access: "write",
      destructive: true,
      input: z.object({ id: Id }).strict(),
      output: z.object({ id: Id, deleted: z.literal(true) }).strict(),
      http: { method: "DELETE", path: `${path}/:id` },
      mcp: { name: `delete_${tool}`, description: describe.remove },
    }),
  };
}

/** What a catalog resource's use cases answer, inside the caller's scope. */
export type CrudStore<
  T extends { id: string },
  Create = unknown,
  Patch = unknown,
  Filter = unknown,
> = {
  list(scope: Scope, filter: Filter): Promise<T[]>;
  create(scope: Scope, input: Create): Promise<T>;
  /** Null when the Book has no such record. */
  update(scope: Scope, id: string, patch: Patch): Promise<T | null>;
  /** False when the Book has no such record. */
  remove(scope: Scope, id: string): Promise<boolean>;
};

/**
 * Handlers for the four operations. `resourceType` names the record in the
 * audit trail: `<resourceType>.created`, `.updated`, `.deleted`.
 */
export function bindCrud<T extends { id: string }, Create, Patch, Filter>(
  operations: CrudOperations,
  store: CrudStore<T, Create, Patch, Filter>,
  resourceType: string,
): BoundOperation[] {
  const payload = (value: unknown) => toWire(value) as Record<string, unknown>;
  return [
    bind(operations.list, async ({ scope, input }) => ({
      items: await store.list(scope as Scope, input as Filter),
    })),
    bind(operations.create, async ({ scope, input }) => {
      const created = await store.create(scope as Scope, input as Create);
      scope.audit({
        action: `${resourceType}.created`,
        resourceType,
        resourceId: created.id,
        payload: payload(input),
      });
      return created;
    }),
    bind(operations.update, async ({ scope, input }) => {
      const { id, ...patch } = input as { id: string };
      const updated = await store.update(scope as Scope, id, patch as Patch);
      // Another Book's record reads the same as one that does not exist.
      if (!updated) throw new UnauthorizedError();
      scope.audit({
        action: `${resourceType}.updated`,
        resourceType,
        resourceId: id,
        payload: payload(patch),
      });
      return updated;
    }),
    bind(operations.remove, async ({ scope, input }) => {
      const { id } = input as { id: string };
      if (!(await store.remove(scope as Scope, id)))
        throw new UnauthorizedError();
      scope.audit({
        action: `${resourceType}.deleted`,
        resourceType,
        resourceId: id,
      });
      return { id, deleted: true };
    }),
  ];
}

/**
 * The port behind a CRUD resource: one Book-scoped table. Each module's
 * adapter implements it over its own tables.
 */
export type CatalogTable<T, Filter = Record<string, never>> = {
  list(handle: unknown, bookId: string, filter?: Filter): Promise<T[]>;
  get(handle: unknown, bookId: string, id: string): Promise<T | null>;
  insert(
    handle: unknown,
    bookId: string,
    input: Omit<T, "id" | "bookId">,
  ): Promise<T>;
  /** Null when the Book has no such record. Only the named fields change. */
  update(
    handle: unknown,
    bookId: string,
    id: string,
    patch: Partial<Omit<T, "id" | "bookId">>,
  ): Promise<T | null>;
  /** False when the Book has no such record. */
  remove(handle: unknown, bookId: string, id: string): Promise<boolean>;
};
