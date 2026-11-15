import type { CatalogTable } from "@lastro/kernel";
import type {
  AccountMovement,
  AccountMovementDescriptor,
  AccountMovementLink,
  AccountMovementMapping,
  DescriptorRef,
  MovementConsumer,
  MovementDirection,
  MovementFile,
  MovementStatus,
} from "../domain/account-movements";
import type {
  CardDescriptor,
  CardExpenseLink,
  CardMapping,
  CardMovement,
  CardPaymentLink,
  CardTransferLink,
} from "../domain/cards";
/**
 * Finance's own persistence port. Every member is required: an adapter that
 * cannot answer one does not typecheck.
 *
 * Every method takes the scope's `handle` first, so a call made inside a
 * write runs on that write's transaction.
 */
import type {
  Account,
  AccountCycle,
  FinancialCategory,
  FinancialCategoryKind,
  Institution,
  Party,
} from "../domain/catalog";
import type {
  Expense,
  ExpenseSettlement,
  Payment,
  Receipt,
  Revenue,
  RevenueSettlement,
  Transfer,
} from "../domain/records";
import type {
  RevenueMovement,
  RevenueMovementDescriptor,
  RevenueMovementLink,
  RevenueMovementReceipt,
} from "../domain/revenue-movements";

export type { CatalogTable };

export type CatalogPort = {
  institutions: CatalogTable<Institution>;
  accounts: CatalogTable<Account>;
  accountCycles: CatalogTable<AccountCycle, { accountId?: string }>;
  parties: CatalogTable<Party>;
  financialCategories: CatalogTable<
    FinancialCategory,
    { kind?: FinancialCategoryKind }
  >;
};

/** A page in id order: the records after `after`, at most `limit` of them. */
export type PageQuery = { after?: string; limit: number };

type New<T> = Omit<T, "id" | "bookId">;

export type ExpensePort = {
  expenses: {
    insert(
      handle: unknown,
      bookId: string,
      input: New<Expense>,
    ): Promise<Expense>;
    get(handle: unknown, bookId: string, id: string): Promise<Expense | null>;
    getByKey(
      handle: unknown,
      bookId: string,
      key: string,
    ): Promise<Expense | null>;
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & { referenceMonth?: Date },
    ): Promise<Expense[]>;
    /** Every expense whose competence month falls in [from, to). */
    listByReferenceMonth(
      handle: unknown,
      bookId: string,
      from: Date,
      to: Date,
    ): Promise<Expense[]>;
    /** Every expense with a positive amount, in id order. */
    listPositive(handle: unknown, bookId: string): Promise<Expense[]>;
  };
  payments: {
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<New<Payment>, "amount">,
    ): Promise<Payment>;
    get(handle: unknown, bookId: string, id: string): Promise<Payment | null>;
    getByKey(
      handle: unknown,
      bookId: string,
      key: string,
    ): Promise<Payment | null>;
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & { accountId?: string },
    ): Promise<Payment[]>;
  };
  expenseSettlements: {
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<
        New<ExpenseSettlement>,
        "voidedAt" | "voidedBy" | "voidReason"
      >,
    ): Promise<ExpenseSettlement>;
    get(
      handle: unknown,
      bookId: string,
      id: string,
    ): Promise<ExpenseSettlement | null>;
    /** In id order; with no filter, every settlement of the Book. */
    list(
      handle: unknown,
      bookId: string,
      filter: { expenseId?: string; paymentId?: string },
    ): Promise<ExpenseSettlement[]>;
    /** Null when the Book has no such active settlement. */
    void(
      handle: unknown,
      bookId: string,
      id: string,
      by: { voidedBy: string; voidReason: string | null },
    ): Promise<ExpenseSettlement | null>;
  };
  /**
   * Queue writers of one expense and one payment until this transaction ends,
   * expense first. Every insert or void of a settlement takes it: the
   * payment's amount is recomputed by a trigger from the active settlements,
   * and a writer that skipped the lock could sum a stale set.
   */
  lockSettlementSet(
    handle: unknown,
    bookId: string,
    expenseId: string,
    paymentId: string,
  ): Promise<void>;
};

