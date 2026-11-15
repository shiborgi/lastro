/** An in-memory finance port and test host, for unit tests without PostgreSQL. */
import type { CoreApi } from "@lastro/core";
import { coreTestHost, defaultMembers } from "@lastro/core/testing";
import { type ModuleDefinition, type Role, defineModule } from "@lastro/kernel";
import { type FinanceApi, createFinance } from "./application/module";
import type {
  AccountMovementPort,
  CardPort,
  CatalogTable,
  ExpensePort,
  FinancePort,
  RevenueMovementPort,
  RevenuePort,
} from "./application/port";
import { financeOperations } from "./contracts";
import type {
  AccountMovement,
  AccountMovementDescriptor,
  AccountMovementLink,
  DescriptorRef,
  MovementConsumer,
  MovementFile,
} from "./domain/account-movements";
import type {
  CardDescriptor,
  CardExpenseLink,
  CardMovement,
  CardPaymentLink,
  CardTransferLink,
} from "./domain/cards";
import type { Transfer } from "./domain/records";
import type {
  RevenueMovement,
  RevenueMovementDescriptor,
  RevenueMovementLink,
  RevenueMovementReceipt,
} from "./domain/revenue-movements";

function memoryTable<T extends { id: string; bookId: string }, Filter>(
  matches: (row: T, filter: Filter) => boolean = () => true,
): CatalogTable<T, Filter> {
  const rows: T[] = [];
  let sequence = 0;
  const find = (bookId: string, id: string) =>
    rows.find((row) => row.bookId === bookId && row.id === id);
  return {
    list: async (_handle, bookId, filter) =>
      rows.filter(
        (row) => row.bookId === bookId && (!filter || matches(row, filter)),
      ),
    get: async (_handle, bookId, id) => find(bookId, id) ?? null,
    async insert(_handle, bookId, input) {
      const row = { ...input, id: String(++sequence), bookId } as T;
      rows.push(row);
      return row;
    },
    async update(_handle, bookId, id, patch) {
      const row = find(bookId, id);
      if (!row) return null;
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) (row as Record<string, unknown>)[key] = value;
      }
      return row;
    },
    async remove(_handle, bookId, id) {
      const row = find(bookId, id);
      if (!row) return false;
      rows.splice(rows.indexOf(row), 1);
      return true;
    },
  };
}

type Stored = { id: string; bookId: string };

/* Rows of one table with serial ids, shared by the memory adapters below. */
function memoryRows<T extends Stored>() {
  const rows: T[] = [];
  let sequence = 0;
  return {
    rows,
    insert(bookId: string, input: Omit<T, "id" | "bookId">): T {
      const row = { ...input, id: String(++sequence), bookId } as T;
      rows.push(row);
      return row;
    },
    of: (bookId: string) => rows.filter((row) => row.bookId === bookId),
    find: (bookId: string, id: string) =>
      rows.find((row) => row.bookId === bookId && row.id === id) ?? null,
  };
}

const page = <T extends Stored>(
  rows: T[],
  query: { after?: string; limit: number },
) =>
  rows
    .filter((row) => !query.after || Number(row.id) > Number(query.after))
    .slice(0, query.limit);

/*
 * The expense cycle in memory. It keeps a payment's amount as the database
 * does, so tests read the same numbers; the database's refusals (signs,
 * totals) are covered by the integration suite, not here.
 */
