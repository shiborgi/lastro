/** An in-memory sales port and a test host over core and sales. */
import type { CoreApi } from "@lastro/core";
import { coreTestHost } from "@lastro/core/testing";
import {
  type CatalogTable,
  type ModuleDefinition,
  defineModule,
} from "@lastro/kernel";
import { type SalesApi, createSales } from "./application/module";
import type { SalesPort } from "./application/port";
import { salesOperations } from "./contracts";
import type { SaleLine, SalesDay } from "./domain/day";
import type {
  SaleConsumer,
  SaleFile,
  SaleMovement,
  SaleMovementDescriptor,
  SaleMovementLink,
} from "./domain/movements";

function memoryTable<T extends { id: string; bookId: string }, Filter>(
  matches: (row: T, filter: Filter) => boolean = () => true,
): CatalogTable<T, Filter> {
  const rows: T[] = [];
  let sequence = 0;
  const find = (bookId: string, id: string) =>
    rows.find((row) => row.bookId === bookId && row.id === id) ?? null;
  return {
    list: async (_h, bookId, filter) =>
      rows.filter(
        (row) => row.bookId === bookId && (!filter || matches(row, filter)),
      ),
    get: async (_h, bookId, id) => find(bookId, id),
    async insert(_h, bookId, input) {
      const row = { ...input, id: String(++sequence), bookId } as T;
      rows.push(row);
      return row;
    },
    async update(_h, bookId, id, patch) {
      const row = find(bookId, id);
      if (!row) return null;
      for (const [key, value] of Object.entries(patch))
        if (value !== undefined) (row as Record<string, unknown>)[key] = value;
      return row;
    },
    async remove(_h, bookId, id) {
      const row = find(bookId, id);
      if (!row) return false;
      rows.splice(rows.indexOf(row), 1);
      return true;
    },
  };
}

