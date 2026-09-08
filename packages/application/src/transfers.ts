import {
  type Transfer,
  assertAuthorized,
  operations,
  validateTransferPair,
} from "@lastro/domain";
import { auditFor, contextFor, method, requireText } from "./helpers";
import type { ApplicationRepository, CreateTransferCommand } from "./types";

export function createTransferMethods(repository: ApplicationRepository) {
  return {
    async createTransfer(input: CreateTransferCommand): Promise<Transfer> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createTransfer);
      requireText(input.key, "key");
      const pair = validateTransferPair({
        bookId: context.bookId,
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
        amount: input.amount,
        currency: input.currency,
      });
      if (!pair.ok) throw pair.error;
      return method(repository, "createTransfer")(
        {
          bookId: context.bookId,
          key: input.key,
          referenceMonth: input.referenceMonth,
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
          amount: input.amount,
          currency: input.currency,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "transfer.created", "transfer", {
          key: input.key,
          referenceMonth: input.referenceMonth.toISOString(),
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
          amount: input.amount.toString(),
          currency: input.currency,
        }),
      );
    },

    async listTransfers(contextInput: unknown): Promise<Transfer[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listTransfers);
      return method(repository, "listTransfers")(context.bookId);
    },

    async getTransferByCorrelation(
      correlationId: string,
    ): Promise<Transfer | null> {
      return method(repository, "getTransferByCorrelation")(correlationId);
    },

    async getCashFlow(contextInput: unknown): Promise<{
      inflows: { currency: string; amount: bigint; count: number }[];
      outflows: { currency: string; amount: bigint; count: number }[];
      transfers: { currency: string; amount: bigint; count: number }[];
    }> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listReceipts);
      const [receipts, payments, transfers] = await Promise.all([
        method(repository, "listReceipts")(context.bookId),
        method(repository, "listPayments")(context.bookId),
        method(repository, "listTransfers")(context.bookId),
      ]);
      const inflows = new Map<string, { amount: bigint; count: number }>();
      for (const receipt of receipts) {
        const current = inflows.get(receipt.currency) ?? {
          amount: 0n,
          count: 0,
        };
        current.amount += receipt.amount;
        current.count += 1;
        inflows.set(receipt.currency, current);
      }
      const outflows = new Map<string, { amount: bigint; count: number }>();
      for (const payment of payments) {
        const current = outflows.get(payment.currency) ?? {
          amount: 0n,
          count: 0,
        };
        current.amount += payment.amount;
        current.count += 1;
        outflows.set(payment.currency, current);
      }
      const transfersAgg = new Map<string, { amount: bigint; count: number }>();
      for (const transfer of transfers) {
        const current = transfersAgg.get(transfer.currency) ?? {
          amount: 0n,
          count: 0,
        };
        current.amount += transfer.amount;
        current.count += 1;
        transfersAgg.set(transfer.currency, current);
      }
      return {
        inflows: [...inflows].map(([currency, value]) => ({
          currency,
          ...value,
        })),
        outflows: [...outflows].map(([currency, value]) => ({
          currency,
          ...value,
        })),
        transfers: [...transfersAgg].map(([currency, value]) => ({
          currency,
          ...value,
        })),
      };
    },
  };
}