function memoryExpensePort(): ExpensePort {
  type Expense = Awaited<ReturnType<ExpensePort["expenses"]["insert"]>>;
  type Payment = Awaited<ReturnType<ExpensePort["payments"]["insert"]>>;
  type Settlement = Awaited<
    ReturnType<ExpensePort["expenseSettlements"]["insert"]>
  >;
  const expenses = memoryRows<Expense>();
  const payments = memoryRows<Payment>();
  const settlements = memoryRows<Settlement>();
  const refresh = (bookId: string, paymentId: string) => {
    const payment = payments.find(bookId, paymentId);
    if (payment)
      payment.amount = settlements
        .of(bookId)
        .filter((each) => each.paymentId === paymentId && !each.voidedAt)
        .reduce((sum, each) => sum + each.amount, 0n);
  };
  return {
    expenses: {
      insert: async (_h, bookId, input) => expenses.insert(bookId, input),
      get: async (_h, bookId, id) => expenses.find(bookId, id),
      getByKey: async (_h, bookId, key) =>
        expenses.of(bookId).find((each) => each.key === key) ?? null,
      list: async (_h, bookId, query) =>
        page(
          expenses
            .of(bookId)
            .filter(
              (each) =>
                !query.referenceMonth ||
                each.referenceMonth.getTime() ===
                  query.referenceMonth.getTime(),
            ),
          query,
        ),
      listByReferenceMonth: async (_h, bookId, from, to) =>
        expenses
          .of(bookId)
          .filter(
            (each) => each.referenceMonth >= from && each.referenceMonth < to,
          ),
      listPositive: async (_h, bookId) =>
        expenses.of(bookId).filter((each) => each.amount > 0n),
    },
    payments: {
      insert: async (_h, bookId, input) =>
        payments.insert(bookId, { ...input, amount: 0n }),
      get: async (_h, bookId, id) => {
        const payment = payments.find(bookId, id);
        return payment ? { ...payment } : null;
      },
      getByKey: async (_h, bookId, key) => {
        const payment = payments.of(bookId).find((each) => each.key === key);
        return payment ? { ...payment } : null;
      },
      list: async (_h, bookId, query) =>
        page(
          payments
            .of(bookId)
            .filter(
              (each) => !query.accountId || each.accountId === query.accountId,
            ),
          query,
        ),
    },
    expenseSettlements: {
      async insert(_h, bookId, input) {
        const row = settlements.insert(bookId, {
          ...input,
          voidedAt: null,
          voidedBy: null,
          voidReason: null,
        });
        refresh(bookId, row.paymentId);
        return { ...row };
      },
      get: async (_h, bookId, id) => settlements.find(bookId, id),
      list: async (_h, bookId, filter) =>
        settlements
          .of(bookId)
          .filter(
            (each) =>
              (!filter.expenseId || each.expenseId === filter.expenseId) &&
              (!filter.paymentId || each.paymentId === filter.paymentId),
          )
          .map((each) => ({ ...each })),
      async void(_h, bookId, id, by) {
        const row = settlements.find(bookId, id);
        if (!row || row.voidedAt) return null;
        Object.assign(row, { voidedAt: new Date(), ...by });
        refresh(bookId, row.paymentId);
        return { ...row };
      },
    },
    lockSettlementSet: async () => {},
  };
}

