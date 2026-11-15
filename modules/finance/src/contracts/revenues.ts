/** The revenue cycle and transfers on the wire. */
import {
  Amount,
  CalendarDate,
  CalendarDateInput,
  Currency,
  CursorPage,
  Id,
  IsoDate,
  Page,
  SignedAmount,
  defineOperation,
} from "@lastro/kernel";
import { z } from "zod";
import { FinancialStatus, PaymentMethod } from "./expenses";

const Note = z.string().trim().min(1).max(500);
const PositiveAmount = Amount.regex(/^0*[1-9]\d*$/, "must be positive");

export const RevenueResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    partyId: Id,
    financialCategoryId: Id,
    name: z.string().nullable(),
    amount: SignedAmount,
    currency: Currency,
    referenceMonth: CalendarDate,
    occurredOn: CalendarDate.nullable(),
    occurredAt: IsoDate.nullable(),
  })
  .strict();
export type RevenueResource = z.infer<typeof RevenueResource>;

export const ReceiptResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id,
    key: z.string().nullable(),
    method: PaymentMethod.nullable(),
    amount: Amount,
    currency: Currency,
    referenceMonth: CalendarDate,
    dueOn: CalendarDate.nullable(),
    dueAt: IsoDate.nullable(),
    paidOn: CalendarDate.nullable(),
    paidAt: IsoDate.nullable(),
  })
  .strict();
export type ReceiptResource = z.infer<typeof ReceiptResource>;

export const RevenueSettlementResource = z
  .object({
    id: Id,
    bookId: Id,
    revenueId: Id,
    receiptId: Id,
    amount: SignedAmount,
    currency: Currency,
    description: z.string().nullable(),
    voidedAt: IsoDate.nullable(),
    voidedBy: z.string().nullable(),
    voidReason: z.string().nullable(),
  })
  .strict();
export type RevenueSettlementResource = z.infer<
  typeof RevenueSettlementResource
>;

export const TransferResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    sourceAccountId: Id,
    destinationAccountId: Id,
    name: z.string().nullable(),
    amount: Amount,
    currency: Currency,
    referenceMonth: CalendarDate,
    occurredOn: CalendarDate.nullable(),
    occurredAt: IsoDate.nullable(),
  })
  .strict();
export type TransferResource = z.infer<typeof TransferResource>;

export const createRevenue = defineOperation({
  id: "finance.createRevenue",
  access: "write",
  input: z
    .object({
      key: Id,
      partyId: Id,
      financialCategoryId: Id,
      name: z.string().trim().min(1).max(200).nullable().optional(),
      amount: PositiveAmount,
      currency: Currency,
      referenceMonth: CalendarDateInput,
      occurredOn: CalendarDate.nullable().optional(),
      occurredAt: IsoDate.nullable().optional(),
    })
    .strict(),
  output: RevenueResource,
  http: { method: "POST", path: "/revenues" },
  mcp: {
    name: "create_revenue",
    description:
      "Record a revenue entered on its own: what the Book earned from a party, in a plain REVENUE financial category. It states its amount, as an expense does; settlements never exceed it (ADR 7). It is not a receipt; settle it into one with settle_revenue. Sales revenue comes from the imports (revenue movements), not here.",
  },
});

export const listRevenues = defineOperation({
  id: "finance.listRevenues",
  access: "read",
  input: CursorPage.extend({
    referenceMonth: CalendarDateInput.optional(),
  }).strict(),
  output: Page(RevenueResource),
  http: { method: "GET", path: "/revenues" },
  mcp: {
    name: "list_revenues",
    description:
      "List revenues in id order, optionally of one competence month. Page with cursor and limit.",
  },
});

export const getRevenue = defineOperation({
  id: "finance.getRevenue",
  access: "read",
  input: z.object({ id: Id }).strict(),
  output: z
    .object({
      revenue: RevenueResource,
      settlements: z.array(RevenueSettlementResource),
      settled: SignedAmount,
      outstanding: SignedAmount,
      status: FinancialStatus,
    })
    .strict(),
  http: { method: "GET", path: "/revenues/:id" },
  mcp: {
    name: "get_revenue",
    description:
      "One revenue with its settlements (voided ones included) and its derived position.",
  },
});

export const createReceipt = defineOperation({
  id: "finance.createReceipt",
  access: "write",
  input: z
    .object({
      accountId: Id,
      key: Id.optional(),
      method: PaymentMethod.optional(),
      currency: Currency,
      referenceMonth: CalendarDateInput,
      dueOn: CalendarDate.optional(),
      dueAt: IsoDate.optional(),
      paidOn: CalendarDate.optional(),
      paidAt: IsoDate.optional(),
    })
    .strict()
    .refine(
      (value) =>
        [value.dueOn, value.dueAt, value.paidOn, value.paidAt].some(
          (each) => each !== undefined,
        ),
      "a receipt needs a due or paid date",
    ),
  output: ReceiptResource,
  http: { method: "POST", path: "/receipts" },
  mcp: {
    name: "create_receipt",
    description:
      "Open a receipt into an account: money that arrives (or will arrive) there. It starts at zero; its amount is the sum of the revenue shares settled into it.",
  },
});

