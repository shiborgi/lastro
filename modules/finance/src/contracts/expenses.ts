/** The expense cycle on the wire: expenses, payments and their settlements. */
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

export const PaymentMethod = z.enum([
  "PIX",
  "BOLETO",
  "TRANSFER",
  "DEBIT_CARD",
  "CREDIT_CARD",
]);
export const FinancialStatus = z.enum(["OPEN", "PARTIALLY_SETTLED", "SETTLED"]);
const Note = z.string().trim().min(1).max(500);
const PositiveAmount = Amount.regex(/^0*[1-9]\d*$/, "must be positive");

export const ExpenseResource = z
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
export type ExpenseResource = z.infer<typeof ExpenseResource>;

export const PaymentResource = z
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
export type PaymentResource = z.infer<typeof PaymentResource>;

export const ExpenseSettlementResource = z
  .object({
    id: Id,
    bookId: Id,
    expenseId: Id,
    paymentId: Id,
    amount: SignedAmount,
    currency: Currency,
    installmentNumber: z.number().int(),
    installmentCount: z.number().int(),
    description: z.string().nullable(),
    voidedAt: IsoDate.nullable(),
    voidedBy: z.string().nullable(),
    voidReason: z.string().nullable(),
  })
  .strict();
export type ExpenseSettlementResource = z.infer<
  typeof ExpenseSettlementResource
>;

const Position = {
  settled: SignedAmount,
  outstanding: SignedAmount,
  status: FinancialStatus,
};

export const ExpenseDetail = z
  .object({
    expense: ExpenseResource,
    settlements: z.array(ExpenseSettlementResource),
    ...Position,
  })
  .strict();

export const PaymentDetail = z
  .object({
    payment: PaymentResource,
    settlements: z.array(ExpenseSettlementResource),
  })
  .strict();

/* The share being paid and, optionally, the discount obtained on it (ADR 6). */
const Discount = z
  .object({
    amount: PositiveAmount,
    /** An EXPENSE category with the DEDUCTION role, its own or its group's. */
    financialCategoryId: Id,
  })
  .strict();

const Dates = {
  dueOn: CalendarDate.optional(),
  dueAt: IsoDate.optional(),
  paidOn: CalendarDate.optional(),
  paidAt: IsoDate.optional(),
};

export const createExpense = defineOperation({
  id: "finance.createExpense",
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
  output: ExpenseResource,
  http: { method: "POST", path: "/expenses" },
  mcp: {
    name: "create_expense",
    description:
      "Record an expense: what the Book owes a party, in an EXPENSE category. It is not a payment; pay it with pay_expense or settle it into an existing payment with settle_expense. `key` is a stable handle you choose, unique in the Book. `referenceMonth` is the competence month (any day of it).",
  },
});

export const listExpenses = defineOperation({
  id: "finance.listExpenses",
  access: "read",
  input: CursorPage.extend({
    referenceMonth: CalendarDateInput.optional(),
  }).strict(),
  output: Page(ExpenseResource),
  http: { method: "GET", path: "/expenses" },
  mcp: {
    name: "list_expenses",
    description:
      "List expenses in id order, optionally of one competence month. Page with cursor and limit.",
  },
});

export const getExpense = defineOperation({
  id: "finance.getExpense",
  access: "read",
  input: z.object({ id: Id }).strict(),
  output: ExpenseDetail,
  http: { method: "GET", path: "/expenses/:id" },
  mcp: {
    name: "get_expense",
    description:
      "One expense with its settlements (voided ones included) and its derived position: settled, outstanding and status.",
  },
});

export const listOpenExpenses = defineOperation({
  id: "finance.listOpenExpenses",
  access: "read",
  input: z.object({}).strict(),
  output: z
    .object({
      items: z.array(
        z.object({ expense: ExpenseResource, ...Position }).strict(),
      ),
      totals: z.array(
        z
          .object({
            currency: Currency,
            outstanding: Amount,
            count: z.number().int(),
          })
          .strict(),
      ),
    })
    .strict(),
  http: { method: "GET", path: "/open-expenses" },
  mcp: {
    name: "list_open_expenses",
    description:
      "Every positive expense with something still to pay, with what is outstanding, and the outstanding total per currency.",
  },
});