export type RevenuePort = {
  revenues: {
    insert(
      handle: unknown,
      bookId: string,
      input: New<Revenue>,
    ): Promise<Revenue>;
    get(handle: unknown, bookId: string, id: string): Promise<Revenue | null>;
    getByKey(
      handle: unknown,
      bookId: string,
      key: string,
    ): Promise<Revenue | null>;
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & { referenceMonth?: Date },
    ): Promise<Revenue[]>;
  };
  receipts: {
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<New<Receipt>, "amount" | "channel" | "partyId" | "brand">,
    ): Promise<Receipt>;
    get(handle: unknown, bookId: string, id: string): Promise<Receipt | null>;
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & { accountId?: string },
    ): Promise<Receipt[]>;
    /** When the money arrived; null puts the receipt back to expected. */
    setPaid(
      handle: unknown,
      bookId: string,
      id: string,
      paid: { paidOn: Date | null; paidAt: Date | null },
    ): Promise<void>;
  };
  revenueSettlements: {
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<
        New<RevenueSettlement>,
        "voidedAt" | "voidedBy" | "voidReason"
      >,
    ): Promise<RevenueSettlement>;
    get(
      handle: unknown,
      bookId: string,
      id: string,
    ): Promise<RevenueSettlement | null>;
    list(
      handle: unknown,
      bookId: string,
      filter: { revenueId?: string; receiptId?: string },
    ): Promise<RevenueSettlement[]>;
    void(
      handle: unknown,
      bookId: string,
      id: string,
      by: { voidedBy: string; voidReason: string | null },
    ): Promise<RevenueSettlement | null>;
  };
  /** As `lockSettlementSet`, for one revenue and one receipt, revenue first. */
  lockRevenueSet(
    handle: unknown,
    bookId: string,
    revenueId: string,
    receiptId: string,
  ): Promise<void>;
  transfers: {
    insert(
      handle: unknown,
      bookId: string,
      input: New<Transfer>,
    ): Promise<Transfer>;
    /** Only a transfer no movement references any more. */
    remove(handle: unknown, bookId: string, id: string): Promise<void>;
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & { accountId?: string },
    ): Promise<Transfer[]>;
  };
};

/** Account movement evidence (ADR 17). */
export type AccountMovementPort = {
  movementConsumers: {
    get(
      handle: unknown,
      bookId: string,
      accountId: string,
      movementType: string,
    ): Promise<MovementConsumer | null>;
    /** Creates or replaces the account's consumer of that type. */
    set(
      handle: unknown,
      bookId: string,
      input: Omit<MovementConsumer, "bookId" | "setAt">,
    ): Promise<MovementConsumer>;
    list(
      handle: unknown,
      bookId: string,
      query: { accountId?: string },
    ): Promise<MovementConsumer[]>;
  };
  movementFiles: {
    findByContent(
      handle: unknown,
      bookId: string,
      query: {
        accountId: string;
        importerFingerprint: string;
        contentSha256: string;
      },
    ): Promise<MovementFile | null>;
    get(
      handle: unknown,
      bookId: string,
      id: string,
    ): Promise<MovementFile | null>;
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<New<MovementFile>, "importedAt">,
    ): Promise<MovementFile>;
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & { accountId?: string },
    ): Promise<MovementFile[]>;
  };
  accountMovementDescriptors: {
    /** The descriptor of a name, created unclassified when new. */
    ensure(
      handle: unknown,
      bookId: string,
      input: DescriptorRef & { name: string },
    ): Promise<AccountMovementDescriptor>;
    get(
      handle: unknown,
      bookId: string,
      ref: DescriptorRef,
    ): Promise<AccountMovementDescriptor | null>;
    list(
      handle: unknown,
      bookId: string,
      query: {
        accountId?: string;
        direction?: MovementDirection;
        classified?: boolean;
      },
    ): Promise<AccountMovementDescriptor[]>;
    classify(
      handle: unknown,
      bookId: string,
      ref: DescriptorRef,
      mapping: AccountMovementMapping,
    ): Promise<AccountMovementDescriptor>;
  };
  accountMovements: {
    /** The staged movements of an account with these provider ids, either direction. */
    findByExternalIds(
      handle: unknown,
      bookId: string,
      accountId: string,
      externalIds: readonly string[],
    ): Promise<AccountMovement[]>;
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<New<AccountMovement>, "status" | "ignoreReason">,
    ): Promise<AccountMovement>;
    get(
      handle: unknown,
      bookId: string,
      id: string,
    ): Promise<AccountMovement | null>;
    /** Newest id first. */
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & {
        accountId?: string;
        direction?: MovementDirection;
        status?: MovementStatus;
        descriptorKey?: string;
      },
    ): Promise<AccountMovement[]>;
    /** Changes the named fields and answers the movement as it now is. */
    update(
      handle: unknown,
      bookId: string,
      id: string,
      patch: Partial<
        Pick<AccountMovement, "status" | "ignoreReason"> &
          AccountMovementMapping
      >,
    ): Promise<AccountMovement>;
    /** Serialize writers of one movement until this transaction ends. */
    lock(handle: unknown, bookId: string, id: string): Promise<void>;
  };
  accountMovementLinks: {
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<AccountMovementLink, "id" | "bookId">,
    ): Promise<AccountMovementLink>;
    /** Oldest first, from both directions. */
    list(
      handle: unknown,
      bookId: string,
      query: {
        movementId?: string;
        statementKey?: string;
        transferId?: string;
        externalKey?: string;
        /** An expense or revenue key. */
        entryKey?: string;
        /** A payment or receipt key. */
        cashKey?: string;
      },
    ): Promise<AccountMovementLink[]>;
    removeOfMovement(
      handle: unknown,
      bookId: string,
      movementId: string,
    ): Promise<void>;
  };
};

