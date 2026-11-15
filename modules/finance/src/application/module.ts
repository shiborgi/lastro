/** Finance's use cases over its port, and the handlers of its operations. */
import type { BoundOperation, OperationDescriptor } from "@lastro/kernel";
import {
  type AccountMovementsApi,
  type CallOperation,
  createAccountMovements,
} from "./account-movements";
import { type CardsApi, createCards } from "./cards";
import { type CatalogApi, createCatalog } from "./catalog";
import { type ExpensesApi, createExpenses } from "./expenses";
import type { FinancePort } from "./port";
import {
  type RevenueMovementsApi,
  createRevenueMovements,
} from "./revenue-movements";
import { createRevenues } from "./revenues";

export type FinanceApi = {
  catalog: CatalogApi;
  expenses: ExpensesApi;
  accountMovements: AccountMovementsApi;
  cards: CardsApi;
  revenueMovements: RevenueMovementsApi;
};

export function createFinance(port: FinancePort): {
  api: FinanceApi;
  handlers: readonly BoundOperation[];
} {
  const catalog = createCatalog(port);
  const expenses = createExpenses(port);
  const revenues = createRevenues(port);
  const byId = new Map<string, BoundOperation>();
  /* Posting a movement runs finance's own operations, inside the caller's scope. */
  const call: CallOperation = async <T>(
    descriptor: OperationDescriptor,
    scope: Parameters<CallOperation>[1],
    input: unknown,
  ) => {
    const bound = byId.get(descriptor.id);
    if (!bound) throw new Error(`finance has no handler for ${descriptor.id}`);
    return (await bound.handler({
      scope,
      input: descriptor.input.parse(input),
    })) as T;
  };
  const accountMovements = createAccountMovements(port, call);
  const cards = createCards(port, call);
  const revenueMovements = createRevenueMovements(port, call);
  const handlers = [
    ...catalog.handlers,
    ...expenses.handlers,
    ...revenues.handlers,
    ...accountMovements.handlers,
    ...cards.handlers,
    ...revenueMovements.handlers,
  ];
  for (const each of handlers) byId.set(each.descriptor.id, each);
  return {
    api: {
      catalog: catalog.api,
      expenses: expenses.api,
      accountMovements: accountMovements.api,
      cards: cards.api,
      revenueMovements: revenueMovements.api,
    },
    handlers,
  };
}
