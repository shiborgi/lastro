import type {
  Account,
  AccountDescriptor,
  AccountMovement,
  AccountReferenceMonth,
  AuditEvent,
  Book,
  BookInsights,
  CardDescriptor,
  CardMovement,
  Category,
  CategoryKind,
  Expense,
  ExpenseSettlement,
  Institution,
  MovementStatus,
  Party,
  Payment,
  PaymentMethod,
  PendingAccountDescriptor,
  PendingCardDescriptor,
  Receipt,
  Revenue,
  RevenueSettlement,
  Transfer,
} from "@lastro/domain";

export type { ExpenseSettlement, Payment };

export type FinancialExpense = Expense & {
  amount: bigint;
  currency: string;
  occurredAt?: Date;
};

export type FinancialRevenue = Revenue & {
  amount: bigint;
  currency: string;
  occurredAt?: Date;
};

export type CreatePaymentRepositoryInput = {
  bookId: string;
  accountId: string;
  /** Derived handle, unique per Book. See `Payment.key`. */
  key?: string | null;
  method?: PaymentMethod | null;
  referenceMonth: Date;
  currency: string;
  dueAt: Date;
  paidAt?: Date;
  idempotencyKey?: string;
};

export type CreateExpenseSettlementRepositoryInput = {
  bookId: string;
  expenseId: string;
  paymentId: string;
  amount: bigint;
  currency: string;
  installmentNumber: number;
  installmentCount: number;
  /** Optional note about this allocation. */
  description?: string | null;
  idempotencyKey?: string;
};

/*
 * The persistence port lives in ./ports, split by aggregate and with every
 * member required. Re-exported here because this is the module the whole
 * application already imports its command types from.
 */
export type {
  ApplicationRepository,
  CatalogRepository,
  ExpenseRepository,
  MovementRepository,
  RevenueRepository,
  TransferRepository,
} from "./ports";

export type CommandContext = { context: unknown };

export type CreateInstitutionCommand = CommandContext & {
  key: string;
  name: string;
};

export type UpdateInstitutionCommand = CommandContext & {
  id: string;
  key?: string;
  name?: string;
};

export type CreateAccountCommand = CommandContext & {
  key: string;
  institutionId?: string | null;
  name: string;
  type: string;
  number?: string | null;
};

export type UpdateAccountCommand = CommandContext & {
  id: string;
  key?: string;
  institutionId?: string | null;
  name?: string;
  type?: string;
  number?: string | null;
};

export type CreatePartyCommand = CommandContext & {
  key: string;
  name: string;
  type: string;
};

export type UpdatePartyCommand = CommandContext & {
  id: string;
  key?: string;
  name?: string;
  type?: string;
};

export type CreateCardDescriptorCommand = CommandContext & {
  accountId: string;
  key: string;
  partyId?: string | null;
  categoryId?: string | null;
  name?: string | null;
};

export type UpdateCardDescriptorCommand = CommandContext & {
  id: string;
  partyId?: string | null;
  categoryId?: string | null;
  name?: string | null;
};

export type CreateAccountDescriptorCommand = CommandContext & {
  accountId: string;
  key: string;
  partyId?: string | null;
  categoryId?: string | null;
  method?: PaymentMethod | null;
  counterAccountId?: string | null;
  name?: string | null;
};

export type UpdateAccountDescriptorCommand = CommandContext & {
  id: string;
  partyId?: string | null;
  categoryId?: string | null;
  method?: PaymentMethod | null;
  counterAccountId?: string | null;
  name?: string | null;
};

export type CreateCategoryCommand = CommandContext & {
  name: string;
  kind: CategoryKind;
  parentId?: string | null;
};

export type UpdateCategoryCommand = CommandContext & {
  id: string;
  name?: string;
  kind?: CategoryKind;
  parentId?: string | null;
};

export type CreateExpenseCommand = CommandContext & {
  key: string;
  referenceMonth: Date;
  partyId: string;
  categoryId: string;
  name?: string | null;
  amount?: bigint;
  currency?: string;
  occurredAt?: Date;
};

export type DeleteCommand = CommandContext & { id: string };

export type CreatePaymentCommand = CommandContext & {
  accountId: string;
  key?: string | null;
  method?: PaymentMethod | null;
  referenceMonth: Date;
  currency: string;
  dueAt: Date;
  paidAt?: Date;
};

