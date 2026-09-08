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
  name: string;
  type?: string;
  kind?: "EXPENSE" | "REVENUE";
  institutionId?: string | null;
  accountId?: string;
  partyId?: string | null;
  categoryId?: string | null;
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
  sourceAccountId?: string;
  destinationAccountId?: string;
  amount: string;
  currency: string;
  occurredAt?: string;
  dueAt?: string;
  paidAt?: string | null;
  installmentNumber?: number;
  installmentCount?: number;
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

export type CashFlowBucket = {
  currency: string;
  amount: string;
  count: number;
};

export type CashFlow = {
  inflows: CashFlowBucket[];
  outflows: CashFlowBucket[];
  transfers: CashFlowBucket[];
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

export const api = {
  listBooks: () =>
    request<{ books: Book[]; user: { id: string } }>("/v1/books"),

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
  getCashFlow: (bookId: string) =>
    request<CashFlow>(`/v1/books/${bookId}/cash-flow`),
};
