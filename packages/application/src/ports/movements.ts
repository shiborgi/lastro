/**
 * Staged statement rows, and the summary read over them. Nothing here writes
 * an economic fact — promotion goes through the cycle ports.
 */
import type {
  AccountMovement,
  AuditEvent,
  BookInsights,
  CardMovement,
  MovementStatus,
} from "@lastro/domain";

export type MovementRepository = {
  bookInsights: (bookId: string) => Promise<BookInsights>;
  insertCardMovements: (
    rows: Omit<CardMovement, "id" | "importedAt">[],
  ) => Promise<CardMovement[]>;
  insertAccountMovements: (
    rows: Omit<AccountMovement, "id" | "importedAt">[],
  ) => Promise<AccountMovement[]>;
  listCardMovements: (
    bookId: string,
    status?: MovementStatus,
  ) => Promise<CardMovement[]>;
  listAccountMovements: (
    bookId: string,
    status?: MovementStatus,
  ) => Promise<AccountMovement[]>;
  getCardMovement: (bookId: string, id: string) => Promise<CardMovement | null>;
  getAccountMovement: (
    bookId: string,
    id: string,
  ) => Promise<AccountMovement | null>;
  setCardMovementStatus: (
    input: {
      bookId: string;
      id: string;
      status: MovementStatus;
      expenseId?: string | null;
      revenueId?: string | null;
      transferId?: string | null;
    },
    audit: AuditEvent,
  ) => Promise<CardMovement>;
  setAccountMovementStatus: (
    input: {
      bookId: string;
      id: string;
      status: MovementStatus;
      expenseId?: string | null;
      revenueId?: string | null;
      transferId?: string | null;
    },
    audit: AuditEvent,
  ) => Promise<AccountMovement>;
};
