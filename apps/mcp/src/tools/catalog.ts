/**
 * The Books an actor can reach, and CRUD over the catalog entities every
 * financial record points at.
 *
 * Without these an agent can only reference ids it already knows, so it cannot
 * open a Book and start working — which is the whole premise of an MCP-first
 * ledger. The sets are identical in shape, so they register from one
 * description rather than seven near-identical copies.
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
  CreateAccount,
  CreateAccountDescriptor,
  CreateAccountReferenceMonth,
  CreateCardDescriptor,
  CreateCategory,
  CreateInstitution,
  CreateParty,
  Id,
  UpdateAccount,
  UpdateAccountDescriptor,
  UpdateAccountReferenceMonth,
  UpdateCardDescriptor,
  UpdateCategory,
  UpdateInstitution,
  UpdateParty,
} from "@lastro/contracts";
import type { ExecutionContext } from "@lastro/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import {
  type ToolDeps,
  confirmation,
  confirmationRequired,
  error,
  idempotencyKey,
  result,
} from "./shared";

export function register(server: McpServer, deps: ToolDeps) {
  const { application, context, requireBook } = deps;
  /*
   * Catalog entities (institutions, accounts, parties, categories) are the
   * foreign keys every financial record points at. Without these an agent can
   * only reference ids it already knows, so it cannot open a Book and start
   * working — which is the whole premise of an MCP-first ledger. The four sets
   * are identical in shape, so they are registered from one description.
   */
  function registerCatalog(entity: {
    name: string;
    plural: string;
    createShape: z.ZodRawShape;
    updateShape: z.ZodRawShape;
    list: (ctx: ExecutionContext) => Promise<unknown[]>;
    create: (input: Record<string, unknown>) => Promise<unknown>;
    update: (input: Record<string, unknown>) => Promise<unknown>;
    remove: (input: Record<string, unknown>) => Promise<void>;
  }) {
    /*
     * Each entity's field shape is only known at runtime, so the SDK cannot
     * infer a callback signature from it. Zod still validates every field
     * against the registered schema before a handler runs — this alias only
     * describes the fields to TypeScript.
     */
    type CatalogArgs = {
      bookId: string;
      idempotencyKey: string;
      id: string;
      confirmation?: "confirm";
    } & Record<string, unknown>;
    const typed = (fn: (args: CatalogArgs) => unknown) =>
      fn as unknown as Parameters<typeof server.registerTool>[2];

    server.registerTool(
      `list_${entity.plural}`,
      {
        description: `List the ${entity.plural} defined in an explicitly selected Book.`,
        annotations: { readOnlyHint: true },
        inputSchema: { bookId: Id },
      },
      typed(async ({ bookId }) => {
        try {
          requireBook(bookId);
          return result({ items: await entity.list(context) });
        } catch (cause) {
          return error(
            cause instanceof Error ? cause.message : "request failed",
          );
        }
      }),
    );

    server.registerTool(
      `create_${entity.name}`,
      {
        description: `Create a ${entity.name} in an explicitly selected Book.`,
        annotations: { idempotentHint: true },
        inputSchema: { bookId: Id, idempotencyKey, ...entity.createShape },
      },
      typed(async ({ bookId, idempotencyKey: key, ...input }) => {
        try {
          requireBook(bookId);
          return result(
            await entity.create({
              context: { ...context, idempotencyKey: key },
              ...input,
            }),
          );
        } catch (cause) {
          return error(
            cause instanceof Error ? cause.message : "request failed",
          );
        }
      }),
    );

    server.registerTool(
      `update_${entity.name}`,
      {
        description: `Update a ${entity.name}. Only the supplied fields change.`,
        annotations: { idempotentHint: true },
        inputSchema: {
          bookId: Id,
          idempotencyKey,
          id: Id,
          ...entity.updateShape,
        },
      },
      typed(async ({ bookId, idempotencyKey: key, ...input }) => {
        try {
          requireBook(bookId);
          return result(
            await entity.update({
              context: { ...context, idempotencyKey: key },
              ...input,
            }),
          );
        } catch (cause) {
          return error(
            cause instanceof Error ? cause.message : "request failed",
          );
        }
      }),
    );

    server.registerTool(
      `delete_${entity.name}`,
      {
        description: `Delete a ${entity.name}. Requires confirmation because records referencing it will block the delete.`,
        annotations: { destructiveHint: true },
        inputSchema: {
          bookId: Id,
          idempotencyKey,
          id: Id,
          confirmation: confirmation.optional(),
        },
      },
      typed(
        async ({
          bookId,
          idempotencyKey: key,
          id,
          confirmation: confirmed,
        }) => {
          try {
            requireBook(bookId);
            if (confirmed !== "confirm") {
              return confirmationRequired(`delete_${entity.name}`);
            }
            await entity.remove({
              context: { ...context, idempotencyKey: key },
              id,
            });
            return result({ deleted: true, id });
          } catch (cause) {
            return error(
              cause instanceof Error ? cause.message : "request failed",
            );
          }
        },
      ),
    );
  }

  server.registerTool(
    "list_books",
    {
      description: "List the authenticated actor's accessible Books.",
      annotations: { readOnlyHint: true },
      inputSchema: { bookId: Id },
    },
    async ({ bookId }) => {
      try {
        requireBook(bookId);
        return result({ books: await application.listBooks(context) });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  registerCatalog({
    name: "institution",
    plural: "institutions",
    createShape: CreateInstitution.shape,
    updateShape: UpdateInstitution.shape,
    list: (ctx) => application.listInstitutions(ctx),
    create: (input) =>
      application.createInstitution(input as CreateInstitutionCommand),
    update: (input) =>
      application.updateInstitution(input as UpdateInstitutionCommand),
    remove: (input) => application.deleteInstitution(input as DeleteCommand),
  });

  registerCatalog({
    name: "account",
    plural: "accounts",
    createShape: CreateAccount.shape,
    updateShape: UpdateAccount.shape,
    list: (ctx) => application.listAccounts(ctx),
    create: (input) => application.createAccount(input as CreateAccountCommand),
    update: (input) => application.updateAccount(input as UpdateAccountCommand),
    remove: (input) => application.deleteAccount(input as DeleteCommand),
  });

  registerCatalog({
    name: "party",
    plural: "parties",
    createShape: CreateParty.shape,
    updateShape: UpdateParty.shape,
    list: (ctx) => application.listParties(ctx),
    create: (input) => application.createParty(input as CreatePartyCommand),
    update: (input) => application.updateParty(input as UpdatePartyCommand),
    remove: (input) => application.deleteParty(input as DeleteCommand),
  });

  /*
   * A card's billing cycles. Registered by hand because no statement states
   * them, and read by promotion to decide which invoice a purchase lands on.
   */
  registerCatalog({
    name: "account_reference_month",
    plural: "account_reference_months",
    createShape: CreateAccountReferenceMonth.shape,
    updateShape: UpdateAccountReferenceMonth.shape,
    list: (ctx) => application.listAccountReferenceMonths(ctx),
    create: (input) =>
      application.createAccountReferenceMonth(
        input as CreateAccountReferenceMonthCommand,
      ),
    update: (input) =>
      application.updateAccountReferenceMonth(
        input as UpdateAccountReferenceMonthCommand,
      ),
    remove: (input) =>
      application.deleteAccountReferenceMonth(input as DeleteCommand),
  });

  /*
   * Two descriptor catalogs, because the two statement kinds do not answer the
   * same questions: a card descriptor names a party and a category, an account
   * descriptor also names the rail the money took and, for a transfer, the
   * account on the other side.
   */
  registerCatalog({
    name: "card_descriptor",
    plural: "card_descriptors",
    createShape: CreateCardDescriptor.shape,
    updateShape: UpdateCardDescriptor.shape,
    list: (ctx) => application.listCardDescriptors(ctx),
    create: (input) =>
      application.createCardDescriptor(input as CreateCardDescriptorCommand),
    update: (input) =>
      application.updateCardDescriptor(input as UpdateCardDescriptorCommand),
    remove: (input) => application.deleteCardDescriptor(input as DeleteCommand),
  });

  registerCatalog({
    name: "account_descriptor",
    plural: "account_descriptors",
    createShape: CreateAccountDescriptor.shape,
    updateShape: UpdateAccountDescriptor.shape,
    list: (ctx) => application.listAccountDescriptors(ctx),
    create: (input) =>
      application.createAccountDescriptor(
        input as CreateAccountDescriptorCommand,
      ),
    update: (input) =>
      application.updateAccountDescriptor(
        input as UpdateAccountDescriptorCommand,
      ),
    remove: (input) =>
      application.deleteAccountDescriptor(input as DeleteCommand),
  });

  registerCatalog({
    name: "category",
    plural: "categories",
    createShape: CreateCategory.shape,
    updateShape: UpdateCategory.shape,
    list: (ctx) => application.listCategories(ctx),
    create: (input) =>
      application.createCategory(input as CreateCategoryCommand),
    update: (input) =>
      application.updateCategory(input as UpdateCategoryCommand),
    remove: (input) => application.deleteCategory(input as DeleteCommand),
  });
}
