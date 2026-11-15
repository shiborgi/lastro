/** The catalogs' use cases: the rules that apply before a row is written. */
import {
  type BoundOperation,
  type CrudStore,
  type ExecutionContext,
  type Scope,
  UnauthorizedError,
  bindCrud,
  dateFromText,
} from "@lastro/kernel";
import * as contracts from "../contracts/catalog";
import type {
  Account,
  AccountCycle,
  FinancialCategory,
  FinancialCategoryKind,
  Institution,
  Party,
} from "../domain/catalog";
import type { CatalogPort, CatalogTable } from "./port";

type Fields<T> = Omit<T, "id" | "bookId">;
/** Wire input: optional members may be absent, where the record holds null. */
type Input<T> = { [K in keyof Fields<T>]?: Fields<T>[K] | undefined };

const bookOf = (scope: Scope) => (scope.context as ExecutionContext).bookId;

/* A store that only forwards, for resources with no rule beyond the database's. */
function plain<T extends { id: string }, Filter>(
  table: CatalogTable<T, Filter>,
  complete: (input: Input<T>) => Fields<T>,
): CrudStore<T, Input<T>, Partial<Fields<T>>, Filter> {
  return {
    list: (scope, filter) => table.list(scope.handle, bookOf(scope), filter),
    create: (scope, input) =>
      table.insert(scope.handle, bookOf(scope), complete(input)),
    update: (scope, id, patch) =>
      table.update(scope.handle, bookOf(scope), id, patch),
    remove: (scope, id) => table.remove(scope.handle, bookOf(scope), id),
  };
}

type WindowInput = {
  accountId?: string;
  referenceMonth?: string;
  startsOn?: string;
  endsOn?: string;
  dueOn?: string;
};

export type CatalogApi = {
  /** Null when the Book has no such record. */
  getAccount(scope: Scope, id: string): Promise<Account | null>;
  getParty(scope: Scope, id: string): Promise<Party | null>;
  getFinancialCategory(
    scope: Scope,
    id: string,
  ): Promise<FinancialCategory | null>;
  listAccounts(scope: Scope): Promise<Account[]>;
  listParties(scope: Scope): Promise<Party[]>;
  listFinancialCategories(
    scope: Scope,
    filter?: { kind?: FinancialCategoryKind },
  ): Promise<FinancialCategory[]>;
};

export function createCatalog(port: CatalogPort): {
  api: CatalogApi;
  handlers: BoundOperation[];
} {
  const parties = plain<Party, Record<string, never>>(
    port.parties,
    (input) => ({
      key: input.key as string,
      name: input.name as string,
      type: input.type as string,
    }),
  );

  const windows: CrudStore<
    AccountCycle,
    WindowInput,
    WindowInput,
    { accountId?: string }
  > = {
    list: (scope, filter) =>
      port.accountCycles.list(scope.handle, bookOf(scope), filter),
    create: (scope, input) =>
      port.accountCycles.insert(scope.handle, bookOf(scope), {
        accountId: input.accountId as string,
        referenceMonth: dateFromText(input.referenceMonth as string),
        startsOn: dateFromText(input.startsOn as string),
        endsOn: dateFromText(input.endsOn as string),
        dueOn: dateFromText(input.dueOn as string),
      }),
    update: (scope, id, patch) =>
      port.accountCycles.update(scope.handle, bookOf(scope), id, {
        ...(patch.referenceMonth === undefined
          ? {}
          : { referenceMonth: dateFromText(patch.referenceMonth) }),
        ...(patch.startsOn === undefined
          ? {}
          : { startsOn: dateFromText(patch.startsOn) }),
        ...(patch.endsOn === undefined
          ? {}
          : { endsOn: dateFromText(patch.endsOn) }),
        ...(patch.dueOn === undefined
          ? {}
          : { dueOn: dateFromText(patch.dueOn) }),
      }),
    remove: (scope, id) =>
      port.accountCycles.remove(scope.handle, bookOf(scope), id),
  };

  return {
    api: {
      getAccount: (scope, id) =>
        port.accounts.get(scope.handle, bookOf(scope), id),
      getParty: (scope, id) =>
        port.parties.get(scope.handle, bookOf(scope), id),
      getFinancialCategory: (scope, id) =>
        port.financialCategories.get(scope.handle, bookOf(scope), id),
      listAccounts: (scope) => port.accounts.list(scope.handle, bookOf(scope)),
      listParties: (scope) =>
        port.parties.list(scope.handle, bookOf(scope), {}),
      listFinancialCategories: (scope, filter) =>
        port.financialCategories.list(scope.handle, bookOf(scope), filter),
    },
    handlers: [
      ...bindCrud(
        contracts.institutions,
        plain<Institution, Record<string, never>>(
          port.institutions,
          (input) => ({
            key: input.key as string,
            name: input.name as string,
          }),
        ),
        "institution",
      ),
      ...bindCrud(
        contracts.accounts,
        plain<Account, Record<string, never>>(port.accounts, (input) => ({
          key: input.key as string,
          name: input.name as string,
          type: input.type as Account["type"],
          institutionId: input.institutionId ?? null,
          number: input.number ?? null,
        })),
        "account",
      ),
      ...bindCrud(contracts.accountCycles, windows, "account_cycle"),
      ...bindCrud(contracts.parties, parties, "party"),
      ...bindCrud(
        contracts.financialCategories,
        plain<FinancialCategory, { kind?: FinancialCategoryKind }>(
          port.financialCategories,
          (input) => ({
            name: input.name as string,
            kind: input.kind as FinancialCategoryKind,
            parentId: input.parentId ?? null,
            role: input.role ?? null,
          }),
        ),
        "financial_category",
      ),
    ],
  };
}