/** Card movement evidence (ADR 18). */
export type CardPort = {
  cardDescriptors: {
    /** The descriptor of a name, created unclassified when new. */
    ensure(
      handle: unknown,
      bookId: string,
      input: { accountId: string; descriptorKey: string; name: string },
    ): Promise<CardDescriptor>;
    get(
      handle: unknown,
      bookId: string,
      accountId: string,
      descriptorKey: string,
    ): Promise<CardDescriptor | null>;
    list(
      handle: unknown,
      bookId: string,
      query: { accountId?: string; classified?: boolean },
    ): Promise<CardDescriptor[]>;
    classify(
      handle: unknown,
      bookId: string,
      input: Pick<CardDescriptor, "accountId" | "descriptorKey"> & CardMapping,
    ): Promise<CardDescriptor>;
  };
  cardMovements: {
    findByStatementIds(
      handle: unknown,
      bookId: string,
      accountId: string,
      statementIds: readonly string[],
    ): Promise<CardMovement[]>;
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<New<CardMovement>, "status" | "ignoreReason">,
    ): Promise<CardMovement>;
    get(
      handle: unknown,
      bookId: string,
      id: string,
    ): Promise<CardMovement | null>;
    /** Newest id first. */
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & {
        accountId?: string;
        status?: MovementStatus;
        descriptorKey?: string;
        expenseKey?: string;
      },
    ): Promise<CardMovement[]>;
    update(
      handle: unknown,
      bookId: string,
      id: string,
      patch: Partial<
        Pick<CardMovement, "status" | "ignoreReason"> & CardMapping
      >,
    ): Promise<CardMovement>;
    lock(handle: unknown, bookId: string, id: string): Promise<void>;
  };
  cardLinks: {
    getExpense(
      handle: unknown,
      bookId: string,
      accountId: string,
      expenseKey: string,
    ): Promise<CardExpenseLink | null>;
    insertExpense(
      handle: unknown,
      bookId: string,
      input: Omit<CardExpenseLink, "bookId">,
    ): Promise<CardExpenseLink>;
    /** Removes the expense link and every instalment link under it. */
    removeExpense(
      handle: unknown,
      bookId: string,
      accountId: string,
      expenseKey: string,
    ): Promise<void>;
    insertPayment(
      handle: unknown,
      bookId: string,
      input: Omit<CardPaymentLink, "bookId">,
    ): Promise<CardPaymentLink>;
    getPayment(
      handle: unknown,
      bookId: string,
      accountId: string,
      paymentKey: string,
    ): Promise<CardPaymentLink | null>;
    setPaymentMovement(
      handle: unknown,
      bookId: string,
      accountId: string,
      paymentKey: string,
      movementId: string | null,
    ): Promise<CardPaymentLink>;
    /** By instalment number. */
    paymentsOf(
      handle: unknown,
      bookId: string,
      accountId: string,
      expenseKey: string,
    ): Promise<CardPaymentLink[]>;
    list(
      handle: unknown,
      bookId: string,
      query: { accountId?: string; expenseKey?: string; expenseId?: string },
    ): Promise<{ expenses: CardExpenseLink[]; payments: CardPaymentLink[] }>;
    insertTransfer(
      handle: unknown,
      bookId: string,
      input: Omit<CardTransferLink, "bookId">,
    ): Promise<CardTransferLink>;
    /** Every invoice payment's transfer link with this key or transfer. */
    transfers(
      handle: unknown,
      bookId: string,
      query: {
        movementId?: string;
        statementKey?: string;
        transferId?: string;
      },
    ): Promise<CardTransferLink[]>;
    removeTransfer(
      handle: unknown,
      bookId: string,
      movementId: string,
    ): Promise<void>;
    /** Serialize writers of one purchase until this transaction ends. */
    lock(
      handle: unknown,
      bookId: string,
      accountId: string,
      expenseKey: string,
    ): Promise<void>;
  };
};