export const listReceipts = defineOperation({
  id: "finance.listReceipts",
  access: "read",
  input: CursorPage.extend({ accountId: Id.optional() }).strict(),
  output: Page(ReceiptResource),
  http: { method: "GET", path: "/receipts" },
  mcp: {
    name: "list_receipts",
    description: "List receipts in id order, optionally of one account.",
  },
});

export const getReceipt = defineOperation({
  id: "finance.getReceipt",
  access: "read",
  input: z.object({ id: Id }).strict(),
  output: z
    .object({
      receipt: ReceiptResource,
      settlements: z.array(RevenueSettlementResource),
    })
    .strict(),
  http: { method: "GET", path: "/receipts/:id" },
  mcp: {
    name: "get_receipt",
    description:
      "One receipt with the revenue settlements it groups, voided ones included.",
  },
});

export const settleRevenue = defineOperation({
  id: "finance.settleRevenue",
  access: "write",
  input: z
    .object({
      revenueId: Id,
      receiptId: Id,
      amount: PositiveAmount,
      description: Note.optional(),
    })
    .strict(),
  output: z
    .object({
      settlement: RevenueSettlementResource,
      receipt: ReceiptResource,
      revenue: RevenueResource,
    })
    .strict(),
  http: { method: "POST", path: "/revenue-settlements" },
  mcp: {
    name: "settle_revenue",
    description:
      "Allocate a share of a revenue entered on its own to a receipt, in the revenue's currency. Shares never exceed what is still open on the revenue.",
  },
});

export const receiveRevenue = defineOperation({
  id: "finance.receiveRevenue",
  access: "write",
  input: z
    .object({
      revenueId: Id,
      accountId: Id,
      amount: PositiveAmount,
      method: PaymentMethod.optional(),
      paidOn: CalendarDate.optional(),
      paidAt: IsoDate.optional(),
    })
    .strict()
    .refine(
      (value) => value.paidOn !== undefined || value.paidAt !== undefined,
      "receiving needs paidOn or paidAt",
    ),
  output: settleRevenue.output,
  http: { method: "POST", path: "/revenues/:revenueId/receive" },
  mcp: {
    name: "receive_revenue",
    description:
      "Receive a share of one revenue entered on its own now: opens a received receipt into the account and settles the share into it, in one step. Use settle_revenue to add the revenue to an existing receipt.",
  },
});

export const voidRevenueSettlement = defineOperation({
  id: "finance.voidRevenueSettlement",
  access: "write",
  destructive: true,
  input: z.object({ id: Id, voidReason: Note.optional() }).strict(),
  output: RevenueSettlementResource,
  http: { method: "POST", path: "/revenue-settlements/:id/void" },
  mcp: {
    name: "void_revenue_settlement",
    description:
      "Void one revenue settlement, reducing its receipt. The settlement remains in the history, marked voided.",
  },
});

export const createTransfer = defineOperation({
  id: "finance.createTransfer",
  access: "write",
  input: z
    .object({
      key: Id,
      sourceAccountId: Id,
      destinationAccountId: Id,
      name: z.string().trim().min(1).max(200).nullable().optional(),
      amount: PositiveAmount,
      currency: Currency,
      referenceMonth: CalendarDateInput,
      occurredOn: CalendarDate.nullable().optional(),
      occurredAt: IsoDate.nullable().optional(),
    })
    .strict()
    .refine(
      (value) => value.sourceAccountId !== value.destinationAccountId,
      "a transfer moves money between two different accounts",
    ),
  output: TransferResource,
  http: { method: "POST", path: "/transfers" },
  mcp: {
    name: "create_transfer",
    description:
      "Record money moving between two accounts the Book controls: one event, never an expense and a revenue. `key` is a stable handle you choose.",
  },
});

export const listTransfers = defineOperation({
  id: "finance.listTransfers",
  access: "read",
  input: CursorPage.extend({ accountId: Id.optional() }).strict(),
  output: Page(TransferResource),
  http: { method: "GET", path: "/transfers" },
  mcp: {
    name: "list_transfers",
    description:
      "List transfers in id order, optionally those that leave or reach one account.",
  },
});

export const revenueOperations = [
  createRevenue,
  listRevenues,
  getRevenue,
  createReceipt,
  listReceipts,
  getReceipt,
  settleRevenue,
  receiveRevenue,
  voidRevenueSettlement,
  createTransfer,
  listTransfers,
] as const;
