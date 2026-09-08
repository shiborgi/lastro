import { z } from "zod";

export const Id = z.string().trim().min(1);
export const Amount = z
  .string()
  .regex(/^\d+$/, "must be a decimal amount string");
export const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "must be a three-letter uppercase currency code");
export const IsoDate = z.string().datetime();

export const CursorPage = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const CreateExpense = z
  .object({
    key: Id,
    referenceMonth: IsoDate,
    partyId: Id,
    categoryId: Id,
    amount: Amount,
    currency: Currency,
    occurredAt: IsoDate.optional(),
  })
  .strict();

export const CreatePayment = z
  .object({
    accountId: Id,
    referenceMonth: IsoDate,
    currency: Currency,
    dueAt: IsoDate,
    paidAt: IsoDate.optional(),
  })
  .strict();

export const CreateExpenseSettlement = z
  .object({
    expenseId: Id,
    paymentId: Id,
    amount: Amount,
    currency: Currency,
    installmentNumber: z.number().int().min(1),
    installmentCount: z.number().int().min(1),
  })
  .strict()
  .refine(
    (value) => value.installmentNumber <= value.installmentCount,
    "installmentNumber must not exceed installmentCount",
  );

export const VoidExpenseSettlement = z
  .object({ voidReason: z.string().trim().min(1).max(500).optional() })
  .strict();

export const CreateRevenue = z
  .object({
    key: Id,
    referenceMonth: IsoDate,
    partyId: Id,
    categoryId: Id,
    amount: Amount,
    currency: Currency,
    occurredAt: IsoDate.optional(),
  })
  .strict();

export const CreateReceipt = z
  .object({
    accountId: Id,
    referenceMonth: IsoDate,
    amount: Amount,
    currency: Currency,
    dueAt: IsoDate,
    paidAt: IsoDate.optional(),
  })
  .strict();

export const CreateRevenueSettlement = z
  .object({
    revenueId: Id,
    receiptId: Id,
    amount: Amount,
    currency: Currency,
  })
  .strict();

export const VoidRevenueSettlement = z
  .object({ voidReason: z.string().trim().min(1).max(500).optional() })
  .strict();

export const CreateTransfer = z
  .object({
    key: Id,
    referenceMonth: IsoDate,
    sourceAccountId: Id,
    destinationAccountId: Id,
    amount: Amount,
    currency: Currency,
  })
  .strict();

export const FinancialResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id.optional(),
    referenceMonth: IsoDate.optional(),
    accountId: Id.optional(),
    partyId: Id.nullable().optional(),
    categoryId: Id.optional(),
    expenseId: Id.optional(),
    paymentId: Id.optional(),
    revenueId: Id.optional(),
    receiptId: Id.optional(),
    amount: Amount,
    currency: Currency,
    occurredAt: IsoDate.optional(),
    dueAt: IsoDate.optional(),
    paidAt: IsoDate.nullable().optional(),
    installmentNumber: z.number().int().min(1).optional(),
    installmentCount: z.number().int().min(1).optional(),
    createdAt: IsoDate.optional(),
    voidedAt: IsoDate.nullable().optional(),
    voidedBy: Id.nullable().optional(),
    voidReason: z.string().nullable().optional(),
  })
  .strict();

export const Page = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({ items: z.array(item), nextCursor: z.string().nullable() })
    .strict();

export const PositionItem = z
  .object({
    expense: FinancialResource,
    outstanding: Amount,
    status: z.enum(["OPEN", "PARTIALLY_SETTLED", "SETTLED"]),
  })
  .strict();

export const BookPosition = z
  .object({
    expenses: Page(PositionItem),
    totals: z.array(
      z
        .object({
          currency: Currency,
          outstanding: Amount,
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export const RevenuePositionItem = z
  .object({
    revenue: FinancialResource,
    outstanding: Amount,
    status: z.enum(["OPEN", "PARTIALLY_SETTLED", "SETTLED"]),
  })
  .strict();

export const RevenuePosition = z
  .object({
    revenues: Page(RevenuePositionItem),
    totals: z.array(
      z
        .object({
          currency: Currency,
          outstanding: Amount,
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export const TransferResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    referenceMonth: IsoDate,
    sourceAccountId: Id,
    destinationAccountId: Id,
    correlationId: Id,
    amount: Amount,
    currency: Currency,
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CashFlowBucket = z
  .object({
    currency: Currency,
    amount: Amount,
    count: z.number().int().nonnegative(),
  })
  .strict();

export const CashFlow = z
  .object({
    inflows: z.array(CashFlowBucket),
    outflows: z.array(CashFlowBucket),
    transfers: z.array(CashFlowBucket),
  })
  .strict();

export const ErrorResponse = z
  .object({
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict();

export type CursorPage = z.infer<typeof CursorPage>;
