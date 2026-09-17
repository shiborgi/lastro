import {
  type Account,
  type AccountDescriptor,
  type AccountReferenceMonth,
  type Book,
  type CardDescriptor,
  type Category,
  type CategoryKind,
  type Institution,
  type Party,
  assertAuthorized,
  operations,
} from "@lastro/domain";
import {
  auditFor,
  contextFor,
  dateInput,
  mapRepositoryError,
  requireText,
} from "./helpers";
import type {
  ApplicationRepository,
  CreateAccountCommand,
  CreateAccountDescriptorCommand,
  CreateAccountReferenceMonthCommand,
  CreateCardDescriptorCommand,
  CreateCategoryCommand,
  CreateInstitutionCommand,
  CreatePartyCommand,
  DeleteCommand,
  UpdateAccountCommand,
  UpdateAccountDescriptorCommand,
  UpdateAccountReferenceMonthCommand,
  UpdateCardDescriptorCommand,
  UpdateCategoryCommand,
  UpdateInstitutionCommand,
  UpdatePartyCommand,
} from "./types";

export function createCatalogMethods(repository: ApplicationRepository) {
  return {
    async listAccessibleBooks(input: { actorId: string }): Promise<Book[]> {
      requireText(input.actorId, "actorId");
      return repository.listBooks(input.actorId);
    },

    async listBooks(contextInput: unknown): Promise<Book[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listBooks);
      return repository.listBooks(context.actorId, context.bookId);
    },

    async createInstitution(
      input: CreateInstitutionCommand,
    ): Promise<Institution> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createInstitution);
      requireText(input.key, "key");
      requireText(input.name, "name");
      return repository.createInstitution(
        {
          bookId: context.bookId,
          key: input.key,
          name: input.name,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "institution.created", "institution", {
          key: input.key,
          name: input.name,
        }),
      );
    },

    async listInstitutions(contextInput: unknown): Promise<Institution[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listInstitutions);
      return repository.listInstitutions(context.bookId);
    },

    async updateInstitution(
      input: UpdateInstitutionCommand,
    ): Promise<Institution> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateInstitution);
      requireText(input.id, "id");
      if (input.key !== undefined) requireText(input.key, "key");
      if (input.name !== undefined) requireText(input.name, "name");
      return repository.updateInstitution(
        {
          bookId: context.bookId,
          id: input.id,
          key: input.key,
          name: input.name,
        },
        auditFor(context, "institution.updated", "institution", {
          id: input.id,
          key: input.key,
          name: input.name,
        }),
      );
    },

    async deleteInstitution(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteInstitution);
      requireText(input.id, "id");
      try {
        await repository.deleteInstitution(
          context.bookId,
          input.id,
          auditFor(context, "institution.deleted", "institution", {
            id: input.id,
          }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createAccount(input: CreateAccountCommand): Promise<Account> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createAccount);
      requireText(input.key, "key");
      requireText(input.name, "name");
      requireText(input.type, "type");
      return repository.createAccount(
        {
          bookId: context.bookId,
          key: input.key,
          name: input.name,
          type: input.type,
          institutionId: input.institutionId,
          number: input.number,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "account.created", "account", {
          key: input.key,
          name: input.name,
          type: input.type,
          institutionId: input.institutionId,
          number: input.number,
        }),
      );
    },

    async listAccounts(contextInput: unknown): Promise<Account[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listAccounts);
      return repository.listAccounts(context.bookId);
    },

    async updateAccount(input: UpdateAccountCommand): Promise<Account> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateAccount);
      requireText(input.id, "id");
      if (input.key !== undefined) requireText(input.key, "key");
      if (input.name !== undefined) requireText(input.name, "name");
      if (input.type !== undefined) requireText(input.type, "type");
      return repository.updateAccount(
        {
          bookId: context.bookId,
          id: input.id,
          key: input.key,
          name: input.name,
          type: input.type,
          institutionId: input.institutionId,
          number: input.number,
        },
        auditFor(context, "account.updated", "account", {
          id: input.id,
          key: input.key,
          name: input.name,
          type: input.type,
        }),
      );
    },

    async deleteAccount(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteAccount);
      requireText(input.id, "id");
      try {
        await repository.deleteAccount(
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
      requireText(input.key, "key");
      requireText(input.name, "name");
      requireText(input.type, "type");
      return repository.createParty(
        {
          bookId: context.bookId,
          key: input.key,
          name: input.name,
          type: input.type,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "party.created", "party", {
          key: input.key,
          name: input.name,
          type: input.type,
        }),
      );
    },

    async listParties(contextInput: unknown): Promise<Party[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listParties);
      return repository.listParties(context.bookId);
    },

    async updateParty(input: UpdatePartyCommand): Promise<Party> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateParty);
      requireText(input.id, "id");
      if (input.key !== undefined) requireText(input.key, "key");
      if (input.name !== undefined) requireText(input.name, "name");
      if (input.type !== undefined) requireText(input.type, "type");
      return repository.updateParty(
        {
          bookId: context.bookId,
          id: input.id,
          key: input.key,
          name: input.name,
          type: input.type,
        },
        auditFor(context, "party.updated", "party", {
          id: input.id,
          key: input.key,
          name: input.name,
          type: input.type,
        }),
      );
    },

    async deleteParty(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteParty);
      requireText(input.id, "id");
      try {
        await repository.deleteParty(
          context.bookId,
          input.id,
          auditFor(context, "party.deleted", "party", { id: input.id }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    /*
     * A card's billing cycles, filled by hand. The database refuses two
     * windows that overlap for one account, so a mistake here surfaces as a
     * refusal rather than as a purchase filed under the wrong invoice.
     */
    async createAccountReferenceMonth(
      input: CreateAccountReferenceMonthCommand,
    ): Promise<AccountReferenceMonth> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createAccountReferenceMonth);
      requireText(input.accountId, "accountId");
      const referenceMonth = dateInput(input.referenceMonth, "referenceMonth");
      const startDate = dateInput(input.startDate, "startDate");
      const endDate = dateInput(input.endDate, "endDate");
      return repository.createAccountReferenceMonth(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          referenceMonth,
          startDate,
          endDate,
        },
        auditFor(
          context,
          "account_reference_month.created",
          "account_reference_month",
          {
            accountId: input.accountId,
            referenceMonth: referenceMonth.toISOString(),
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          },
        ),
      );
    },

    async listAccountReferenceMonths(
      contextInput: unknown,
    ): Promise<AccountReferenceMonth[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listAccountReferenceMonths);
      return repository.listAccountReferenceMonths(context.bookId);
    },

    async updateAccountReferenceMonth(
      input: UpdateAccountReferenceMonthCommand,
    ): Promise<AccountReferenceMonth> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateAccountReferenceMonth);
      requireText(input.id, "id");
      return repository.updateAccountReferenceMonth(
        {
          bookId: context.bookId,
          id: input.id,
          ...(input.referenceMonth === undefined
            ? {}
            : {
                referenceMonth: dateInput(
                  input.referenceMonth,
                  "referenceMonth",
                ),
              }),
          ...(input.startDate === undefined
            ? {}
            : { startDate: dateInput(input.startDate, "startDate") }),
          ...(input.endDate === undefined
            ? {}
            : { endDate: dateInput(input.endDate, "endDate") }),
        },
        auditFor(
          context,
          "account_reference_month.updated",
          "account_reference_month",
          { id: input.id },
        ),
      );
    },

    async deleteAccountReferenceMonth(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteAccountReferenceMonth);
      requireText(input.id, "id");
      try {
        await repository.deleteAccountReferenceMonth(
          context.bookId,
          input.id,
          auditFor(
            context,
            "account_reference_month.deleted",
            "account_reference_month",
            { id: input.id },
          ),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createCardDescriptor(
      input: CreateCardDescriptorCommand,
    ): Promise<CardDescriptor> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createDescriptor);
      requireText(input.key, "key");
      return repository.createCardDescriptor(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          key: input.key,
          partyId: input.partyId,
          categoryId: input.categoryId,
          name: input.name,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "card_descriptor.created", "card_descriptors", {
          accountId: input.accountId,
          key: input.key,
          partyId: input.partyId,
          categoryId: input.categoryId,
          name: input.name,
        }),
      );
    },

    async listCardDescriptors(
      contextInput: unknown,
    ): Promise<CardDescriptor[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listDescriptors);
      return repository.listCardDescriptors(context.bookId);
    },

    async updateCardDescriptor(
      input: UpdateCardDescriptorCommand,
    ): Promise<CardDescriptor> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateDescriptor);
      requireText(input.id, "id");
      return repository.updateCardDescriptor(
        {
          bookId: context.bookId,
          id: input.id,
          partyId: input.partyId,
          categoryId: input.categoryId,
          name: input.name,
        },
        auditFor(context, "card_descriptor.updated", "card_descriptors", {
          id: input.id,
          partyId: input.partyId,
          categoryId: input.categoryId,
          name: input.name,
        }),
      );
    },

    async deleteCardDescriptor(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteDescriptor);
      requireText(input.id, "id");
      try {
        await repository.deleteCardDescriptor(
          context.bookId,
          input.id,
          auditFor(context, "card_descriptor.deleted", "card_descriptors", {
            id: input.id,
          }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createAccountDescriptor(
      input: CreateAccountDescriptorCommand,
    ): Promise<AccountDescriptor> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createDescriptor);
      requireText(input.key, "key");
      return repository.createAccountDescriptor(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          key: input.key,
          partyId: input.partyId,
          categoryId: input.categoryId,
          method: input.method,
          counterAccountId: input.counterAccountId,
          name: input.name,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "account_descriptor.created", "account_descriptors", {
          accountId: input.accountId,
          key: input.key,
          partyId: input.partyId,
          categoryId: input.categoryId,
          method: input.method,
          counterAccountId: input.counterAccountId,
          name: input.name,
        }),
      );
    },

    async listAccountDescriptors(
      contextInput: unknown,
    ): Promise<AccountDescriptor[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listDescriptors);
      return repository.listAccountDescriptors(context.bookId);
    },

    async updateAccountDescriptor(
      input: UpdateAccountDescriptorCommand,
    ): Promise<AccountDescriptor> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateDescriptor);
      requireText(input.id, "id");
      return repository.updateAccountDescriptor(
        {
          bookId: context.bookId,
          id: input.id,
          partyId: input.partyId,
          categoryId: input.categoryId,
          method: input.method,
          counterAccountId: input.counterAccountId,
          name: input.name,
        },
        auditFor(context, "account_descriptor.updated", "account_descriptors", {
          id: input.id,
          partyId: input.partyId,
          categoryId: input.categoryId,
          method: input.method,
          counterAccountId: input.counterAccountId,
          name: input.name,
        }),
      );
    },

    async deleteAccountDescriptor(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteDescriptor);
      requireText(input.id, "id");
      try {
        await repository.deleteAccountDescriptor(
          context.bookId,
          input.id,
          auditFor(
            context,
            "account_descriptor.deleted",
            "account_descriptors",
            {
              id: input.id,
            },
          ),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createCategory(input: CreateCategoryCommand): Promise<Category> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createCategory);
      requireText(input.name, "name");
      return repository.createCategory(
        {
          bookId: context.bookId,
          name: input.name,
          kind: input.kind,
          parentId: input.parentId,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "category.created", "category", {
          name: input.name,
          kind: input.kind,
          parentId: input.parentId,
        }),
      );
    },

    async listCategories(
      contextInput: unknown,
      kind?: CategoryKind,
    ): Promise<Category[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listCategories);
      return repository.listCategories(context.bookId, kind);
    },

    async updateCategory(input: UpdateCategoryCommand): Promise<Category> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateCategory);
      requireText(input.id, "id");
      if (input.name !== undefined) requireText(input.name, "name");
      return repository.updateCategory(
        {
          bookId: context.bookId,
          id: input.id,
          name: input.name,
          kind: input.kind,
          parentId: input.parentId,
        },
        auditFor(context, "category.updated", "category", {
          id: input.id,
          name: input.name,
          kind: input.kind,
        }),
      );
    },

    async deleteCategory(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteCategory);
      requireText(input.id, "id");
      try {
        await repository.deleteCategory(
          context.bookId,
          input.id,
          auditFor(context, "category.deleted", "category", { id: input.id }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },
  };
}