/* The revenue cycle in memory, keeping receipt and derived revenue amounts as the triggers do. */
function memoryRevenuePort(): RevenuePort {
  type Revenue = Awaited<ReturnType<RevenuePort["revenues"]["insert"]>>;
  type Receipt = Awaited<ReturnType<RevenuePort["receipts"]["insert"]>>;
  type Settlement = Awaited<
    ReturnType<RevenuePort["revenueSettlements"]["insert"]>
  >;
  type Transfer = Awaited<ReturnType<RevenuePort["transfers"]["insert"]>>;
  const revenues = memoryRows<Revenue>();
  const receipts = memoryRows<Receipt>();
  const settlements = memoryRows<Settlement>();
  const transfers = memoryRows<Transfer>();
  const refresh = (bookId: string, row: Settlement) => {
    const active = settlements.of(bookId).filter((each) => !each.voidedAt);
    const receipt = receipts.find(bookId, row.receiptId);
    if (receipt)
      receipt.amount = active
        .filter((each) => each.receiptId === receipt.id)
        .reduce((sum, each) => sum + each.amount, 0n);
  };
  return {
    revenues: {
      insert: async (_h, bookId, input) => ({
        ...revenues.insert(bookId, input),
      }),
      get: async (_h, bookId, id) => {
        const row = revenues.find(bookId, id);
        return row ? { ...row } : null;
      },
      getByKey: async (_h, bookId, key) => {
        const row = revenues.of(bookId).find((each) => each.key === key);
        return row ? { ...row } : null;
      },
      list: async (_h, bookId, query) =>
        page(
          revenues
            .of(bookId)
            .filter(
              (each) =>
                !query.referenceMonth ||
                each.referenceMonth.getTime() ===
                  query.referenceMonth.getTime(),
            ),
          query,
        ),
    },
    receipts: {
      insert: async (_h, bookId, input) => ({
        ...receipts.insert(bookId, {
          ...input,
          amount: 0n,
        }),
      }),
      get: async (_h, bookId, id) => {
        const row = receipts.find(bookId, id);
        return row ? { ...row } : null;
      },
      async setPaid(_h, bookId, id, paid) {
        const row = receipts.find(bookId, id);
        if (row) Object.assign(row, paid);
      },
      list: async (_h, bookId, query) =>
        page(
          receipts
            .of(bookId)
            .filter(
              (each) => !query.accountId || each.accountId === query.accountId,
            ),
          query,
        ),
    },
    revenueSettlements: {
      async insert(_h, bookId, input) {
        const row = settlements.insert(bookId, {
          ...input,
          voidedAt: null,
          voidedBy: null,
          voidReason: null,
        });
        refresh(bookId, row);
        return { ...row };
      },
      get: async (_h, bookId, id) => settlements.find(bookId, id),
      list: async (_h, bookId, filter) =>
        settlements
          .of(bookId)
          .filter(
            (each) =>
              (!filter.revenueId || each.revenueId === filter.revenueId) &&
              (!filter.receiptId || each.receiptId === filter.receiptId),
          )
          .map((each) => ({ ...each })),
      async void(_h, bookId, id, by) {
        const row = settlements.find(bookId, id);
        if (!row || row.voidedAt) return null;
        Object.assign(row, { voidedAt: new Date(), ...by });
        refresh(bookId, row);
        return { ...row };
      },
    },
    lockRevenueSet: async () => {},
    transfers: {
      insert: async (_h, bookId, input) => transfers.insert(bookId, input),
      async remove(_h, bookId, id) {
        const row = transfers.find(bookId, id);
        if (row) transfers.rows.splice(transfers.rows.indexOf(row), 1);
      },
      list: async (_h, bookId, query) =>
        page(
          transfers
            .of(bookId)
            .filter(
              (each) =>
                !query.accountId ||
                each.sourceAccountId === query.accountId ||
                each.destinationAccountId === query.accountId,
            ),
          query,
        ),
    },
  };
}

