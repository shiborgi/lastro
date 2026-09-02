import {
  type Account,
  type AuditEvent,
  type Book,
  ConflictError,
  type Expense,
  type ExpenseCategory,
  type Party,
  type RevenueCategory,
  assertAuthorized,
  assertExecutionContext,
  operations,
} from "@lastro/domain";

export type ApplicationRepository = {
  listBooks?: (actorId: string, bookId?: string) => Promise<Book[]>;
  createAccount?: (
    input: Omit<Account, "id">,
    audit: AuditEvent,
  ) => Promise<Account>;
  listAccounts?: (bookId: string) => Promise<Account[]>;
  deleteAccount?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createParty?: (input: Omit<Party, "id">, audit: AuditEvent) => Promise<Party>;
  listParties?: (bookId: string) => Promise<Party[]>;
  deleteParty?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createExpenseCategory?: (
    input: Omit<ExpenseCategory, "id">,
    audit: AuditEvent,
  ) => Promise<ExpenseCategory>;
  listExpenseCategories?: (bookId: string) => Promise<ExpenseCategory[]>;
  deleteExpenseCategory?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createRevenueCategory?: (
    input: Omit<RevenueCategory, "id">,
    audit: AuditEvent,
  ) => Promise<RevenueCategory>;
  listRevenueCategories?: (bookId: string) => Promise<RevenueCategory[]>;
  createExpense?: (
    input: Omit<Expense, "id">,
    audit: AuditEvent,
  ) => Promise<Expense>;
  listExpenses?: (bookId: string) => Promise<Expense[]>;
};

export type CommandContext = { context: unknown };

export type CreateAccountCommand = CommandContext & {
  name: string;
  type: string;
};

export type CreatePartyCommand = CommandContext & {
  name: string;
  type: string;
};

export type CreateCategoryCommand = CommandContext & { name: string };

export type CreateExpenseCommand = CommandContext & {
  accountId: string;
  partyId: string;
  expenseCategoryId: string;
};

export type DeleteCommand = CommandContext & { id: string };

function requireText(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} is required`);
  return value;
}

function auditFor(
  context: ReturnType<typeof assertExecutionContext>,
  action: string,
  resourceType: string,
  payload: Record<string, unknown>,
): AuditEvent {
  const actorType = context.actorType ?? "USER";
  return {
    actorType,
    actorPrincipal: context.agentPrincipal ?? context.actorId,
    delegatedOperator: context.delegatedOperator ?? context.actorId,
    bookId: context.bookId,
    source: context.source,
    correlationId: context.correlationId,
    action,
    resourceType,
    payload,
  };
}

function mapRepositoryError(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23503"
  ) {
    throw new ConflictError();
  }
  throw error;
}

function contextFor(input: unknown) {
  return assertExecutionContext(input);
}

function method<T extends keyof ApplicationRepository>(
  repository: ApplicationRepository,
  name: T,
): NonNullable<ApplicationRepository[T]> {
  const candidate = repository[name];
  if (typeof candidate !== "function") {
    throw new Error(`repository method ${String(name)} is not configured`);
  }
  return candidate as NonNullable<ApplicationRepository[T]>;
}

export function createApplication(repository: ApplicationRepository) {
  return {
    async listBooks(contextInput: unknown): Promise<Book[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listBooks);
      return method(repository, "listBooks")(context.actorId, context.bookId);
    },

    async createAccount(input: CreateAccountCommand): Promise<Account> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createAccount);
      requireText(input.name, "name");
      requireText(input.type, "type");
      return method(repository, "createAccount")(
        { bookId: context.bookId, name: input.name, type: input.type },
        auditFor(context, "account.created", "account", {
          name: input.name,
          type: input.type,
        }),
      );
    },

    async listAccounts(contextInput: unknown): Promise<Account[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listAccounts);
      return method(repository, "listAccounts")(context.bookId);
    },

    async deleteAccount(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteAccount);
      requireText(input.id, "id");
      try {
        await method(repository, "deleteAccount")(
          context.bookId,
          input.id,
          auditFor(context, "account.deleted", "account", { id: input.id }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createParty(input: CreatePartyCommand): Promise<Party> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createParty);
      requireText(input.name, "name");
      requireText(input.type, "type");
      return method(repository, "createParty")(
        { bookId: context.bookId, name: input.name, type: input.type },
        auditFor(context, "party.created", "party", {
          name: input.name,
          type: input.type,
        }),
      );
    },

    async listParties(contextInput: unknown): Promise<Party[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listParties);
      return method(repository, "listParties")(context.bookId);
    },

    async deleteParty(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteParty);
      requireText(input.id, "id");
      try {
        await method(repository, "deleteParty")(
          context.bookId,
          input.id,
          auditFor(context, "party.deleted", "party", { id: input.id }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createExpenseCategory(
      input: CreateCategoryCommand,
    ): Promise<ExpenseCategory> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createExpenseCategory);
      requireText(input.name, "name");
      return method(repository, "createExpenseCategory")(
        { bookId: context.bookId, name: input.name },
        auditFor(context, "expense_category.created", "expense_category", {
          name: input.name,
        }),
      );
    },

    async listExpenseCategories(
      contextInput: unknown,
    ): Promise<ExpenseCategory[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenseCategories);
      return method(repository, "listExpenseCategories")(context.bookId);
    },

    async deleteExpenseCategory(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteExpenseCategory);
      requireText(input.id, "id");
      try {
        await method(repository, "deleteExpenseCategory")(
          context.bookId,
          input.id,
          auditFor(context, "expense_category.deleted", "expense_category", {
            id: input.id,
          }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createRevenueCategory(
      input: CreateCategoryCommand,
    ): Promise<RevenueCategory> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createRevenueCategory);
      requireText(input.name, "name");
      return method(repository, "createRevenueCategory")(
        { bookId: context.bookId, name: input.name },
        auditFor(context, "revenue_category.created", "revenue_category", {
          name: input.name,
        }),
      );
    },

    async listRevenueCategories(
      contextInput: unknown,
    ): Promise<RevenueCategory[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listRevenueCategories);
      return method(repository, "listRevenueCategories")(context.bookId);
    },

    async createExpense(input: CreateExpenseCommand): Promise<Expense> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createExpense);
      requireText(input.accountId, "accountId");
      requireText(input.partyId, "partyId");
      requireText(input.expenseCategoryId, "expenseCategoryId");
      return method(repository, "createExpense")(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          partyId: input.partyId,
          expenseCategoryId: input.expenseCategoryId,
        },
        auditFor(context, "expense.created", "expense", {
          accountId: input.accountId,
          partyId: input.partyId,
          expenseCategoryId: input.expenseCategoryId,
        }),
      );
    },

    async listExpenses(contextInput: unknown): Promise<Expense[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenses);
      return method(repository, "listExpenses")(context.bookId);
    },
  };
}

export type Application = ReturnType<typeof createApplication>;

export function createAccountCommand(repository: ApplicationRepository) {
  return {
    execute: (input: CreateAccountCommand) =>
      createApplication(repository).createAccount(input),
  };
}

export function createExpenseCommand(repository: ApplicationRepository) {
  return {
    execute: (input: CreateExpenseCommand) =>
      createApplication(repository).createExpense(input),
  };
}
