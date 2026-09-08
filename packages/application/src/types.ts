import type {
  Account,
  AuditEvent,
  Book,
  Category,
  CategoryKind,
  Expense,
  ExpenseSettlement,
  Institution,
  Party,
  PartyAlias,
  Payment,
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
  idempotencyKey?: string;
};

export type ApplicationRepository = {
  listBooks?: (actorId: string, bookId?: string) => Promise<Book[]>;
  createInstitution?: (
    input: Omit<Institution, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Institution>;
  listInstitutions?: (bookId: string) => Promise<Institution[]>;
  updateInstitution?: (
    input: { bookId: string; id: string; key?: string; name?: string },
    audit: AuditEvent,
  ) => Promise<Institution>;
  deleteInstitution?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createAccount?: (
    input: Omit<Account, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Account>;
  listAccounts?: (bookId: string) => Promise<Account[]>;
  updateAccount?: (
    input: {
      bookId: string;
      id: string;
      key?: string;
      institutionId?: string | null;
      name?: string;
      type?: string;
    },
    audit: AuditEvent,
  ) => Promise<Account>;
  deleteAccount?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createParty?: (
    input: Omit<Party, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Party>;
  listParties?: (bookId: string) => Promise<Party[]>;
  updateParty?: (
    input: {
      bookId: string;
      id: string;
      key?: string;
      name?: string;
      type?: string;
    },
    audit: AuditEvent,
  ) => Promise<Party>;
  deleteParty?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createPartyAlias?: (
    input: Omit<PartyAlias, "id" | "createdAt"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<PartyAlias>;
  listPartyAliases?: (bookId: string) => Promise<PartyAlias[]>;
  updatePartyAlias?: (
    input: {
      bookId: string;
      id: string;
      key?: string;
      accountId?: string;
      partyId?: string | null;
      categoryId?: string | null;
    },
    audit: AuditEvent,
  ) => Promise<PartyAlias>;
  deletePartyAlias?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createCategory?: (
    input: Omit<Category, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Category>;
  listCategories?: (bookId: string, kind?: CategoryKind) => Promise<Category[]>;
  updateCategory?: (
    input: { bookId: string; id: string; name?: string; kind?: CategoryKind },
    audit: AuditEvent,
  ) => Promise<Category>;
  deleteCategory?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createExpense?: (
    input: Omit<Expense, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Expense>;
  listExpenses?: (bookId: string) => Promise<Expense[]>;
  createPayment?: (
    input: CreatePaymentRepositoryInput,
    audit: AuditEvent,
  ) => Promise<Payment>;
  listPayments?: (bookId: string) => Promise<Payment[]>;
  createExpenseSettlement?: (
    input: CreateExpenseSettlementRepositoryInput,
    audit: AuditEvent,
  ) => Promise<ExpenseSettlement>;
  voidExpenseSettlement?: (
    input: {
      bookId: string;
      id: string;
      voidedBy: string;
      voidReason?: string;
    },
    audit: AuditEvent,
  ) => Promise<ExpenseSettlement>;
  getExpense?: (bookId: string, id: string) => Promise<FinancialExpense | null>;
  listExpenseSettlements?: (
    bookId: string,
    expenseId?: string,
  ) => Promise<ExpenseSettlement[]>;
  listPendingExpenses?: (bookId: string) => Promise<FinancialExpense[]>;
  createRevenue?: (
    input: {
      bookId: string;
      key: string;
      referenceMonth: Date;
      partyId: string;
      categoryId: string;
      amount: bigint;
      currency: string;
      occurredAt?: Date;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<Revenue>;
  listRevenues?: (bookId: string) => Promise<Revenue[]>;
  getRevenue?: (bookId: string, id: string) => Promise<FinancialRevenue | null>;
  createReceipt?: (
    input: {
      bookId: string;
      accountId: string;
      referenceMonth: Date;
      amount: bigint;
      currency: string;
      dueAt: Date;
      paidAt?: Date;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<Receipt>;
  listReceipts?: (bookId: string) => Promise<Receipt[]>;
  createRevenueSettlement?: (
    input: {
      bookId: string;
      revenueId: string;
      receiptId: string;
      amount: bigint;
      currency: string;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<RevenueSettlement>;
  voidRevenueSettlement?: (
    input: {
      bookId: string;
      id: string;
      voidedBy: string;
      voidReason?: string;
    },
    audit: AuditEvent,
  ) => Promise<RevenueSettlement>;
  listRevenueSettlements?: (
    bookId: string,
    revenueId?: string,
  ) => Promise<RevenueSettlement[]>;
  listPendingRevenues?: (bookId: string) => Promise<FinancialRevenue[]>;
  createTransfer?: (
    input: {
      bookId: string;
      key: string;
      referenceMonth: Date;
      sourceAccountId: string;
      destinationAccountId: string;
      amount: bigint;
      currency: string;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<Transfer>;
  listTransfers?: (bookId: string) => Promise<Transfer[]>;
  getTransferByCorrelation?: (
    correlationId: string,
  ) => Promise<Transfer | null>;
};

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
};

export type UpdateAccountCommand = CommandContext & {
  id: string;
  key?: string;
  institutionId?: string | null;
  name?: string;
  type?: string;
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

export type CreatePartyAliasCommand = CommandContext & {
  key: string;
  accountId: string;
  partyId?: string | null;
  categoryId?: string | null;
};

export type UpdatePartyAliasCommand = CommandContext & {
  id: string;
  key?: string;
  accountId?: string;
  partyId?: string | null;
  categoryId?: string | null;
};

export type CreateCategoryCommand = CommandContext & {
  name: string;
  kind: CategoryKind;
};

export type UpdateCategoryCommand = CommandContext & {
  id: string;
  name?: string;
  kind?: CategoryKind;
};

export type CreateExpenseCommand = CommandContext & {
  key: string;
  referenceMonth: Date;
  partyId: string;
  categoryId: string;
  amount?: bigint;
  currency?: string;
  occurredAt?: Date;
};

export type DeleteCommand = CommandContext & { id: string };

export type CreatePaymentCommand = CommandContext & {
  accountId: string;
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
  amount: bigint;
  currency: string;
  occurredAt?: Date;
};

export type CreateReceiptCommand = CommandContext & {
  accountId: string;
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
  amount: bigint;
  currency: string;
};

export type ExpenseQuery = CommandContext & { id: string };
export type PageQuery = CommandContext & { cursor?: string; limit: number };
export type Page<T> = { items: T[]; nextCursor: string | null };