/** No database rules apply here: triggers and checks are integration-tested. */
export function memorySalesPort(): SalesPort {
  let lines: SaleLine[] = [];
  const consumers: SaleConsumer[] = [];
  const files: SaleFile[] = [];
  const descriptors: SaleMovementDescriptor[] = [];
  const movements: SaleMovement[] = [];
  let links: SaleMovementLink[] = [];
  let sequence = 0;
  const next = () => String(++sequence);
  const same = (a: Date, b: Date) => a.getTime() === b.getTime();
  const within = (date: Date, range: { from?: Date; to?: Date }) =>
    (!range.from || date >= range.from) && (!range.to || date <= range.to);
  const newestFirst = <T extends { id: string }>(
    rows: T[],
    query: { after?: string; limit: number },
  ) =>
    rows
      .filter((row) => !query.after || Number(row.id) < Number(query.after))
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, query.limit)
      .map((row) => ({ ...row }));
  return {
    productCategories: memoryTable(),
    products: memoryTable(
      (row, filter) =>
        (!filter.productCategoryId ||
          row.productCategoryId === filter.productCategoryId) &&
        (filter.active === undefined || row.active === filter.active),
    ),
    lines: {
      async insert(_h, bookId, input) {
        const row = { ...input, id: next(), bookId };
        lines.push(row);
        return { ...row };
      },
      async remove(_h, bookId, id) {
        lines = lines.filter(
          (line) => !(line.bookId === bookId && line.id === id),
        );
      },
      list: async (_h, bookId, query) =>
        lines.filter(
          (line) =>
            line.bookId === bookId &&
            (!query.businessDate ||
              same(line.businessDate, query.businessDate)) &&
            within(line.businessDate, query),
        ),
      async days(_h, bookId, range) {
        const seen = new Map<number, SalesDay>();
        for (const line of lines)
          if (line.bookId === bookId && within(line.businessDate, range))
            seen.set(line.businessDate.getTime(), {
              bookId,
              businessDate: line.businessDate,
              currency: line.currency,
            });
        return [...seen.values()].sort(
          (a, b) => a.businessDate.getTime() - b.businessDate.getTime(),
        );
      },
    },
    saleConsumers: {
      get: async (_h, bookId, movementType) =>
        consumers.find(
          (each) =>
            each.bookId === bookId && each.movementType === movementType,
        ) ?? null,
      async set(_h, bookId, input) {
        const known = consumers.find(
          (each) =>
            each.bookId === bookId && each.movementType === input.movementType,
        );
        if (known) {
          Object.assign(known, input, { setAt: new Date() });
          return { ...known };
        }
        const row = { ...input, bookId, setAt: new Date() };
        consumers.push(row);
        return { ...row };
      },
      list: async (_h, bookId) =>
        consumers.filter((each) => each.bookId === bookId),
    },
    saleFiles: {
      findByContent: async (_h, bookId, query) =>
        files.find(
          (each) =>
            each.bookId === bookId &&
            each.importerFingerprint === query.importerFingerprint &&
            each.contentSha256 === query.contentSha256,
        ) ?? null,
      async insert(_h, bookId, input) {
        const row = { ...input, id: next(), bookId, importedAt: new Date() };
        files.push(row);
        return { ...row };
      },
      list: async (_h, bookId, query) =>
        newestFirst(
          files.filter((each) => each.bookId === bookId),
          query,
        ),
    },
    saleMovementDescriptors: {
      async ensure(_h, bookId, input) {
        let row = descriptors.find(
          (each) =>
            each.bookId === bookId &&
            each.descriptorKey === input.descriptorKey,
        );
        if (!row) {
          row = { ...input, bookId, productId: null };
          descriptors.push(row);
        }
        return { ...row };
      },
      get: async (_h, bookId, key) => {
        const row = descriptors.find(
          (each) => each.bookId === bookId && each.descriptorKey === key,
        );
        return row ? { ...row } : null;
      },
      list: async (_h, bookId, query) =>
        descriptors
          .filter(
            (each) =>
              each.bookId === bookId &&
              (query.classified === undefined ||
                (each.productId !== null) === query.classified),
          )
          .map((each) => ({ ...each })),
      async classify(_h, bookId, key, productId) {
        const row = descriptors.find(
          (each) => each.bookId === bookId && each.descriptorKey === key,
        );
        if (!row) throw new Error(`sale descriptor ${key} not found`);
        row.productId = productId;
        return { ...row };
      },
    },
    saleMovements: {
      findByExternalIds: async (_h, bookId, ids) =>
        movements
          .filter(
            (each) => each.bookId === bookId && ids.includes(each.externalId),
          )
          .map((each) => ({ ...each })),
      async insert(_h, bookId, input) {
        const row: SaleMovement = {
          ...input,
          id: next(),
          bookId,
          status: "PENDING",
          ignoreReason: null,
        };
        movements.push(row);
        return { ...row };
      },
      get: async (_h, bookId, id) => {
        const row = movements.find(
          (each) => each.bookId === bookId && each.id === id,
        );
        return row ? { ...row } : null;
      },
      list: async (_h, bookId, query) =>
        newestFirst(
          movements.filter(
            (each) =>
              each.bookId === bookId &&
              (!query.status || each.status === query.status) &&
              (!query.descriptorKey ||
                each.descriptorKey === query.descriptorKey) &&
              (!query.businessDate ||
                same(each.businessDate, query.businessDate)),
          ),
          query,
        ),
      async update(_h, bookId, id, patch) {
        const row = movements.find(
          (each) => each.bookId === bookId && each.id === id,
        );
        if (!row) throw new Error(`sale movement ${id} not found`);
        Object.assign(row, patch);
        return { ...row };
      },
      lock: async () => {},
    },
    saleLinks: {
      async insert(_h, bookId, input) {
        const row = { ...input, bookId };
        links.push(row);
        return { ...row };
      },
      list: async (_h, bookId, query) =>
        links
          .filter(
            (each) =>
              each.bookId === bookId &&
              (!query.movementId || each.movementId === query.movementId) &&
              (!query.externalKey || each.externalKey === query.externalKey) &&
              (!query.saleKey || each.saleKey === query.saleKey) &&
              (!query.saleId || each.saleId === query.saleId),
          )
          .map((each) => ({ ...each })),
      async removeOfMovement(_h, bookId, movementId) {
        links = links.filter(
          (each) => !(each.bookId === bookId && each.movementId === movementId),
        );
      },
    },
  };
}

/** The sales module over a memory port, for any test host. */
export function salesTestModule(
  port: SalesPort = memorySalesPort(),
): ModuleDefinition<null> {
  return defineModule<null, { core: CoreApi }, SalesApi>({
    id: "sales",
    dependsOn: ["core"],
    operations: salesOperations,
    create: () => createSales(port),
  });
}

/** Core and sales (and any module given) over memory, inside the real envelope. */
export function salesTestHost(
  port: SalesPort = memorySalesPort(),
  extra: readonly ModuleDefinition<null>[] = [],
) {
  return coreTestHost([salesTestModule(port), ...extra]);
}