/* Payment and receipt movements share one id sequence, as in PostgreSQL. */
function memoryAccountMovementPort(): AccountMovementPort {
  type Consumer = MovementConsumer & { id: string };
  const consumers = memoryRows<Consumer>();
  const files = memoryRows<MovementFile>();
  const descriptors = memoryRows<AccountMovementDescriptor & { id: string }>();
  const movements = memoryRows<AccountMovement>();
  const links = memoryRows<AccountMovementLink>();
  const copy = <T>(row: T | null | undefined) => (row ? { ...row } : null);
  const strip = <T extends { id: string }>(row: T) => {
    const { id: _id, ...rest } = row;
    return rest;
  };
  const sameRef = (row: DescriptorRef, ref: DescriptorRef) =>
    row.direction === ref.direction &&
    row.accountId === ref.accountId &&
    row.descriptorKey === ref.descriptorKey;
  const findDescriptor = (bookId: string, ref: DescriptorRef) =>
    descriptors.of(bookId).find((each) => sameRef(each, ref));
  return {
    movementConsumers: {
      get: async (_h, bookId, accountId, movementType) => {
        const row = consumers
          .of(bookId)
          .find(
            (each) =>
              each.accountId === accountId &&
              each.movementType === movementType,
          );
        return row ? strip(row) : null;
      },
      async set(_h, bookId, input) {
        const known = consumers
          .of(bookId)
          .find(
            (each) =>
              each.accountId === input.accountId &&
              each.movementType === input.movementType,
          );
        if (known) {
          Object.assign(known, input, { setAt: new Date() });
          return strip(known);
        }
        return strip(
          consumers.insert(bookId, { ...input, setAt: new Date() } as Omit<
            Consumer,
            "id" | "bookId"
          >),
        );
      },
      list: async (_h, bookId, query) =>
        consumers
          .of(bookId)
          .filter(
            (each) => !query.accountId || each.accountId === query.accountId,
          )
          .map(strip),
    },
    movementFiles: {
      get: async (_h, bookId, id) => copy(files.find(bookId, id)),
      findByContent: async (_h, bookId, query) =>
        copy(
          files
            .of(bookId)
            .find(
              (each) =>
                each.accountId === query.accountId &&
                each.importerFingerprint === query.importerFingerprint &&
                each.contentSha256 === query.contentSha256,
            ),
        ),
      insert: async (_h, bookId, input) => ({
        ...files.insert(bookId, { ...input, importedAt: new Date() }),
      }),
      list: async (_h, bookId, query) =>
        files
          .of(bookId)
          .filter(
            (each) =>
              (!query.accountId || each.accountId === query.accountId) &&
              (!query.after || Number(each.id) < Number(query.after)),
          )
          .reverse()
          .slice(0, query.limit)
          .map((each) => ({ ...each })),
    },
    accountMovementDescriptors: {
      async ensure(_h, bookId, input) {
        const row =
          findDescriptor(bookId, input) ??
          descriptors.insert(bookId, {
            ...input,
            partyId: null,
            financialCategoryId: null,
            counterAccountId: null,
            paymentMethod: null,
            settlementGroup: null,
          });
        return strip(row);
      },
      get: async (_h, bookId, ref) => {
        const row = findDescriptor(bookId, ref);
        return row ? strip(row) : null;
      },
      list: async (_h, bookId, query) =>
        descriptors
          .of(bookId)
          .filter((each) => {
            const classified = Boolean(
              each.partyId || each.financialCategoryId || each.counterAccountId,
            );
            return (
              (!query.accountId || each.accountId === query.accountId) &&
              (!query.direction || each.direction === query.direction) &&
              (query.classified === undefined ||
                query.classified === classified)
            );
          })
          .map(strip),
      async classify(_h, bookId, ref, mapping) {
        const row = findDescriptor(bookId, ref);
        if (!row) throw new Error(`descriptor ${ref.descriptorKey} not found`);
        Object.assign(row, mapping);
        return strip(row);
      },
    },
    accountMovements: {
      findByExternalIds: async (_h, bookId, accountId, ids) =>
        movements
          .of(bookId)
          .filter(
            (each) =>
              each.accountId === accountId && ids.includes(each.externalId),
          )
          .map((each) => ({ ...each })),
      insert: async (_h, bookId, input) => ({
        ...movements.insert(bookId, {
          ...input,
          status: "PENDING",
          ignoreReason: null,
        }),
      }),
      get: async (_h, bookId, id) => copy(movements.find(bookId, id)),
      list: async (_h, bookId, query) =>
        movements
          .of(bookId)
          .filter(
            (each) =>
              (!query.accountId || each.accountId === query.accountId) &&
              (!query.direction || each.direction === query.direction) &&
              (!query.status || each.status === query.status) &&
              (!query.descriptorKey ||
                each.descriptorKey === query.descriptorKey) &&
              (!query.after || Number(each.id) < Number(query.after)),
          )
          .reverse()
          .slice(0, query.limit)
          .map((each) => ({ ...each })),
      async update(_h, bookId, id, patch) {
        const row = movements.find(bookId, id);
        if (!row) throw new Error(`movement ${id} not found`);
        for (const [key, value] of Object.entries(patch))
          if (value !== undefined)
            (row as Record<string, unknown>)[key] = value;
        return { ...row };
      },
      lock: async () => {},
    },
    accountMovementLinks: {
      insert: async (_h, bookId, input) => ({
        ...links.insert(bookId, input),
      }),
      list: async (_h, bookId, query) =>
        links
          .of(bookId)
          .filter(
            (each) =>
              (!query.movementId || each.movementId === query.movementId) &&
              (!query.statementKey ||
                each.statementKey === query.statementKey) &&
              (!query.transferId || each.transferId === query.transferId) &&
              (!query.externalKey || each.externalKey === query.externalKey) &&
              (!query.entryKey ||
                (each.expenseKey ?? each.revenueKey) === query.entryKey) &&
              (!query.cashKey ||
                (each.paymentKey ?? each.receiptKey) === query.cashKey),
          )
          .map((each) => ({ ...each })),
      async removeOfMovement(_h, bookId, movementId) {
        for (const row of links.of(bookId))
          if (row.movementId === movementId)
            links.rows.splice(links.rows.indexOf(row), 1);
      },
    },
  };
}

