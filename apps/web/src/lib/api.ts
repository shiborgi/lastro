/*
 * Every call goes through this app's own /api/backend proxy, which attaches the
 * session server-side. The browser therefore never holds an API credential, and
 * this client never sets an Authorization header.
 */

export type Book = { id: string; name: string };

export type CatalogRecord = {
  id: string;
  bookId: string;
  key?: string;
  /**
   * Nullable because a card or account descriptor read through this same
   * shape carries no name until an operator sets one — every other catalog
   * kind (party, category, account, institution) always has one.
   */
  name: string | null;
  type?: string;
  kind?: "EXPENSE" | "REVENUE";
  institutionId?: string | null;
  accountId?: string;
  partyId?: string | null;
  categoryId?: string | null;
  /**
   * Account descriptors only. A `counterAccountId` is what declares the line a
   * transfer — there is no separate flag — and that is why these two are on
   * this shape at all: reading the descriptors as a catalog is how a screen
   * works out whether a staged line can be promoted.
   */
  method?: string | null;
  counterAccountId?: string | null;
  /** For a category: the group it sits inside. Null means it is a group. */
  parentId?: string | null;
  /** For an account: the number the institution prints. */
  number?: string | null;
  createdAt?: string;
};

export type FinancialRecord = {
  id: string;
  bookId: string;
  key?: string;
  referenceMonth?: string;
  accountId?: string;
  partyId?: string | null;
  categoryId?: string;
  /** Expenses and revenues only. See `expenses.name` in the schema. */
  name?: string | null;
  sourceAccountId?: string;
  destinationAccountId?: string;
  /** Settlements only: which record on either side of the join this names. */
  expenseId?: string;
  paymentId?: string;
  revenueId?: string;
  receiptId?: string;
  amount: string;
  currency: string;
  occurredAt?: string;
  dueAt?: string;
  paidAt?: string | null;
  installmentNumber?: number;
  installmentCount?: number;
  /** Settlements only: the operator's note about this allocation. */
  description?: string | null;
  voidedAt?: string | null;
  createdAt?: string;
};

export type Totals = { currency: string; outstanding: string; count: number };

export type PositionItem = {
  expense: FinancialRecord;
  outstanding: string;
  status: "OPEN" | "PARTIALLY_SETTLED" | "SETTLED";
};

export type RevenuePositionItem = {
  revenue: FinancialRecord;
  outstanding: string;
  status: "OPEN" | "PARTIALLY_SETTLED" | "SETTLED";
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      // Every mutation is idempotent server-side; the key is what makes a
      // retried submit safe instead of duplicating a financial record.
      ...(method === "GET" ? {} : { "idempotency-key": crypto.randomUUID() }),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } })
      ?.error;
    throw new ApiError(
      error?.message ?? `Request failed with ${response.status}`,
      response.status,
      error?.code,
    );
  }
  return body as T;
}

/*
 * The two review queues. Not one type: a card-invoice line is a charge paid by
 * that card, so its descriptor names a party and a category and nothing else,
 * while an account line also needs the rail it took and, for a transfer, the
 * account at the other end.
 */
type PendingEvidence = {
  movements: number;
  /** Minor units as a signed decimal string; never a JSON number. */
  total: string;
  firstSeen: string | null;
  lastSeen: string | null;
  sourceCategories: { value: string; count: number }[];
};

export type PendingCardDescriptor = {
  id: string;
  bookId: string;
  accountId: string;
  key: string;
  partyId: string | null;
  categoryId: string | null;
  /** A label for the expense this promotes to. See the schema for why. */
  name: string | null;
} & PendingEvidence;

export type PendingAccountDescriptor = {
  id: string;
  bookId: string;
  accountId: string;
  key: string;
  partyId: string | null;
  categoryId: string | null;
  method: string | null;
  /** Set means transfer: it is the declaration, not a separate flag. */
  counterAccountId: string | null;
  name: string | null;
} & PendingEvidence;

/**
 * A staged statement line. One shape now: the two tables converged, and what
 * differs is the card's own columns.
 */
