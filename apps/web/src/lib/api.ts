export type Book = {
  id: string;
  name: string;
};

export type FinancialResource = {
  id: string;
  bookId: string;
  accountId?: string;
  partyId?: string | null;
  expenseCategoryId?: string;
  expenseId?: string;
  paymentId?: string;
  amountMinor: string;
  currency: string;
  occurredAt?: string;
  createdAt?: string;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
};

export type PositionItem = {
  expense: {
    id: string;
    bookId: string;
    accountId?: string;
    partyId?: string | null;
    expenseCategoryId?: string;
    amountMinor: string;
    currency: string;
    occurredAt?: string;
    createdAt?: string;
  };
  outstandingMinor: string;
  status: "OPEN" | "PARTIALLY_SETTLED" | "SETTLED";
};

export type BookPosition = {
  expenses: { items: PositionItem[]; nextCursor: string | null };
  totals: { currency: string; outstandingMinor: string; count: number }[];
};

export type ApiError = {
  error: { code: string; message: string };
};

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      throw new Error(
        body?.error?.message ?? `Request failed: ${response.status}`,
      );
    }
    return (await response.json()) as T;
  }

  listBooks(): Promise<{ books: Book[] }> {
    return this.request("/books");
  }

  getPosition(bookId: string): Promise<BookPosition> {
    return this.request(`/v1/books/${bookId}/position`);
  }

  listExpenses(
    bookId: string,
  ): Promise<{ items: FinancialResource[]; nextCursor: string | null }> {
    return this.request(`/v1/books/${bookId}/expenses`);
  }

  listPayments(
    bookId: string,
  ): Promise<{ items: FinancialResource[]; nextCursor: string | null }> {
    return this.request(`/v1/books/${bookId}/payments`);
  }

  createExpense(
    bookId: string,
    input: {
      accountId: string;
      partyId: string;
      expenseCategoryId: string;
      amountMinor: string;
      currency: string;
    },
  ): Promise<{ expense: FinancialResource }> {
    return this.request(`/v1/books/${bookId}/expenses`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createPayment(
    bookId: string,
    input: {
      accountId: string;
      partyId?: string | null;
      amountMinor: string;
      currency: string;
    },
  ): Promise<{ payment: FinancialResource }> {
    return this.request(`/v1/books/${bookId}/payments`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createExpenseSettlement(
    bookId: string,
    input: {
      expenseId: string;
      paymentId: string;
      amountMinor: string;
      currency: string;
    },
  ): Promise<{ settlement: FinancialResource }> {
    return this.request(`/v1/books/${bookId}/expense-settlements`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listExpenseSettlements(
    bookId: string,
  ): Promise<{ items: FinancialResource[]; nextCursor: string | null }> {
    return this.request(`/v1/books/${bookId}/expense-settlements`);
  }

  voidExpenseSettlement(
    bookId: string,
    settlementId: string,
    input: { voidReason?: string },
  ): Promise<{ settlement: FinancialResource }> {
    return this.request(
      `/v1/books/${bookId}/expense-settlements/${settlementId}/void`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
}