/* Card evidence in memory: descriptors and links keyed as in PostgreSQL. */
function memoryCardPort(): CardPort {
  type Keyed<T> = T & { id: string };
  const descriptors = memoryRows<Keyed<CardDescriptor>>();
  const movements = memoryRows<CardMovement>();
  const expenses = memoryRows<Keyed<CardExpenseLink>>();
  const payments = memoryRows<Keyed<CardPaymentLink>>();
  const transfers = memoryRows<Keyed<CardTransferLink>>();
  const strip = <T extends { id: string }>(row: T) => {
    const { id: _id, ...rest } = row;
    return rest;
  };
  const descriptor = (bookId: string, accountId: string, key: string) =>
    descriptors
      .of(bookId)
      .find(
        (each) => each.accountId === accountId && each.descriptorKey === key,
      );
  const payment = (bookId: string, accountId: string, key: string) =>
    payments
      .of(bookId)
      .find((each) => each.accountId === accountId && each.paymentKey === key);
  const paymentsOf = async (
    _h: unknown,
    bookId: string,
    accountId: string,
    expenseKey: string,
  ) =>
    payments
      .of(bookId)
      .filter(
        (each) =>
          each.accountId === accountId && each.expenseKey === expenseKey,
      )
      .sort((a, b) => a.installmentNumber - b.installmentNumber)
      .map(strip);
  return {
    cardDescriptors: {
      async ensure(_h, bookId, input) {
        return strip(
          descriptor(bookId, input.accountId, input.descriptorKey) ??
            descriptors.insert(bookId, {
              ...input,
              partyId: null,
              financialCategoryId: null,
              counterAccountId: null,
              paymentMethod: null,
            } as Omit<Keyed<CardDescriptor>, "id" | "bookId">),
        );
      },
      get: async (_h, bookId, accountId, key) => {
        const row = descriptor(bookId, accountId, key);
        return row ? strip(row) : null;
      },
      list: async (_h, bookId, query) =>
        descriptors
          .of(bookId)
          .filter((each) => {
            const classified = Boolean(
              each.partyId || each.financialCategoryId,
            );
            return (
              (!query.accountId || each.accountId === query.accountId) &&
              (query.classified === undefined ||
                query.classified === classified)
            );
          })
          .map(strip),
      async classify(_h, bookId, input) {
        const row = descriptor(bookId, input.accountId, input.descriptorKey);
        if (!row)
          throw new Error(`card descriptor ${input.descriptorKey} not found`);
        Object.assign(row, {
          partyId: input.partyId,
          financialCategoryId: input.financialCategoryId,
          counterAccountId: input.counterAccountId,
          paymentMethod: input.paymentMethod,
        });
        return strip(row);
      },
    },
    cardMovements: {
      findByStatementIds: async (_h, bookId, accountId, ids) =>
        movements
          .of(bookId)
          .filter(
            (each) =>
              each.accountId === accountId && ids.includes(each.statementId),
          )
          .map((each) => ({ ...each })),
      insert: async (_h, bookId, input) => ({
        ...movements.insert(bookId, {
          ...input,
          status: "PENDING",
          ignoreReason: null,
        }),
      }),
      get: async (_h, bookId, id) => {
        const row = movements.find(bookId, id);
        return row ? { ...row } : null;
      },
      list: async (_h, bookId, query) =>
        movements
          .of(bookId)
          .filter(
            (each) =>
              (!query.accountId || each.accountId === query.accountId) &&
              (!query.status || each.status === query.status) &&
              (!query.descriptorKey ||
                each.descriptorKey === query.descriptorKey) &&
              (!query.expenseKey || each.expenseKey === query.expenseKey) &&
              (!query.after || Number(each.id) < Number(query.after)),
          )
          .reverse()
          .slice(0, query.limit)
          .map((each) => ({ ...each })),
      async update(_h, bookId, id, patch) {
        const row = movements.find(bookId, id);
        if (!row) throw new Error(`card movement ${id} not found`);
        for (const [key, value] of Object.entries(patch))
          if (value !== undefined)
            (row as Record<string, unknown>)[key] = value;
        return { ...row };
      },
      lock: async () => {},
    },
    cardLinks: {
      getExpense: async (_h, bookId, accountId, key) => {
        const row = expenses
          .of(bookId)
          .find(
            (each) => each.accountId === accountId && each.expenseKey === key,
          );
        return row ? strip(row) : null;
      },
      insertExpense: async (_h, bookId, input) =>
        strip(
          expenses.insert(
            bookId,
            input as Omit<Keyed<CardExpenseLink>, "id" | "bookId">,
          ),
        ),
      async removeExpense(_h, bookId, accountId, key) {
        for (const table of [payments, expenses] as const)
          for (const row of [...table.of(bookId)])
            if (row.accountId === accountId && row.expenseKey === key)
              (table.rows as (typeof row)[]).splice(
                (table.rows as (typeof row)[]).indexOf(row),
                1,
              );
      },
      insertPayment: async (_h, bookId, input) =>
        strip(
          payments.insert(
            bookId,
            input as Omit<Keyed<CardPaymentLink>, "id" | "bookId">,
          ),
        ),
      getPayment: async (_h, bookId, accountId, key) => {
        const row = payment(bookId, accountId, key);
        return row ? strip(row) : null;
      },
      async setPaymentMovement(_h, bookId, accountId, key, movementId) {
        const row = payment(bookId, accountId, key);
        if (!row) throw new Error(`card payment link ${key} not found`);
        row.movementId = movementId;
        return strip(row);
      },
      paymentsOf,
      insertTransfer: async (_h, bookId, input) =>
        strip(
          transfers.insert(
            bookId,
            input as Omit<Keyed<CardTransferLink>, "id" | "bookId">,
          ),
        ),
      transfers: async (_h, bookId, query) =>
        transfers
          .of(bookId)
          .filter(
            (each) =>
              (!query.movementId || each.movementId === query.movementId) &&
              (!query.statementKey ||
                each.statementKey === query.statementKey) &&
              (!query.transferId || each.transferId === query.transferId),
          )
          .map(strip),
      async removeTransfer(_h, bookId, movementId) {
        for (const row of [...transfers.of(bookId)])
          if (row.movementId === movementId)
            transfers.rows.splice(transfers.rows.indexOf(row), 1);
      },
      async list(_h, bookId, query) {
        const found = expenses
          .of(bookId)
          .filter(
            (each) =>
              (!query.accountId || each.accountId === query.accountId) &&
              (!query.expenseKey || each.expenseKey === query.expenseKey) &&
              (!query.expenseId || each.expenseId === query.expenseId),
          )
          .map(strip);
        const linked = [];
        for (const each of found)
          linked.push(
            ...(await paymentsOf(_h, bookId, each.accountId, each.expenseKey)),
          );
        return { expenses: found, payments: linked };
      },
      lock: async () => {},
    },
  };
}