export type Movement = {
  id: string;
  bookId: string;
  institutionId: string;
  /** Which account the file belongs to, stated at import. */
  accountId: string;
  source: string;
  /**
   * The date the statement puts on the line. Named alike on both, and meaning
   * different things: an account statement dates money moving, an invoice
   * dates the purchase.
   */
  purchaseDate: string;
  /** The institution's own words. Evidence, never a Lastro classification. */
  category?: string | null;
  title?: string | null;
  description: string;
  descriptorKey: string;
  amount: string;
  currency: string;
  status: "PENDING" | "IGNORED" | "POSTED";
  expenseId?: string | null;
  revenueId?: string | null;
  transferId?: string | null;
  /** Card only. */
  cardholder?: string | null;
  cardNumber?: string | null;
  /** Account only: what the preamble printed. */
  branch?: string | null;
  accountNumber?: string | null;
};

export type BookInsights = {
  gap: {
    stagedMovements: number;
    postedMovements: number;
    ledgerRecords: number;
    /** Both sides together, for the headline. */
    descriptors: number;
    descriptorsPending: number;
    /** Per side, because the review bench is split into card and account. */
    cardDescriptors: number;
    cardDescriptorsPending: number;
    accountDescriptors: number;
    accountDescriptorsPending: number;
  };
  /** One entry per statement file. Card invoices are absent by design. */
  cash: {
    source: string;
    days: { date: string; inflow: string; outflow: string }[];
  }[];
  byGroup: {
    group: string | null;
    category: string;
    kind: "EXPENSE" | "REVENUE";
    total: string;
    count: number;
  }[];
};

export const api = {
  listBooks: () =>
    request<{ books: Book[]; user: { id: string } }>("/v1/books"),

  /** Everything the summary reads, in one request. */
  getInsights: (bookId: string) =>
    request<BookInsights>(`/v1/books/${bookId}/insights`),

  /** Card descriptors still missing a party or a category. */
  listPendingCardDescriptors: (bookId: string) =>
    request<{ items: PendingCardDescriptor[] }>(
      `/v1/books/${bookId}/card-descriptors/pending`,
    ),

  /** Account descriptors still missing what their destination needs. */
  listPendingAccountDescriptors: (bookId: string) =>
    request<{ items: PendingAccountDescriptor[] }>(
      `/v1/books/${bookId}/account-descriptors/pending`,
    ),

  /** The staged rows themselves, so a count can be opened into its lines. */
  listMovements: (
    bookId: string,
    kind: "card" | "account",
    status?: "PENDING" | "IGNORED" | "POSTED",
  ) =>
    request<{ items: Movement[] }>(
      `/v1/books/${bookId}/movements/${kind}${status ? `?status=${status}` : ""}`,
    ),

  /**
   * Promote one staged row. `referenceMonth` belongs to the invoice, not the
   * purchase, so the caller states it — an instalment bought in April sits on
   * a September statement.
   */
  postMovement: (
    bookId: string,
    kind: "card" | "account",
    id: string,
    referenceMonth: string,
  ) =>
    request<{
      kind: string;
      id: string;
      amount: string;
      method: string | null;
    }>(`/v1/books/${bookId}/movements/${kind}/${id}/post`, {
      method: "POST",
      body: JSON.stringify({ referenceMonth }),
    }),

  // The four catalog resources share one shape, so the UI drives them from a
  // single description instead of four near-identical modules.
  listCatalog: (bookId: string, resource: string) =>
    request<{ items: CatalogRecord[] }>(`/v1/books/${bookId}/${resource}`),
  createCatalog: (bookId: string, resource: string, body: unknown) =>
    request<CatalogRecord>(`/v1/books/${bookId}/${resource}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCatalog: (
    bookId: string,
    resource: string,
    id: string,
    body: unknown,
  ) =>
    request<CatalogRecord>(`/v1/books/${bookId}/${resource}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteCatalog: (bookId: string, resource: string, id: string) =>
    request<void>(`/v1/books/${bookId}/${resource}/${id}`, {
      method: "DELETE",
    }),

  listFinancial: (bookId: string, resource: string) =>
    request<Page<FinancialRecord>>(`/v1/books/${bookId}/${resource}?limit=100`),

  getPosition: (bookId: string) =>
    request<{ expenses: Page<PositionItem>; totals: Totals[] }>(
      `/v1/books/${bookId}/position?limit=100`,
    ),
  getRevenuePosition: (bookId: string) =>
    request<{ revenues: Page<RevenuePositionItem>; totals: Totals[] }>(
      `/v1/books/${bookId}/revenue-position?limit=100`,
    ),
};
