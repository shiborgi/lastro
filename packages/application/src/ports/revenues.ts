/**
 * The revenue cycle: the earning, the receipt that realises it, and the
 * settlements that link the two.
 */
import type {
  AuditEvent,
  PaymentMethod,
  Receipt,
  Revenue,
  RevenueSettlement,
} from "@lastro/domain";
import type { FinancialRevenue } from "../types";

export type RevenueRepository = {
  createRevenue: (
    input: {
      bookId: string;
      key: string;
      referenceMonth: Date;
      partyId: string;
      categoryId: string;
      name?: string | null;
      amount: bigint;
      currency: string;
      occurredAt?: Date;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<Revenue>;
  listRevenues: (bookId: string) => Promise<Revenue[]>;
  getRevenue: (bookId: string, id: string) => Promise<FinancialRevenue | null>;
  getRevenueByKey: (bookId: string, key: string) => Promise<Revenue | null>;
  listPendingRevenues: (bookId: string) => Promise<FinancialRevenue[]>;
  createReceipt: (
    input: {
      bookId: string;
      accountId: string;
      key?: string | null;
      method?: PaymentMethod | null;
      referenceMonth: Date;
      amount: bigint;
      currency: string;
      dueAt: Date;
      paidAt?: Date;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<Receipt>;
  listReceipts: (bookId: string) => Promise<Receipt[]>;
  getReceiptByKey: (bookId: string, key: string) => Promise<Receipt | null>;
  createRevenueSettlement: (
    input: {
      bookId: string;
      revenueId: string;
      receiptId: string;
      amount: bigint;
      currency: string;
      /** Optional note about this allocation. */
      description?: string | null;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<RevenueSettlement>;
  voidRevenueSettlement: (
    input: {
      bookId: string;
      id: string;
      voidedBy: string;
      voidReason?: string;
    },
    audit: AuditEvent,
  ) => Promise<RevenueSettlement>;
  listRevenueSettlements: (
    bookId: string,
    revenueId?: string,
  ) => Promise<RevenueSettlement[]>;
};