/* Revenue movement evidence in memory. */
function memoryRevenueMovementPort(): RevenueMovementPort {
  type Keyed<T> = T & { id: string };
  const descriptors = memoryRows<Keyed<RevenueMovementDescriptor>>();
  const movements = memoryRows<RevenueMovement>();
  const links = memoryRows<Keyed<RevenueMovementLink>>();
  const collected = memoryRows<Keyed<RevenueMovementReceipt>>();
  const strip = <T extends { id: string }>(row: T) => {
    const { id: _id, ...rest } = row;
    return rest;
  };
  const descriptor = (bookId: string, accountId: string, key: string) =>
    descriptors
      .of(bookId)
      .find(
        (each) => each.accountId === accountId && each.descriptorKey === key,
      );
  return {
    revenueMovementDescriptors: {
      async ensure(_h, bookId, input) {
        return strip(
          descriptor(bookId, input.accountId, input.descriptorKey) ??
            descriptors.insert(bookId, {
              ...input,
              partyId: null,
              financialCategoryId: null,
              settlementGroup: null,
              settlesMethodKey: null,
              receivedAccountId: null,
            } as Omit<Keyed<RevenueMovementDescriptor>, "id" | "bookId">),
        );
      },
      get: async (_h, bookId, accountId, key) => {
        const row = descriptor(bookId, accountId, key);
        return row ? strip(row) : null;
      },
      list: async (_h, bookId, query) =>
        descriptors
          .of(bookId)
          .filter((each) => {
            const classified = Boolean(
              each.partyId || each.financialCategoryId,
            );
            return (
              (!query.accountId || each.accountId === query.accountId) &&
              (query.classified === undefined ||
                query.classified === classified) &&
              (!query.settlementGroup ||
                each.settlementGroup === query.settlementGroup)
            );
          })
          .map(strip),
      async classify(_h, bookId, input) {
        const row = descriptor(bookId, input.accountId, input.descriptorKey);
        if (!row)
          throw new Error(`descriptor ${input.descriptorKey} not found`);
        Object.assign(row, {
          partyId: input.partyId,
          financialCategoryId: input.financialCategoryId,
          settlementGroup: input.settlementGroup,
          settlesMethodKey: input.settlesMethodKey,
          receivedAccountId: input.receivedAccountId,
        });
        return strip(row);
      },
    },
    revenueMovements: {
      findByExternalIds: async (_h, bookId, accountId, ids) =>
        movements
          .of(bookId)
          .filter(
            (each) =>
              each.accountId === accountId && ids.includes(each.externalId),
          )
          .map((each) => ({ ...each })),
      insert: async (_h, bookId, input) => ({
        ...movements.insert(bookId, {
          ...input,
          status: "PENDING",
          ignoreReason: null,
        }),
      }),
      get: async (_h, bookId, id) => {
        const row = movements.find(bookId, id);
        return row ? { ...row } : null;
      },
      list: async (_h, bookId, query) =>
        movements
          .of(bookId)
          .filter(
            (each) =>
              (!query.accountId || each.accountId === query.accountId) &&
              (!query.status || each.status === query.status) &&
              (!query.methodKey || each.methodKey === query.methodKey) &&
              (!query.occurredOn ||
                each.occurredOn.getTime() === query.occurredOn.getTime()) &&
              (!query.after || Number(each.id) < Number(query.after)),
          )
          .reverse()
          .slice(0, query.limit)
          .map((each) => ({ ...each })),
      async update(_h, bookId, id, patch) {
        const row = movements.find(bookId, id);
        if (!row) throw new Error(`revenue movement ${id} not found`);
        for (const [key, value] of Object.entries(patch))
          if (value !== undefined)
            (row as Record<string, unknown>)[key] = value;
        return { ...row };
      },
      lock: async () => {},
    },
    revenueMovementLinks: {
      insert: async (_h, bookId, input) =>
        strip(
          links.insert(
            bookId,
            input as Omit<Keyed<RevenueMovementLink>, "id" | "bookId">,
          ),
        ),
      list: async (_h, bookId, query) =>
        links
          .of(bookId)
          .filter(
            (each) =>
              (!query.movementId || each.movementId === query.movementId) &&
              (!query.externalKey || each.externalKey === query.externalKey) &&
              (!query.revenueKey || each.revenueKey === query.revenueKey) &&
              (!query.statementId || each.statementId === query.statementId),
          )
          .map(strip),
      async removeOfMovement(_h, bookId, movementId) {
        for (const row of [...links.of(bookId)])
          if (row.movementId === movementId)
            links.rows.splice(links.rows.indexOf(row), 1);
      },
    },
    revenueMovementReceipts: {
      insert: async (_h, bookId, input) =>
        strip(
          collected.insert(
            bookId,
            input as Omit<Keyed<RevenueMovementReceipt>, "id" | "bookId">,
          ),
        ),
      list: async (_h, bookId, query) =>
        collected
          .of(bookId)
          .filter(
            (each) =>
              (!query.movementId || each.movementId === query.movementId) &&
              (!query.receiptId || each.receiptId === query.receiptId),
          )
          .map(strip),
      async removeOfReceipt(_h, bookId, receiptId) {
        for (const row of [...collected.of(bookId)])
          if (row.receiptId === receiptId)
            collected.rows.splice(collected.rows.indexOf(row), 1);
      },
      async removeOfMovement(_h, bookId, movementId) {
        for (const row of [...collected.of(bookId)])
          if (row.movementId === movementId)
            collected.rows.splice(collected.rows.indexOf(row), 1);
      },
    },
  };
}