export const createPayment = defineOperation({
  id: "finance.createPayment",
  access: "write",
  input: z
    .object({
      accountId: Id,
      key: Id.optional(),
      method: PaymentMethod.optional(),
      currency: Currency,
      referenceMonth: CalendarDateInput,
      ...Dates,
    })
    .strict()
    .refine(
      (value) => value.dueOn !== undefined || value.dueAt !== undefined,
      "a payment needs dueOn or dueAt",
    ),
  output: PaymentResource,
  http: { method: "POST", path: "/payments" },
  mcp: {
    name: "create_payment",
    description:
      "Open a payment from an account: money that leaves (or will leave) it, such as a card invoice. It starts at zero; its amount is the sum of the expense shares settled into it. Needs dueOn or dueAt; paidOn/paidAt when it has already left.",
  },
});

export const listPayments = defineOperation({
  id: "finance.listPayments",
  access: "read",
  input: CursorPage.extend({ accountId: Id.optional() }).strict(),
  output: Page(PaymentResource),
  http: { method: "GET", path: "/payments" },
  mcp: {
    name: "list_payments",
    description: "List payments in id order, optionally of one account.",
  },
});

export const getPayment = defineOperation({
  id: "finance.getPayment",
  access: "read",
  input: z.object({ id: Id }).strict(),
  output: PaymentDetail,
  http: { method: "GET", path: "/payments/:id" },
  mcp: {
    name: "get_payment",
    description:
      "One payment with the expense settlements it groups, voided ones included.",
  },
});

export const settleExpense = defineOperation({
  id: "finance.settleExpense",
  access: "write",
  input: z
    .object({
      expenseId: Id,
      paymentId: Id,
      amount: PositiveAmount,
      installmentNumber: z.number().int().min(1).default(1),
      installmentCount: z.number().int().min(1).default(1),
      description: Note.optional(),
      discount: Discount.optional(),
    })
    .strict(),
  output: z
    .object({
      settlement: ExpenseSettlementResource,
      discount: z
        .object({
          expense: ExpenseResource,
          settlement: ExpenseSettlementResource,
        })
        .strict()
        .nullable(),
      payment: PaymentResource,
    })
    .strict(),
  http: { method: "POST", path: "/expense-settlements" },
  mcp: {
    name: "settle_expense",
    description:
      "Allocate a share of an expense to a payment, in the expense's currency. With `discount`, also records the discount obtained as a negative expense settled into the same payment, so the payment moves the share less the discount. Refused when the share exceeds what is still open.",
  },
});

export const payExpense = defineOperation({
  id: "finance.payExpense",
  access: "write",
  input: z
    .object({
      expenseId: Id,
      accountId: Id,
      amount: PositiveAmount,
      method: PaymentMethod.optional(),
      paidOn: CalendarDate.optional(),
      paidAt: IsoDate.optional(),
      discount: Discount.optional(),
    })
    .strict()
    .refine(
      (value) => value.paidOn !== undefined || value.paidAt !== undefined,
      "paying needs paidOn or paidAt",
    ),
  output: settleExpense.output,
  http: { method: "POST", path: "/expenses/:expenseId/pay" },
  mcp: {
    name: "pay_expense",
    description:
      "Pay a share of one expense now: opens a paid payment from the account and settles the share into it, with an optional discount obtained. Use settle_expense instead to add the expense to an existing payment such as a card invoice.",
  },
});

export const voidExpenseSettlement = defineOperation({
  id: "finance.voidExpenseSettlement",
  access: "write",
  destructive: true,
  input: z.object({ id: Id, voidReason: Note.optional() }).strict(),
  output: z
    .object({
      settlement: ExpenseSettlementResource,
      voidedDiscount: ExpenseSettlementResource.nullable(),
    })
    .strict(),
  http: { method: "POST", path: "/expense-settlements/:id/void" },
  mcp: {
    name: "void_expense_settlement",
    description:
      "Void one expense settlement, freeing its share of the expense and reducing its payment. A discount recorded with it is voided first. The settlement remains in the history, marked voided.",
  },
});

export const expenseOperations = [
  createExpense,
  listExpenses,
  getExpense,
  listOpenExpenses,
  createPayment,
  listPayments,
  getPayment,
  settleExpense,
  payExpense,
  voidExpenseSettlement,
] as const;
