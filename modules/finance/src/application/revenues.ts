/** The revenue cycle's and transfers' use cases. */
import {
  type BoundOperation,
  type ExecutionContext,
  InvalidRequestError,
  type Scope,
  UnauthorizedError,
  bind,
  dateFromText,
} from "@lastro/kernel";
import * as contracts from "../contracts/revenues";
import { isDeduction } from "../domain/catalog";
import {
  type PaymentMethod,
  type Receipt,
  type Revenue,
  SignedItemError,
  settlementPosition,
} from "../domain/records";
import type { CatalogPort, RevenuePort } from "./port";

type BookScope = Scope<ExecutionContext>;

const instant = (value: string | null | undefined) =>
  value == null ? null : new Date(value);
const day = (value: string | null | undefined) =>
  value == null ? null : dateFromText(value);
const nextCursor = <T extends { id: string }>(items: T[], limit: number) =>
  items.length === limit ? (items.at(-1)?.id ?? null) : null;

export function createRevenues(port: CatalogPort & RevenuePort): {
  handlers: BoundOperation[];
} {
  const book = (scope: BookScope) => scope.context.bookId;

  async function revenueOf(scope: BookScope, id: string): Promise<Revenue> {
    const revenue = await port.revenues.get(scope.handle, book(scope), id);
    if (!revenue) throw new UnauthorizedError();
    return revenue;
  }

  async function receiptOf(scope: BookScope, id: string): Promise<Receipt> {
    const receipt = await port.receipts.get(scope.handle, book(scope), id);
    if (!receipt) throw new UnauthorizedError();
    return receipt;
  }

  return {
    handlers: [
      bind(contracts.createRevenue, async ({ scope, input }) => {
        const categories = await port.financialCategories.list(
          scope.handle,
          book(scope),
        );
        const category = categories.find(
          (each) => each.id === input.financialCategoryId,
        );
        if (!category || category.kind !== "REVENUE")
          throw new InvalidRequestError(
            "financialCategoryId must be a REVENUE financial category of this Book",
          );
        if (isDeduction(category.id, categories))
          throw new SignedItemError(
            "a DEDUCTION financial category holds deductions, recorded with the revenue they reduce",
          );
        if (!(await port.parties.get(scope.handle, book(scope), input.partyId)))
          throw new InvalidRequestError("partyId names no party of this Book");
        const revenue = await port.revenues.insert(scope.handle, book(scope), {
          key: input.key,
          partyId: input.partyId,
          financialCategoryId: input.financialCategoryId,
          name: input.name ?? null,
          amount: BigInt(input.amount),
          currency: input.currency,
          referenceMonth: dateFromText(input.referenceMonth),
          occurredOn: day(input.occurredOn),
          occurredAt: instant(input.occurredAt),
        });
        scope.audit({
          action: "revenue.created",
          resourceType: "revenue",
          resourceId: revenue.id,
          payload: { ...input },
        });
        return revenue;
      }),

      bind(contracts.listRevenues, async ({ scope, input }) => {
        const items = await port.revenues.list(scope.handle, book(scope), {
          after: input.cursor,
          limit: input.limit,
          referenceMonth: input.referenceMonth
            ? dateFromText(input.referenceMonth)
            : undefined,
        });
        return { items, nextCursor: nextCursor(items, input.limit) };
      }),

      bind(contracts.getRevenue, async ({ scope, input }) => {
        const revenue = await revenueOf(scope, input.id);
        const settlements = await port.revenueSettlements.list(
          scope.handle,
          book(scope),
          {
            revenueId: revenue.id,
          },
        );
        return {
          revenue,
          settlements,
          ...settlementPosition(revenue.amount, settlements),
        };
      }),

      bind(contracts.createReceipt, async ({ scope, input }) => {
        const receipt = await port.receipts.insert(scope.handle, book(scope), {
          accountId: input.accountId,
          key: input.key ?? null,
          method: (input.method ?? null) as PaymentMethod | null,
          currency: input.currency,
          referenceMonth: dateFromText(input.referenceMonth),
          dueOn: day(input.dueOn),
          dueAt: instant(input.dueAt),
          paidOn: day(input.paidOn),
          paidAt: instant(input.paidAt),
        });
        scope.audit({
          action: "receipt.created",
          resourceType: "receipt",
          resourceId: receipt.id,
          payload: { ...input },
        });
        return receipt;
      }),

      bind(contracts.listReceipts, async ({ scope, input }) => {
        const items = await port.receipts.list(scope.handle, book(scope), {
          after: input.cursor,
          limit: input.limit,
          accountId: input.accountId,
        });
        return { items, nextCursor: nextCursor(items, input.limit) };
      }),

      bind(contracts.getReceipt, async ({ scope, input }) => {
        const receipt = await receiptOf(scope, input.id);
        return {
          receipt,
          settlements: await port.revenueSettlements.list(
            scope.handle,
            book(scope),
            {
              receiptId: receipt.id,
            },
          ),
        };
      }),

      bind(contracts.settleRevenue, async ({ scope, input }) =>
        settle(scope, {
          revenue: await revenueOf(scope, input.revenueId),
          receipt: await receiptOf(scope, input.receiptId),
          amount: input.amount,
          description: input.description ?? null,
        }),
      ),

      bind(contracts.receiveRevenue, async ({ scope, input }) => {
        const revenue = await revenueOf(scope, input.revenueId);
        const receipt = await port.receipts.insert(scope.handle, book(scope), {
          accountId: input.accountId,
          key: null,
          method: (input.method ?? null) as PaymentMethod | null,
          currency: revenue.currency,
          referenceMonth: revenue.referenceMonth,
          dueOn: day(input.paidOn),
          dueAt: instant(input.paidAt),
          paidOn: day(input.paidOn),
          paidAt: instant(input.paidAt),
        });
        scope.audit({
          action: "receipt.created",
          resourceType: "receipt",
          resourceId: receipt.id,
          payload: { revenueId: revenue.id, accountId: input.accountId },
        });
        return settle(scope, {
          revenue,
          receipt,
          amount: input.amount,
          description: null,
        });
      }),

      bind(contracts.voidRevenueSettlement, async ({ scope, input }) => {
        const target = await port.revenueSettlements.get(
          scope.handle,
          book(scope),
          input.id,
        );
        if (!target || target.voidedAt) throw new UnauthorizedError();
        await port.lockRevenueSet(
          scope.handle,
          book(scope),
          target.revenueId,
          target.receiptId,
        );
        const by = {
          voidedBy: scope.context.agentPrincipal ?? scope.context.actorId,
          voidReason: input.voidReason ?? null,
        };
        const settlement = await port.revenueSettlements.void(
          scope.handle,
          book(scope),
          target.id,
          by,
        );
        if (!settlement) throw new UnauthorizedError();
        scope.audit({
          action: "revenue_settlement.voided",
          resourceType: "revenue_settlement",
          resourceId: settlement.id,
          payload: { ...by },
        });
        return settlement;
      }),

      bind(contracts.createTransfer, async ({ scope, input }) => {
        for (const field of [
          "sourceAccountId",
          "destinationAccountId",
        ] as const) {
          if (
            !(await port.accounts.get(scope.handle, book(scope), input[field]))
          )
            throw new InvalidRequestError(
              `${field} names no account of this Book`,
            );
        }
        const transfer = await port.transfers.insert(
          scope.handle,
          book(scope),
          {
            key: input.key,
            sourceAccountId: input.sourceAccountId,
            destinationAccountId: input.destinationAccountId,
            name: input.name ?? null,
            amount: BigInt(input.amount),
            currency: input.currency,
            referenceMonth: dateFromText(input.referenceMonth),
            occurredOn: day(input.occurredOn),
            occurredAt: instant(input.occurredAt),
          },
        );
        scope.audit({
          action: "transfer.created",
          resourceType: "transfer",
          resourceId: transfer.id,
          payload: { ...input },
        });
        return transfer;
      }),

      bind(contracts.listTransfers, async ({ scope, input }) => {
        const items = await port.transfers.list(scope.handle, book(scope), {
          after: input.cursor,
          limit: input.limit,
          accountId: input.accountId,
        });
        return { items, nextCursor: nextCursor(items, input.limit) };
      }),
    ],
  };

  async function settle(
    scope: BookScope,
    input: {
      revenue: Revenue;
      receipt: Receipt;
      amount: string;
      description: string | null;
    },
  ) {
    const { revenue, receipt } = input;
    if (revenue.amount < 0n)
      throw new SignedItemError(
        "a deduction is settled with the revenue it reduces",
      );
    if (revenue.currency !== receipt.currency)
      throw new InvalidRequestError(
        `the revenue is in ${revenue.currency} and the receipt in ${receipt.currency}`,
      );
    await port.lockRevenueSet(
      scope.handle,
      book(scope),
      revenue.id,
      receipt.id,
    );
    // A revenue states its amount (ADR 7): its shares never exceed it.
    const { outstanding } = settlementPosition(
      revenue.amount,
      await port.revenueSettlements.list(scope.handle, book(scope), {
        revenueId: revenue.id,
      }),
    );
    if (BigInt(input.amount) > outstanding)
      throw new SignedItemError(
        `the share of ${input.amount} exceeds the ${outstanding} still open on the revenue`,
      );
    const settlement = await port.revenueSettlements.insert(
      scope.handle,
      book(scope),
      {
        revenueId: revenue.id,
        receiptId: receipt.id,
        amount: BigInt(input.amount),
        currency: revenue.currency,
        description: input.description ?? null,
      },
    );
    scope.audit({
      action: "revenue_settlement.created",
      resourceType: "revenue_settlement",
      resourceId: settlement.id,
      payload: {
        revenueId: revenue.id,
        receiptId: receipt.id,
        amount: input.amount,
      },
    });
    return {
      settlement,
      receipt: await receiptOf(scope, receipt.id),
      revenue: await revenueOf(scope, revenue.id),
    };
  }
}