/** No database rules apply here: triggers and checks are integration-tested. */
export function memoryFinancePort(): FinancePort {
  return {
    ...memoryExpensePort(),
    ...memoryRevenuePort(),
    ...memoryAccountMovementPort(),
    ...memoryCardPort(),
    ...memoryRevenueMovementPort(),
    institutions: memoryTable(),
    accounts: memoryTable(),
    accountCycles: memoryTable(
      (row, filter) => !filter.accountId || row.accountId === filter.accountId,
    ),
    parties: memoryTable(),
    financialCategories: memoryTable(
      (row, filter) => !filter.kind || row.kind === filter.kind,
    ),
  };
}

export function financeTestHost(
  extra: readonly ModuleDefinition<null>[] = [],
  members: Record<string, Role> = defaultMembers,
) {
  return coreTestHost(
    [
      defineModule<null, { core: CoreApi }, FinanceApi>({
        id: "finance",
        dependsOn: ["core"],
        operations: financeOperations,
        create: () => createFinance(memoryFinancePort()),
      }),
      ...extra,
    ],
    members,
  );
}

/**
 * Tests read a transfer or a deposit from both sides at once: these calls
 * answer what each side's tools answer, merged and marked with their side,
 * and send a write to the side its movement is on.
 */
type SideRun = <T>(id: string, input: unknown) => Promise<T>;
type Side = "PAYMENT" | "RECEIPT";
type Item = { id: string } & Record<string, unknown>;

