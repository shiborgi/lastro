import { z } from "zod";

export const Id = z.string().trim().min(1);
export const MinorUnit = z
  .string()
  .regex(/^\d+$/, "must be a decimal minor-unit string");
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
    accountId: Id,
    partyId: Id,
    expenseCategoryId: Id,
    amountMinor: MinorUnit,
    currency: Currency,
    installmentNumber: z.number().int().min(1).optional(),
    installmentCount: z.number().int().min(1).optional(),
    occurredAt: IsoDate.optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.installmentNumber === undefined &&
        value.installmentCount === undefined) ||
      (value.installmentNumber ?? 1) <= (value.installmentCount ?? 1),
    "installmentNumber must not exceed installmentCount",
  );

export const CreatePayment = z
  .object({
    accountId: Id,
    partyId: Id.nullable().optional(),
    amountMinor: MinorUnit,
    currency: Currency,
    occurredAt: IsoDate.optional(),
  })
  .strict();

export const CreateExpenseSettlement = z
  .object({
    expenseId: Id,
    paymentId: Id,
    amountMinor: MinorUnit,
    currency: Currency,
  })
  .strict();

export const VoidExpenseSettlement = z
  .object({ voidReason: z.string().trim().min(1).max(500).optional() })
  .strict();

export const CreateRevenue = z
  .object({
    accountId: Id,
    partyId: Id,
    revenueCategoryId: Id,
    amountMinor: MinorUnit,
    currency: Currency,
    occurredAt: IsoDate.optional(),
  })
  .strict();

export const CreateReceipt = z
  .object({
    accountId: Id,
    partyId: Id.nullable().optional(),
    amountMinor: MinorUnit,
    currency: Currency,
    occurredAt: IsoDate.optional(),
  })
  .strict();

export const CreateRevenueSettlement = z
  .object({
    revenueId: Id,
    receiptId: Id,
    amountMinor: MinorUnit,
    currency: Currency,
  })
  .strict();

export const VoidRevenueSettlement = z
  .object({ voidReason: z.string().trim().min(1).max(500).optional() })
  .strict();

export const CreateTransfer = z
  .object({
    sourceAccountId: Id,
    destinationAccountId: Id,
    amountMinor: MinorUnit,
    currency: Currency,
  })
  .strict();

export const FinancialResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id.optional(),
    partyId: Id.nullable().optional(),
    expenseCategoryId: Id.optional(),
    revenueCategoryId: Id.optional(),
    expenseId: Id.optional(),
    paymentId: Id.optional(),
    revenueId: Id.optional(),
    receiptId: Id.optional(),
    amountMinor: MinorUnit,
    currency: Currency,
    occurredAt: IsoDate.optional(),
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
    outstandingMinor: MinorUnit,
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
          outstandingMinor: MinorUnit,
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export const RevenuePositionItem = z
  .object({
    revenue: FinancialResource,
    outstandingMinor: MinorUnit,
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
          outstandingMinor: MinorUnit,
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
    sourcePaymentId: Id,
    destinationReceiptId: Id,
    correlationId: Id,
    amountMinor: MinorUnit,
    currency: Currency,
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CashFlowBucket = z
  .object({
    currency: Currency,
    amountMinor: MinorUnit,
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
