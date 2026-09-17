/**
 * Catalog CRUD, generated from one description per resource.
 *
 * The seven resources behave identically — list, create, patch, delete, all
 * Book-scoped — so they are registered from one generator rather than seven
 * near-identical copies.
 */
import type {
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
} from "@lastro/application";
import {
  AccountDescriptorResource,
  AccountReferenceMonthResource,
  AccountResource,
  CardDescriptorResource,
  CategoryResource,
  CreateAccount,
  CreateAccountDescriptor,
  CreateAccountReferenceMonth,
  CreateCardDescriptor,
  CreateCategory,
  CreateInstitution,
  CreateParty,
  InstitutionResource,
  PartyResource,
  UpdateAccount,
  UpdateAccountDescriptor,
  UpdateAccountReferenceMonth,
  UpdateCardDescriptor,
  UpdateCategory,
  UpdateInstitution,
  UpdateParty,
  normalizeResource,
} from "@lastro/contracts";
import type { ExecutionContext } from "@lastro/domain";
import type { Hono } from "hono";
import type { z } from "zod";
import type { RouteDeps } from "./shared";

export function register(app: Hono, deps: RouteDeps) {
  const { opts, application, v1Context, v1Failure, v1Unauthorized } = deps;
  /*
   * Catalog CRUD. These four resources behave identically — list, create,
   * patch, delete, all Book-scoped — so they are registered from one
   * description rather than four near-identical copies. PATCH only touches the
   * fields present in the body; the update schemas reject an empty one.
   */
  function registerCatalogRoutes(entity: {
    path: string;
    resource: z.ZodType<Record<string, unknown>>;
    create: z.ZodType<Record<string, unknown>>;
    update: z.ZodType<Record<string, unknown>>;
    list: (context: ExecutionContext) => Promise<unknown[]>;
    add: (input: Record<string, unknown>) => Promise<unknown>;
    edit: (input: Record<string, unknown>) => Promise<unknown>;
    remove: (input: Record<string, unknown>) => Promise<void>;
  }) {
    const base = `/v1/books/:bookId/${entity.path}`;

    app.get(base, async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      try {
        const items = await entity.list(context);
        return c.json({
          items: items.map((item) =>
            entity.resource.parse(
              normalizeResource(item as Record<string, unknown>),
            ),
          ),
        });
      } catch (error) {
        return v1Failure(c, error);
      }
    });

    app.post(base, async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      const input = entity.create.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!input.success) return v1Failure(c, input.error);
      try {
        const created = await entity.add({ context, ...input.data });
        return c.json(
          entity.resource.parse(
            normalizeResource(created as Record<string, unknown>),
          ),
          201,
        );
      } catch (error) {
        return v1Failure(c, error);
      }
    });

    app.patch(`${base}/:id`, async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      const input = entity.update.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!input.success) return v1Failure(c, input.error);
      try {
        const updated = await entity.edit({
          context,
          id: c.req.param("id"),
          ...input.data,
        });
        return c.json(
          entity.resource.parse(
            normalizeResource(updated as Record<string, unknown>),
          ),
        );
      } catch (error) {
        return v1Failure(c, error);
      }
    });

    app.delete(`${base}/:id`, async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      try {
        await entity.remove({ context, id: c.req.param("id") });
        return c.body(null, 204);
      } catch (error) {
        return v1Failure(c, error);
      }
    });
  }

  registerCatalogRoutes({
    path: "institutions",
    resource: InstitutionResource,
    create: CreateInstitution,
    update: UpdateInstitution,
    list: (context) => application.listInstitutions(context),
    add: (input) =>
      application.createInstitution(input as CreateInstitutionCommand),
    edit: (input) =>
      application.updateInstitution(input as UpdateInstitutionCommand),
    remove: (input) => application.deleteInstitution(input as DeleteCommand),
  });

  registerCatalogRoutes({
    path: "accounts",
    resource: AccountResource,
    create: CreateAccount,
    update: UpdateAccount,
    list: (context) => application.listAccounts(context),
    add: (input) => application.createAccount(input as CreateAccountCommand),
    edit: (input) => application.updateAccount(input as UpdateAccountCommand),
    remove: (input) => application.deleteAccount(input as DeleteCommand),
  });

  registerCatalogRoutes({
    path: "parties",
    resource: PartyResource,
    create: CreateParty,
    update: UpdateParty,
    list: (context) => application.listParties(context),
    add: (input) => application.createParty(input as CreatePartyCommand),
    edit: (input) => application.updateParty(input as UpdatePartyCommand),
    remove: (input) => application.deleteParty(input as DeleteCommand),
  });

  registerCatalogRoutes({
    path: "account-reference-months",
    resource: AccountReferenceMonthResource,
    create: CreateAccountReferenceMonth,
    update: UpdateAccountReferenceMonth,
    list: (context) => application.listAccountReferenceMonths(context),
    add: (input) =>
      application.createAccountReferenceMonth(
        input as CreateAccountReferenceMonthCommand,
      ),
    edit: (input) =>
      application.updateAccountReferenceMonth(
        input as UpdateAccountReferenceMonthCommand,
      ),
    remove: (input) =>
      application.deleteAccountReferenceMonth(input as DeleteCommand),
  });

  registerCatalogRoutes({
    path: "card-descriptors",
    resource: CardDescriptorResource,
    create: CreateCardDescriptor,
    update: UpdateCardDescriptor,
    list: (context) => application.listCardDescriptors(context),
    add: (input) =>
      application.createCardDescriptor(input as CreateCardDescriptorCommand),
    edit: (input) =>
      application.updateCardDescriptor(input as UpdateCardDescriptorCommand),
    remove: (input) => application.deleteCardDescriptor(input as DeleteCommand),
  });

  registerCatalogRoutes({
    path: "account-descriptors",
    resource: AccountDescriptorResource,
    create: CreateAccountDescriptor,
    update: UpdateAccountDescriptor,
    list: (context) => application.listAccountDescriptors(context),
    add: (input) =>
      application.createAccountDescriptor(
        input as CreateAccountDescriptorCommand,
      ),
    edit: (input) =>
      application.updateAccountDescriptor(
        input as UpdateAccountDescriptorCommand,
      ),
    remove: (input) =>
      application.deleteAccountDescriptor(input as DeleteCommand),
  });

  registerCatalogRoutes({
    path: "categories",
    resource: CategoryResource,
    create: CreateCategory,
    update: UpdateCategory,
    list: (context) => application.listCategories(context),
    add: (input) => application.createCategory(input as CreateCategoryCommand),
    edit: (input) => application.updateCategory(input as UpdateCategoryCommand),
    remove: (input) => application.deleteCategory(input as DeleteCommand),
  });
}