/** Revenue movement evidence (ADR 19). */
export type RevenueMovementPort = {
  revenueMovementDescriptors: {
    ensure(
      handle: unknown,
      bookId: string,
      input: Pick<
        RevenueMovementDescriptor,
        "accountId" | "descriptorKey" | "component" | "name"
      >,
    ): Promise<RevenueMovementDescriptor>;
    get(
      handle: unknown,
      bookId: string,
      accountId: string,
      descriptorKey: string,
    ): Promise<RevenueMovementDescriptor | null>;
    list(
      handle: unknown,
      bookId: string,
      query: {
        accountId?: string;
        classified?: boolean;
        settlementGroup?: string;
      },
    ): Promise<RevenueMovementDescriptor[]>;
    classify(
      handle: unknown,
      bookId: string,
      input: Pick<
        RevenueMovementDescriptor,
        | "accountId"
        | "descriptorKey"
        | "partyId"
        | "financialCategoryId"
        | "settlementGroup"
        | "settlesMethodKey"
        | "receivedAccountId"
      >,
    ): Promise<RevenueMovementDescriptor>;
  };
  revenueMovements: {
    findByExternalIds(
      handle: unknown,
      bookId: string,
      accountId: string,
      externalIds: readonly string[],
    ): Promise<RevenueMovement[]>;
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<New<RevenueMovement>, "status" | "ignoreReason">,
    ): Promise<RevenueMovement>;
    get(
      handle: unknown,
      bookId: string,
      id: string,
    ): Promise<RevenueMovement | null>;
    /** Newest id first. */
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & {
        accountId?: string;
        status?: MovementStatus;
        methodKey?: string;
        occurredOn?: Date;
      },
    ): Promise<RevenueMovement[]>;
    update(
      handle: unknown,
      bookId: string,
      id: string,
      patch: Partial<Pick<RevenueMovement, "status" | "ignoreReason">>,
    ): Promise<RevenueMovement>;
    lock(handle: unknown, bookId: string, id: string): Promise<void>;
  };
  revenueMovementLinks: {
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<RevenueMovementLink, "bookId">,
    ): Promise<RevenueMovementLink>;
    list(
      handle: unknown,
      bookId: string,
      query: {
        movementId?: string;
        externalKey?: string;
        statementId?: string;
        revenueKey?: string;
      },
    ): Promise<RevenueMovementLink[]>;
    removeOfMovement(
      handle: unknown,
      bookId: string,
      movementId: string,
    ): Promise<void>;
  };
  revenueMovementReceipts: {
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<RevenueMovementReceipt, "bookId">,
    ): Promise<RevenueMovementReceipt>;
    list(
      handle: unknown,
      bookId: string,
      query: { movementId?: string; receiptId?: string },
    ): Promise<RevenueMovementReceipt[]>;
    removeOfReceipt(
      handle: unknown,
      bookId: string,
      receiptId: string,
    ): Promise<void>;
    removeOfMovement(
      handle: unknown,
      bookId: string,
      movementId: string,
    ): Promise<void>;
  };
};

export type FinancePort = CatalogPort &
  ExpensePort &
  RevenuePort &
  AccountMovementPort &
  CardPort &
  RevenueMovementPort;
