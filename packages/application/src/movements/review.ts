/**
 * Reading what a statement staged, and taking rows out of the queue.
 *
 * Nothing here creates an economic fact. Promotion is `./post`, which is
 * separately authorized — this module only moves a row between PENDING and
 * IGNORED and reports what is waiting.
 */
import {
  type AccountMovement,
  type CardMovement,
  type PendingAccountDescriptor,
  type PendingCardDescriptor,
  assertAuthorized,
  operations,
} from "@lastro/domain";
import { auditFor, contextFor, requireText } from "../helpers";
import type {
  ApplicationRepository,
  ListMovementsQuery,
  ReviewMovementCommand,
} from "../types";

export function createReviewMethods(repository: ApplicationRepository) {
  return {
    async listCardMovements(
      input: ListMovementsQuery,
    ): Promise<CardMovement[]> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listMovements);
      return repository.listCardMovements(context.bookId, input.status);
    },

    async listAccountMovements(
      input: ListMovementsQuery,
    ): Promise<AccountMovement[]> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listMovements);
      return repository.listAccountMovements(context.bookId, input.status);
    },

    /**
     * Take a staged row out of the queue without creating anything.
     *
     * The case this exists for is the card bill: "Pag Fatura Boleto" on the
     * invoice and the matching outflow on the account statement are one event
     * seen from two sides, and neither is an expense. Ignoring is reversible —
     * pass PENDING to put a row back.
     */
    async reviewMovement(input: ReviewMovementCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.reviewMovement);
      requireText(input.id, "id");
      if (input.status === "POSTED") {
        // Posting is promotion, and promotion creates an expense. That path
        // resolves the alias and is separately authorized; setting it here
        // would leave a row marked posted with nothing behind it.
        throw new Error("use the promotion path to post a movement");
      }
      const setter =
        input.kind === "card"
          ? repository.setCardMovementStatus
          : repository.setAccountMovementStatus;
      await setter(
        {
          bookId: context.bookId,
          id: input.id,
          status: input.status,
          expenseId: null,
        },
        auditFor(context, "movement.reviewed", `${input.kind}_movement`, {
          id: input.id,
          status: input.status,
        }),
      );
    },

    async listPendingCardDescriptors(
      contextInput: unknown,
    ): Promise<PendingCardDescriptor[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listDescriptors);
      return repository.listPendingCardDescriptors(context.bookId);
    },

    async listPendingAccountDescriptors(
      contextInput: unknown,
    ): Promise<PendingAccountDescriptor[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listDescriptors);
      return repository.listPendingAccountDescriptors(context.bookId);
    },
  };
}
