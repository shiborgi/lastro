import { createExpenseMethods } from "./expenses";
import { createLedgerMethods } from "./ledger";
import { createRevenueMethods } from "./revenues";
import { createTransferMethods } from "./transfers";
import type {
  ApplicationRepository,
  CreateAccountCommand,
  CreateExpenseCommand,
  CreateExpenseSettlementCommand,
  CreatePaymentCommand,
  VoidExpenseSettlementCommand,
} from "./types";

export * from "./types";

export function createApplication(repository: ApplicationRepository) {
  return {
    ...createLedgerMethods(repository),
    ...createExpenseMethods(repository),
    ...createRevenueMethods(repository),
    ...createTransferMethods(repository),
  };
}

export type Application = ReturnType<typeof createApplication>;

export function createAccountCommand(repository: ApplicationRepository) {
  return {
    execute: (input: CreateAccountCommand) =>
      createApplication(repository).createAccount(input),
  };
}

export function createExpenseCommand(repository: ApplicationRepository) {
  return {
    execute: (input: CreateExpenseCommand) =>
      createApplication(repository).createExpense(input),
  };
}

export function createPaymentCommand(repository: ApplicationRepository) {
  return {
    execute: (input: CreatePaymentCommand) =>
      createApplication(repository).createPayment(input),
  };
}

export function createExpenseSettlementCommand(
  repository: ApplicationRepository,
) {
  return {
    execute: (input: CreateExpenseSettlementCommand) =>
      createApplication(repository).createExpenseSettlement(input),
  };
}

export function voidExpenseSettlementCommand(
  repository: ApplicationRepository,
) {
  return {
    execute: (input: VoidExpenseSettlementCommand) =>
      createApplication(repository).voidExpenseSettlement(input),
  };
}
