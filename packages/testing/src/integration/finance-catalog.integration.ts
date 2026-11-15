/// <reference types="bun-types" />
/*
 * Finance's catalogs through the composed host: the same path the HTTP and
 * MCP adapters take, on the real database with its triggers.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createHost } from "@lastro/host";
import { ForbiddenError, UnauthorizedError, toFailure } from "@lastro/kernel";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
afterAll(() => closeDb(db));

type Row = { id: string } & Record<string, unknown>;

async function book() {
  const seeded = await seedBook(db, ["OWNER", "EDITOR", "VIEWER"]);
  const run = (id: string, input: unknown, context = seeded.as("EDITOR")) =>
    host.execute(`finance.${id}`, context, input);
  const row = async (
    id: string,
    input: unknown,
    context = seeded.as("EDITOR"),
  ) => (await run(id, input, context)) as Row;
  return { ...seeded, run, row };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toFailure(error);
  }
  throw new Error("expected the operation to be refused");
}

describe("finance catalogs on PostgreSQL", () => {
  test("each catalog creates, lists, updates and deletes", async () => {
    const { row, run } = await book();
    const institution = await row("createInstitution", {
      key: "bank",
      name: "Main Bank",
    });
    const account = await row("createAccount", {
      key: "main-account",
      name: "Main account",
      type: "ACCOUNT",
      institutionId: institution.id,
      number: "123456789",
    });
    expect(account).toMatchObject({
      institutionId: institution.id,
      number: "123456789",
    });
    const card = await row("createAccount", {
      key: "card",
      name: "Card",
      type: "CARD",
    });
    const window = await row("createAccountCycle", {
      accountId: card.id,
      referenceMonth: "2026-11-01",
      startsOn: "2026-10-05",
      endsOn: "2026-11-04",
      dueOn: "2026-11-12",
    });
    expect(window).toMatchObject({
      referenceMonth: "2026-11-01",
      endsOn: "2026-11-04",
    });
    const group = await row("createFinancialCategory", {
      name: "Custos",
      kind: "EXPENSE",
    });
    const leaf = await row("createFinancialCategory", {
      name: "Insumos",
      kind: "EXPENSE",
      parentId: group.id,
      role: "MERCHANDISE",
    });
    const supplier = await row("createParty", {
      key: "assai",
      name: "Assaí",
      type: "COMPANY",
    });

    expect(await run("listAccounts", {})).toEqual({ items: [account, card] });
    expect(await run("listFinancialCategories", { kind: "EXPENSE" })).toEqual({
      items: [group, leaf],
    });
    expect(await run("listAccountCycles", { accountId: card.id })).toEqual({
      items: [window],
    });

    expect(
      await row("updateParty", { id: supplier.id, name: "Assaí Atacadista" }),
    ).toMatchObject({ key: "assai", name: "Assaí Atacadista" });
    expect(
      await row("updateAccount", { id: account.id, number: null }),
    ).toMatchObject({
      number: null,
      institutionId: institution.id,
    });
    expect(await run("deleteAccountCycle", { id: window.id })).toEqual({
      id: window.id,
      deleted: true,
    });
  });

  test("a record still referenced cannot be deleted", async () => {
    const { row, run } = await book();
    const institution = await row("createInstitution", {
      key: "nu",
      name: "Second Bank",
    });
    await row("createAccount", {
      key: "nu",
      name: "Second Bank",
      type: "ACCOUNT",
      institutionId: institution.id,
    });
    expect(
      await refusal(run("deleteInstitution", { id: institution.id })),
    ).toEqual({
      status: 409,
      code: "CONFLICT",
      message: "the record is still referenced by another record",
    });
  });

  test("a duplicate key is a conflict, and a create with an idempotency key replays", async () => {
    const { row, run, as } = await book();
    const input = { key: "bank", name: "Bank" };
    const context = as("EDITOR", { idempotencyKey: "create-bank" });
    const first = await row("createInstitution", input, context);
    expect(await run("createInstitution", input, context)).toEqual(first);
    expect(await run("listInstitutions", {})).toEqual({ items: [first] });

    expect(await refusal(run("createInstitution", input))).toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  test("access follows the role, and another Book's record is not found", async () => {
    const mine = await book();
    const theirs = await book();
    const account = await mine.row("createAccount", {
      key: "bank",
      name: "Bank",
      type: "ACCOUNT",
    });

    expect(await mine.run("listAccounts", {}, mine.as("VIEWER"))).toEqual({
      items: [account],
    });
    await expect(
      mine.run("deleteAccount", { id: account.id }, mine.as("VIEWER")),
    ).rejects.toThrow(ForbiddenError);

    expect(await theirs.run("listAccounts", {})).toEqual({ items: [] });
    for (const call of [
      theirs.run("updateAccount", { id: account.id, name: "x" }),
      theirs.run("deleteAccount", { id: account.id }),
      theirs.run("updateAccount", { id: "not-a-number", name: "x" }),
    ]) {
      await expect(call).rejects.toThrow(UnauthorizedError);
    }
  });

  test("every write is audited with the operation that made it", async () => {
    const { row, run, as } = await book();
    const party = await row("createParty", {
      key: "p",
      name: "P",
      type: "PERSON",
    });
    await run("updateParty", { id: party.id, name: "Q" });
    await run("deleteParty", { id: party.id });
    const trail = (await host.execute("core.listAuditEvents", as("OWNER"), {
      resourceId: party.id,
      resourceType: "party",
    })) as { items: { operation: string; action: string; payload: unknown }[] };
    expect(trail.items.map((event) => [event.operation, event.action])).toEqual(
      [
        ["finance.createParty", "party.created"],
        ["finance.updateParty", "party.updated"],
        ["finance.deleteParty", "party.deleted"],
      ],
    );
    expect(trail.items[0]?.payload).toEqual({
      key: "p",
      name: "P",
      type: "PERSON",
    });
  });
});
