/**
 * Who is acting, on which Book, and what that role may do.
 *
 * `operations` is a closed map: a command asserts an entry in it, so a surface
 * that forgets to authorize does not compile against a missing name. The role
 * matrix is the whole access model — there are no per-record permissions.
 */
import { ForbiddenError, InvalidExecutionContextError } from "./errors";
export const roles = ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const;
export type Role = (typeof roles)[number];

export const sources = ["WEB", "API", "MCP", "WORKER"] as const;
export type Source = (typeof sources)[number];

export const actorTypes = ["USER", "ASSISTANT", "SYSTEM"] as const;
export type ActorType = (typeof actorTypes)[number];

export type ExecutionContext = {
  actorId: string;
  bookId: string;
  role: Role;
  source: Source;
  correlationId: string;
  idempotencyKey?: string;
  actorType?: ActorType;
  agentPrincipal?: string;
  delegatedOperator?: string;
};

export const operations = {
  listBooks: "LIST_BOOKS",
  listInstitutions: "LIST_INSTITUTIONS",
  createInstitution: "CREATE_INSTITUTION",
  updateInstitution: "UPDATE_INSTITUTION",
  deleteInstitution: "DELETE_INSTITUTION",
  listAccounts: "LIST_ACCOUNTS",
  createAccount: "CREATE_ACCOUNT",
  updateAccount: "UPDATE_ACCOUNT",
  deleteAccount: "DELETE_ACCOUNT",
  listParties: "LIST_PARTIES",
  createParty: "CREATE_PARTY",
  updateParty: "UPDATE_PARTY",
  deleteParty: "DELETE_PARTY",
  /*
   * One set of operations for both descriptor tables. Mapping a card
   * descriptor and mapping an account descriptor are the same authority over
   * the same kind of decision; which table a call touched is recorded on the
   * audit event's own resource, not in the operation's name.
   */
  listDescriptors: "LIST_DESCRIPTORS",
  createDescriptor: "CREATE_DESCRIPTOR",
  updateDescriptor: "UPDATE_DESCRIPTOR",
  deleteDescriptor: "DELETE_DESCRIPTOR",
  listAccountReferenceMonths: "LIST_ACCOUNT_REFERENCE_MONTHS",
  createAccountReferenceMonth: "CREATE_ACCOUNT_REFERENCE_MONTH",
  updateAccountReferenceMonth: "UPDATE_ACCOUNT_REFERENCE_MONTH",
  deleteAccountReferenceMonth: "DELETE_ACCOUNT_REFERENCE_MONTH",
  listCategories: "LIST_CATEGORIES",
  createCategory: "CREATE_CATEGORY",
  updateCategory: "UPDATE_CATEGORY",
  deleteCategory: "DELETE_CATEGORY",
  createExpense: "CREATE_EXPENSE",
  listExpenses: "LIST_EXPENSES",
  voidExpenseSettlement: "VOID_EXPENSE_SETTLEMENT",
  createRevenue: "CREATE_REVENUE",
  listRevenues: "LIST_REVENUES",
  createReceipt: "CREATE_RECEIPT",
  listReceipts: "LIST_RECEIPTS",
  createRevenueSettlement: "CREATE_REVENUE_SETTLEMENT",
  listRevenueSettlements: "LIST_REVENUE_SETTLEMENTS",
  voidRevenueSettlement: "VOID_REVENUE_SETTLEMENT",
  createTransfer: "CREATE_TRANSFER",
  listTransfers: "LIST_TRANSFERS",
  importStatement: "IMPORT_STATEMENT",
  listMovements: "LIST_MOVEMENTS",
  reviewMovement: "REVIEW_MOVEMENT",
  manageAgentCredentials: "MANAGE_AGENT_CREDENTIALS",
} as const;

export type Operation = (typeof operations)[keyof typeof operations];

const readOperations = new Set<Operation>([
  operations.listBooks,
  operations.listInstitutions,
  operations.listAccounts,
  operations.listParties,
  operations.listDescriptors,
  operations.listAccountReferenceMonths,
  operations.listCategories,
  operations.listExpenses,
  operations.listRevenues,
  operations.listReceipts,
  operations.listRevenueSettlements,
  operations.listTransfers,
  operations.listMovements,
]);

const financialWriteOperations = new Set<Operation>([
  operations.createInstitution,
  operations.updateInstitution,
  operations.deleteInstitution,
  operations.createAccount,
  operations.updateAccount,
  operations.deleteAccount,
  operations.createParty,
  operations.updateParty,
  operations.deleteParty,
  operations.createDescriptor,
  operations.updateDescriptor,
  operations.deleteDescriptor,
  operations.createAccountReferenceMonth,
  operations.updateAccountReferenceMonth,
  operations.deleteAccountReferenceMonth,
  operations.createCategory,
  operations.updateCategory,
  operations.deleteCategory,
  operations.createExpense,
  operations.voidExpenseSettlement,
  operations.createRevenue,
  operations.createReceipt,
  operations.createRevenueSettlement,
  operations.voidRevenueSettlement,
  operations.createTransfer,
  /*
   * Staging a statement and reviewing what it staged are bookkeeping, so an
   * EDITOR does them. Neither creates an economic fact: the import records
   * what a file said, and review moves a row between PENDING, IGNORED and
   * POSTED. The expense a promotion creates goes through `createExpense`,
   * which is separately authorized.
   */
  operations.importStatement,
  operations.reviewMovement,
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertExecutionContext(input: unknown): ExecutionContext {
  if (!input || typeof input !== "object") {
    throw new InvalidExecutionContextError("context");
  }
  const context = input as Record<string, unknown>;
  for (const field of [
    "actorId",
    "bookId",
    "role",
    "source",
    "correlationId",
  ]) {
    if (!isNonEmptyString(context[field])) {
      throw new InvalidExecutionContextError(field);
    }
  }
  if (!roles.includes(context.role as Role)) {
    throw new InvalidExecutionContextError("role");
  }
  if (!sources.includes(context.source as Source)) {
    throw new InvalidExecutionContextError("source");
  }
  return context as unknown as ExecutionContext;
}

export function canPerform(role: Role, operation: Operation): boolean {
  if (readOperations.has(operation)) return true;
  if (role === "OWNER") return true;
  if (role === "ADMIN") return true;
  if (role === "EDITOR") return financialWriteOperations.has(operation);
  return false;
}

export function assertAuthorized(
  context: ExecutionContext,
  operation: Operation,
): void {
  if (!canPerform(context.role, operation)) throw new ForbiddenError();
}