const name = (side: Side) => (side === "PAYMENT" ? "Payment" : "Receipt");

export function accountMovementSides(run: SideRun) {
  async function both(
    op: string,
    order: "newest" | "oldest",
    input: Record<string, unknown> = {},
  ) {
    const { direction, ...rest } = input as { direction?: Side };
    const sides: Side[] = direction ? [direction] : ["PAYMENT", "RECEIPT"];
    const items: Item[] = [];
    for (const side of sides) {
      const answer = await run<{ items: Item[] }>(
        `finance.list${name(side)}${op}`,
        rest,
      );
      items.push(...answer.items.map((each) => ({ ...each, direction: side })));
    }
    if (order === "newest") items.sort((a, b) => Number(b.id) - Number(a.id));
    else items.sort((a, b) => Number(a.id) - Number(b.id));
    return { items };
  }

  /* The side whose tool knows this movement. */
  async function onSide<T>(
    op: string,
    input: { id?: unknown } & Record<string, unknown>,
  ) {
    try {
      return await run<T>(`finance.${op}PaymentMovement`, input);
    } catch (error) {
      if ((error as { code?: string }).code !== "UNAUTHORIZED_OR_NOT_FOUND")
        throw error;
      return run<T>(`finance.${op}ReceiptMovement`, input);
    }
  }

  return {
    list: <T = { items: Item[] }>(input?: unknown) =>
      both(
        "Movements",
        "newest",
        input as Record<string, unknown>,
      ) as Promise<T>,
    descriptors: <T = { items: Item[] }>(input?: unknown) =>
      both(
        "MovementDescriptors",
        "oldest",
        input as Record<string, unknown>,
      ) as Promise<T>,
    links: <T = { items: Item[] }>(input?: unknown) =>
      both(
        "MovementLinks",
        "oldest",
        input as Record<string, unknown>,
      ) as Promise<T>,
    classify: <T = Item>(input: unknown) => {
      const { direction, ...rest } = input as { direction: Side };
      return run<T>(
        `finance.classify${name(direction)}MovementDescriptor`,
        rest,
      );
    },
    post: <T = Item>(input: { id?: unknown } & Record<string, unknown>) =>
      onSide<T>("post", input),
    ignore: <T = Item>(input: { id?: unknown } & Record<string, unknown>) =>
      onSide<T>("ignore", input),
    undo: <T = Item>(input: { id?: unknown } & Record<string, unknown>) =>
      onSide<T>("undo", input),
  };
}
