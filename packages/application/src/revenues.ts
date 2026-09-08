import {
  ConflictError,
  type FinancialStatus,
  type Money,
  type Receipt,
  type Revenue,
  type RevenueSettlement,
  assertAuthorized,
  availableBalance,
  financialStatus,
  operations,
} from "@lastro/domain";
import {
  auditFor,
  contextFor,
  method,
  page,
  requirePositiveMoney,
  requireText,
} from "./helpers";
import type {
  ApplicationRepository,
  CreateReceiptCommand,
  CreateRevenueCommand,
  CreateRevenueSettlementCommand,
  ExpenseQuery,
  FinancialRevenue,
  PageQuery,
  Page as PageType,
  VoidRevenueSettlementCommand,
} from "./types";

function requireRevenue(revenue: FinancialRevenue | null): FinancialRevenue {
  if (!revenue) throw new Error("revenue was not found");
  return revenue;
}

export function createRevenueMethods(repository: ApplicationRepository) {
  return {
    async createRevenue(input: CreateRevenueCommand): Promise<Revenue> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createRevenue);
      requireText(input.key, "key");
      requireText(input.partyId, "partyId");
      requireText(input.categoryId, "categoryId");
      requirePositiveMoney(input.amount, input.currency);
      return method(repository, "createRevenue")(
        {
          bookId: context.bookId,
          key: input.key,
          referenceMonth: input.referenceMonth,
          partyId: input.partyId,
          categoryId: input.categoryId,
          amount: input.amount,
          currency: input.currency,
          occurredAt: input.occurredAt,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "revenue.created", "revenue", {
          key: input.key,
          partyId: input.partyId,
          categoryId: input.categoryId,
        }),
      );
    },

    async listRevenues(contextInput: unknown): Promise<Revenue[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listRevenues);
      return method(repository, "listRevenues")(context.bookId);
    },

    async listRevenuesPage(input: PageQuery): Promise<PageType<Revenue>> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenues);
      return page(
        await method(repository, "listRevenues")(context.bookId),
        input.cursor,
        input.limit,
      );
    },

    async createReceipt(input: CreateReceiptCommand): Promise<Receipt> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createReceipt);
      requireText(input.accountId, "accountId");
      requirePositiveMoney(input.amount, input.currency);
      if (
        !(input.dueAt instanceof Date) ||
        Number.isNaN(input.dueAt.valueOf())
      ) {
        throw new ConflictError();
      }
      return method(repository, "createReceipt")(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          referenceMonth: input.referenceMonth,
          amount: input.amount,
          currency: input.currency,
          dueAt: input.dueAt,
          paidAt: input.paidAt,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "receipt.created", "receipt", {
          accountId: input.accountId,
          referenceMonth: input.referenceMonth.toISOString(),
          amount: input.amount.toString(),
          currency: input.currency,
          dueAt: input.dueAt.toISOString(),
        }),
      );
    },

    async listReceipts(contextInput: unknown): Promise<Receipt[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listReceipts);
      return method(repository, "listReceipts")(context.bookId);
    },

    async listReceiptsPage(input: PageQuery): Promise<PageType<Receipt>> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listReceipts);
      return page(
        await method(repository, "listReceipts")(context.bookId),
        input.cursor,
        input.limit,
      );
    },

    async createRevenueSettlement(
      input: CreateRevenueSettlementCommand,
    ): Promise<RevenueSettlement> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createRevenueSettlement);
      requireText(input.revenueId, "revenueId");
      requireText(input.receiptId, "receiptId");
      requirePositiveMoney(input.amount, input.currency);
      return method(repository, "createRevenueSettlement")(
        {
          bookId: context.bookId,
          revenueId: input.revenueId,
          receiptId: input.receiptId,
          amount: input.amount,
          currency: input.currency,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "revenue_settlement.created", "revenue_settlement", {
          revenueId: input.revenueId,
          receiptId: input.receiptId,
          amount: input.amount.toString(),
          currency: input.currency,
        }),
      );
    },

    async voidRevenueSettlement(
      input: VoidRevenueSettlementCommand,
    ): Promise<RevenueSettlement> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.voidRevenueSettlement);
      requireText(input.id, "id");
      if (input.voidReason != null) requireText(input.voidReason, "voidReason");
      return method(repository, "voidRevenueSettlement")(
        {
          bookId: context.bookId,
          id: input.id,
          voidedBy: context.agentPrincipal ?? context.actorId,
          voidReason: input.voidReason,
        },
        auditFor(context, "revenue_settlement.voided", "revenue_settlement", {
          id: input.id,
          voidReason: input.voidReason,
        }),
      );
    },

    async getRevenueBalance(input: ExpenseQuery): Promise<Money> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenues);
      requireText(input.id, "id");
      const revenue = requireRevenue(
        await method(repository, "getRevenue")(context.bookId, input.id),
      );
      const total = requirePositiveMoney(revenue.amount, revenue.currency);
      const settlements = await method(repository, "listRevenueSettlements")(
        context.bookId,
        input.id,
      );
      const result = availableBalance(
        total,
        settlements.map((settlement) => ({
          amount: {
            amount: settlement.amount,
            currency: settlement.currency,
          },
          voidedAt: settlement.voidedAt,
        })),
      );
      if (!result.ok) throw result.error;
      return result.value;
    },

    async getRevenueStatus(input: ExpenseQuery): Promise<FinancialStatus> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenues);
      requireText(input.id, "id");
      const revenue = requireRevenue(
        await method(repository, "getRevenue")(context.bookId, input.id),
      );
      const total = requirePositiveMoney(revenue.amount, revenue.currency);
      const settlements = await method(repository, "listRevenueSettlements")(
        context.bookId,
        input.id,
      );
      const result = financialStatus(
        total,
        settlements.map((settlement) => ({
          amount: {
            amount: settlement.amount,
            currency: settlement.currency,
          },
          voidedAt: settlement.voidedAt,
        })),
      );
      if (!result.ok) throw result.error;
      return result.value;
    },

    async listRevenueSettlementHistory(
      input: ExpenseQuery,
    ): Promise<RevenueSettlement[]> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenueSettlements);
      requireText(input.id, "id");
      return method(repository, "listRevenueSettlements")(
        context.bookId,
        input.id,
      );
    },

    async listRevenueSettlementsPage(
      input: PageQuery,
    ): Promise<PageType<RevenueSettlement>> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenueSettlements);
      return page(
        await method(repository, "listRevenueSettlements")(context.bookId),
        input.cursor,
        input.limit,
      );
    },

    async listPendingRevenues(
      contextInput: unknown,
    ): Promise<FinancialRevenue[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listRevenues);
      return method(repository, "listPendingRevenues")(context.bookId);
    },

    async getRevenuePosition(input: PageQuery): Promise<{
      revenues: PageType<{
        revenue: FinancialRevenue;
        outstanding: bigint;
        status: FinancialStatus;
      }>;
      totals: { currency: string; outstanding: bigint; count: number }[];
    }> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenues);
      const revenues = await method(
        repository,
        "listPendingRevenues",
      )(context.bookId);
      const positioned = (
        await Promise.all(
          revenues.map(async (revenue) => ({
            revenue,
            outstanding: (
              await this.getRevenueBalance({ context, id: String(revenue.id) })
            ).amount,
            status: await this.getRevenueStatus({
              context,
              id: String(revenue.id),
            }),
          })),
        )
      ).filter((item) => item.outstanding > 0n);
      const totals = new Map<string, { outstanding: bigint; count: number }>();
      for (const item of positioned) {
        const current = totals.get(item.revenue.currency) ?? {
          outstanding: 0n,
          count: 0,
        };
        current.outstanding += item.outstanding;
        current.count += 1;
        totals.set(item.revenue.currency, current);
      }
      const revenuePage = page(
        positioned.map((item) => ({ ...item, id: item.revenue.id })),
        input.cursor,
        input.limit,
      );
      return {
        revenues: {
          items: revenuePage.items.map(({ id: _id, ...item }) => item),
          nextCursor: revenuePage.nextCursor,
        },
        totals: [...totals].map(([currency, total]) => ({
          currency,
          ...total,
        })),
      };
    },
  };
}
