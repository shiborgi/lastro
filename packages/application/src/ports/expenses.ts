/**
 * The expense cycle: the debt, the payment that discharges it, and the
 * settlements that link the two.
 */
import type {
  AuditEvent,
  Expense,
  ExpenseSettlement,
  Payment,
} from "@lastro/domain";
import type {
  CreateExpenseSettlementRepositoryInput,
  CreatePaymentRepositoryInput,
  FinancialExpense,
} from "../types";

export type ExpenseRepository = {
  createExpense: (
    input: Omit<Expense, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Expense>;
  listExpenses: (bookId: string) => Promise<Expense[]>;
  getExpense: (bookId: string, id: string) => Promise<FinancialExpense | null>;
  getExpenseByKey: (bookId: string, key: string) => Promise<Expense | null>;
  listPendingExpenses: (bookId: string) => Promise<FinancialExpense[]>;
  createPayment: (
    input: CreatePaymentRepositoryInput,
    audit: AuditEvent,
  ) => Promise<Payment>;
  listPayments: (bookId: string) => Promise<Payment[]>;
  getPaymentByKey: (bookId: string, key: string) => Promise<Payment | null>;
  createExpenseSettlement: (
    input: CreateExpenseSettlementRepositoryInput,
    audit: AuditEvent,
  ) => Promise<ExpenseSettlement>;
  voidExpenseSettlement: (
    input: {
      bookId: string;
      id: string;
      voidedBy: string;
      voidReason?: string;
    },
    audit: AuditEvent,
  ) => Promise<ExpenseSettlement>;
  listExpenseSettlements: (
    bookId: string,
    expenseId?: string,
  ) => Promise<ExpenseSettlement[]>;
};