export type CreateExpenseSettlementCommand = CommandContext & {
  expenseId: string;
  paymentId: string;
  amount: bigint;
  currency: string;
  installmentNumber: number;
  installmentCount: number;
  /** Optional note about this allocation. */
  description?: string | null;
};

export type VoidExpenseSettlementCommand = CommandContext & {
  id: string;
  voidReason?: string;
};

export type CreateRevenueCommand = CommandContext & {
  key: string;
  referenceMonth: Date;
  partyId: string;
  categoryId: string;
  name?: string | null;
  amount: bigint;
  currency: string;
  occurredAt?: Date;
};

export type CreateReceiptCommand = CommandContext & {
  accountId: string;
  /** Derived handle, unique per Book. See `Receipt.key`. */
  key?: string | null;
  method?: PaymentMethod | null;
  referenceMonth: Date;
  amount: bigint;
  currency: string;
  dueAt: Date;
  paidAt?: Date;
};

export type CreateRevenueSettlementCommand = CommandContext & {
  revenueId: string;
  receiptId: string;
  amount: bigint;
  currency: string;
  /** Optional note about this allocation. */
  description?: string | null;
};

export type VoidRevenueSettlementCommand = CommandContext & {
  id: string;
  voidReason?: string;
};

export type CreateTransferCommand = CommandContext & {
  key: string;
  referenceMonth: Date;
  sourceAccountId: string;
  destinationAccountId: string;
  name?: string | null;
  amount: bigint;
  currency: string;
  occurredAt?: Date;
};

export type ImportStatementCommand = CommandContext & {
  /**
   * Which account this file is. Required and never inferred from a row: the
   * Nubank export prints no account number at all, and a C6 invoice carries
   * two card numbers that are two plastics on one credit account.
   */
  accountId: string;
  /** Where the file came from: `<institution>/<kind>/<file>`. */
  path: string;
  content: string;
};

export type ListMovementsQuery = CommandContext & { status?: MovementStatus };

export type ReviewMovementCommand = CommandContext & {
  kind: "card" | "account";
  id: string;
  status: MovementStatus;
};

export type PostMovementCommand = CommandContext & {
  kind: "card" | "account";
  id: string;
  /** From the invoice, not the purchase. See `postMovement`. */
  referenceMonth: Date;
};

export type PostedMovement = {
  kind: "expense" | "revenue" | "transfer";
  id: string;
  amount: bigint;
  method: PaymentMethod | null;
};

/** What promotion needs from the cycle writers, injected to keep the seam explicit. */
export type PromotionWriters = {
  createExpense: (input: CreateExpenseCommand) => Promise<Expense>;
  createRevenue: (input: CreateRevenueCommand) => Promise<Revenue>;
  createTransfer: (input: CreateTransferCommand) => Promise<Transfer>;
  /*
   * The card schedule needs these two. They arrive as writers rather than
   * being reached through the repository so promotion goes through the same
   * validation and audit a hand-made payment does — a settlement written
   * straight to the repository would skip the amount and installment checks.
   */
  createPayment: (input: CreatePaymentCommand) => Promise<Payment>;
  createExpenseSettlement: (
    input: CreateExpenseSettlementCommand,
  ) => Promise<ExpenseSettlement>;
  /** The revenue cycle's pair, for the same reason. */
  createReceipt: (input: CreateReceiptCommand) => Promise<Receipt>;
  createRevenueSettlement: (
    input: CreateRevenueSettlementCommand,
  ) => Promise<RevenueSettlement>;
};

export type ExpenseQuery = CommandContext & { id: string };
export type PageQuery = CommandContext & { cursor?: string; limit: number };
export type Page<T> = { items: T[]; nextCursor: string | null };

/*
 * The three dates accept the ISO string a transport sends as well as a Date.
 * See `dateInput`: a catalog registration passes the parsed body through and
 * casts it, so declaring `Date` alone made the type a claim nobody checked.
 */
export type CreateAccountReferenceMonthCommand = CommandContext & {
  accountId: string;
  referenceMonth: Date | string;
  startDate: Date | string;
  endDate: Date | string;
};

export type UpdateAccountReferenceMonthCommand = CommandContext & {
  id: string;
  referenceMonth?: Date | string;
  startDate?: Date | string;
  endDate?: Date | string;
};
