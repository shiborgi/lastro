import {
  type Account,
  type Book,
  type Category,
  type CategoryKind,
  type Institution,
  type Party,
  type PartyAlias,
  assertAuthorized,
  operations,
} from "@lastro/domain";
import {
  auditFor,
  contextFor,
  mapRepositoryError,
  method,
  requireText,
} from "./helpers";
import type {
  ApplicationRepository,
  CreateAccountCommand,
  CreateCategoryCommand,
  CreateInstitutionCommand,
  CreatePartyAliasCommand,
  CreatePartyCommand,
  DeleteCommand,
  UpdateAccountCommand,
  UpdateCategoryCommand,
  UpdateInstitutionCommand,
  UpdatePartyAliasCommand,
  UpdatePartyCommand,
} from "./types";

export function createLedgerMethods(repository: ApplicationRepository) {
  return {
    async listAccessibleBooks(input: { actorId: string }): Promise<Book[]> {
      requireText(input.actorId, "actorId");
      return method(repository, "listBooks")(input.actorId);
    },

    async listBooks(contextInput: unknown): Promise<Book[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listBooks);
      return method(repository, "listBooks")(context.actorId, context.bookId);
    },

    async createInstitution(
      input: CreateInstitutionCommand,
    ): Promise<Institution> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createInstitution);
      requireText(input.key, "key");
      requireText(input.name, "name");
      return method(repository, "createInstitution")(
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
      return method(repository, "listInstitutions")(context.bookId);
    },

    async updateInstitution(
      input: UpdateInstitutionCommand,
    ): Promise<Institution> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateInstitution);
      requireText(input.id, "id");
      if (input.key !== undefined) requireText(input.key, "key");
      if (input.name !== undefined) requireText(input.name, "name");
      return method(repository, "updateInstitution")(
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
        await method(repository, "deleteInstitution")(
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
      return method(repository, "createAccount")(
        {
          bookId: context.bookId,
          key: input.key,
          name: input.name,
          type: input.type,
          institutionId: input.institutionId,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "account.created", "account", {
          key: input.key,
          name: input.name,
          type: input.type,
          institutionId: input.institutionId,
        }),
      );
    },

    async listAccounts(contextInput: unknown): Promise<Account[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listAccounts);
      return method(repository, "listAccounts")(context.bookId);
    },

    async updateAccount(input: UpdateAccountCommand): Promise<Account> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateAccount);
      requireText(input.id, "id");
      if (input.key !== undefined) requireText(input.key, "key");
      if (input.name !== undefined) requireText(input.name, "name");
      if (input.type !== undefined) requireText(input.type, "type");
      return method(repository, "updateAccount")(
        {
          bookId: context.bookId,
          id: input.id,
          key: input.key,
          name: input.name,
          type: input.type,
          institutionId: input.institutionId,
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
      requireText(input.key, "key");
      requireText(input.name, "name");
      requireText(input.type, "type");
      return method(repository, "createParty")(
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
      return method(repository, "listParties")(context.bookId);
    },

    async updateParty(input: UpdatePartyCommand): Promise<Party> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateParty);
      requireText(input.id, "id");
      if (input.key !== undefined) requireText(input.key, "key");
      if (input.name !== undefined) requireText(input.name, "name");
      if (input.type !== undefined) requireText(input.type, "type");
      return method(repository, "updateParty")(
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
        await method(repository, "deleteParty")(
          context.bookId,
          input.id,
          auditFor(context, "party.deleted", "party", { id: input.id }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createPartyAlias(
      input: CreatePartyAliasCommand,
    ): Promise<PartyAlias> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createPartyAlias);
      requireText(input.key, "key");
      requireText(input.accountId, "accountId");
      return method(repository, "createPartyAlias")(
        {
          bookId: context.bookId,
          key: input.key,
          accountId: input.accountId,
          partyId: input.partyId,
          categoryId: input.categoryId,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "party_alias.created", "party_alias", {
          key: input.key,
          accountId: input.accountId,
          partyId: input.partyId,
          categoryId: input.categoryId,
        }),
      );
    },

    async listPartyAliases(contextInput: unknown): Promise<PartyAlias[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listPartyAliases);
      return method(repository, "listPartyAliases")(context.bookId);
    },

    async updatePartyAlias(
      input: UpdatePartyAliasCommand,
    ): Promise<PartyAlias> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updatePartyAlias);
      requireText(input.id, "id");
      if (input.key !== undefined) requireText(input.key, "key");
      if (input.accountId !== undefined)
        requireText(input.accountId, "accountId");
      return method(repository, "updatePartyAlias")(
        {
          bookId: context.bookId,
          id: input.id,
          key: input.key,
          accountId: input.accountId,
          partyId: input.partyId,
          categoryId: input.categoryId,
        },
        auditFor(context, "party_alias.updated", "party_alias", {
          id: input.id,
          key: input.key,
          accountId: input.accountId,
          partyId: input.partyId,
          categoryId: input.categoryId,
        }),
      );
    },

    async deletePartyAlias(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deletePartyAlias);
      requireText(input.id, "id");
      try {
        await method(repository, "deletePartyAlias")(
          context.bookId,
          input.id,
          auditFor(context, "party_alias.deleted", "party_alias", {
            id: input.id,
          }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createCategory(input: CreateCategoryCommand): Promise<Category> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createCategory);
      requireText(input.name, "name");
      return method(repository, "createCategory")(
        {
          bookId: context.bookId,
          name: input.name,
          kind: input.kind,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "category.created", "category", {
          name: input.name,
          kind: input.kind,
        }),
      );
    },

    async listCategories(
      contextInput: unknown,
      kind?: CategoryKind,
    ): Promise<Category[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listCategories);
      return method(repository, "listCategories")(context.bookId, kind);
    },

    async updateCategory(input: UpdateCategoryCommand): Promise<Category> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.updateCategory);
      requireText(input.id, "id");
      if (input.name !== undefined) requireText(input.name, "name");
      return method(repository, "updateCategory")(
        {
          bookId: context.bookId,
          id: input.id,
          name: input.name,
          kind: input.kind,
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
        await method(repository, "deleteCategory")(
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
