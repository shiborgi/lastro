/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import * as schema from "./schema";

describe("schema", () => {
  test("books table exposes its identifying columns", () => {
    expect(schema.books.id.name).toBe("id");
    expect(schema.books.name.name).toBe("name");
    expect(schema.books.createdAt.name).toBe("created_at");
  });

  test("book-scoped tables key their unique columns off book_id", () => {
    for (const table of [
      schema.institutions,
      schema.accounts,
      schema.parties,
      schema.expenses,
      schema.revenues,
      schema.transfers,
    ]) {
      expect(table.bookId.name).toBe("book_id");
      expect(table.bookId.notNull).toBe(true);
    }
  });

  test("monetary columns use bigint mode to avoid float rounding", () => {
    for (const table of [
      schema.expenses,
      schema.payments,
      schema.expenseSettlements,
      schema.revenues,
      schema.receipts,
      schema.revenueSettlements,
      schema.transfers,
    ]) {
      expect(table.amount.dataType).toBe("bigint");
    }
  });

  test("expenses default to USD when no currency is supplied", () => {
    expect(schema.expenses.currency.default).toBe("USD");
  });

  test("audit events require the fields the application layer relies on", () => {
    for (const column of [
      schema.auditEvents.actorType,
      schema.auditEvents.actorPrincipal,
      schema.auditEvents.bookId,
      schema.auditEvents.source,
      schema.auditEvents.correlationId,
      schema.auditEvents.action,
      schema.auditEvents.resourceType,
    ]) {
      expect(column.notNull).toBe(true);
    }
  });
});
