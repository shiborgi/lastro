/**
 * Money moving between two accounts of the same Book, which is neither an
 * expense nor a revenue.
 */
import type { AuditEvent, Transfer } from "@lastro/domain";

export type TransferRepository = {
  createTransfer: (
    input: {
      bookId: string;
      key: string;
      referenceMonth: Date;
      sourceAccountId: string;
      destinationAccountId: string;
      name?: string | null;
      amount: bigint;
      currency: string;
      occurredAt?: Date;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<Transfer>;
  listTransfers: (bookId: string) => Promise<Transfer[]>;
  getTransferByKey: (bookId: string, key: string) => Promise<Transfer | null>;
};
