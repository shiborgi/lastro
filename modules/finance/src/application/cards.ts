/**
 * Card movement evidence's use cases (ADR 18): taking an invoice in,
 * classifying merchant names, and posting a purchase as one expense settled
 * into one invoice payment per instalment.
 *
 * Only the descriptor decides what a purchase is; there is no choosing an
 * existing record. The first line of a purchase creates its expense and its
 * whole schedule, each instalment on the invoice the billing windows say; the
 * lines of later invoices find their instalment by payment key and attach to
 * it. Posting runs finance's own operations in the caller's scope.
 */
import {
  type BoundOperation,
  type ExecutionContext,
  InvalidRequestError,
  type Scope,
  UnauthorizedError,
  bind,
  textFromDate,
} from "@lastro/kernel";
import * as cardContracts from "../contracts/cards";
import * as expenseContracts from "../contracts/expenses";
import * as revenueContracts from "../contracts/revenues";
import {
  type ImporterIdentity,
  MovementConflictError,
  MovementStateError,
  descriptorKey,
  statementKeyOf,
} from "../domain/account-movements";
import {
  type BillingWindow,
  type CardMapping,
  type CardMovement,
  type CardObservation,
  type ScheduledInvoice,
  cardIneligibility,
  cardKeys,
  invoicePaymentKey,
  monthOf,
  paymentKeyOf,
  scheduleOf,
  windowOf,
} from "../domain/cards";
import { isDeduction } from "../domain/catalog";
import type {
  Expense,
  Payment,
  PaymentMethod,
  Transfer,
} from "../domain/records";
import type { CallOperation, MovementIntakeResult } from "./account-movements";
import type { FinancePort } from "./port";

type BookScope = Scope<ExecutionContext>;

export type CardIntake = {
  accountId: string;
  movementType: string;
  importer: ImporterIdentity;
  contentSha256: string;
  sourceKey: string;
  observations: readonly CardObservation[];
};

export type CardsApi = {
  /**
   * Take in one card invoice's lines. The same content again answers its
   * first intake; a line already staged (same statement id, the hash of its
   * text) counts as known.
   * Purchases whose descriptor is filled and whose date a billing window holds
   * are posted at once.
   */
  intake(scope: BookScope, input: CardIntake): Promise<MovementIntakeResult>;
};

const NAME_LIMIT = 200;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
const PAGE = 100;

export function createCards(
  port: FinancePort,
  call: CallOperation,
): { api: CardsApi; handlers: BoundOperation[] } {
  const book = (scope: BookScope) => scope.context.bookId;
  const actor = (scope: BookScope) =>
    scope.context.agentPrincipal ?? scope.context.actorId;
  const day = (value: Date) => textFromDate(value);

  async function movementOf(
    scope: BookScope,
    id: string,
  ): Promise<CardMovement> {
    await port.cardMovements.lock(scope.handle, book(scope), id);
    const movement = await port.cardMovements.get(
      scope.handle,
      book(scope),
      id,
    );
    if (!movement) throw new UnauthorizedError();
    return movement;
  }

  async function windowsOf(
    scope: BookScope,
    accountId: string,
  ): Promise<BillingWindow[]> {
    return port.accountCycles.list(scope.handle, book(scope), {
      accountId,
    });
  }

  /** The invoice payment of a card month: found by key, or opened unpaid, due on the invoice's day. */
  async function invoicePayment(
    scope: BookScope,
    movement: CardMovement,
    invoice: ScheduledInvoice,
  ): Promise<Payment> {
    const key = invoicePaymentKey(movement.accountId, invoice.month);
    const known = await port.payments.getByKey(scope.handle, book(scope), key);
    if (known) return known;
    return call<Payment>(expenseContracts.createPayment, scope, {
      accountId: movement.accountId,
      key,
      // The purchase's descriptor says how the card is paid (ADR 16); the
      // month's first purchase opens the payment.
      method: movement.paymentMethod ?? undefined,
      currency: movement.currency,
      referenceMonth: day(invoice.month),
      dueOn: day(invoice.dueOn),
    });
  }

  async function deductionOf(
    scope: BookScope,
    financialCategoryId: string | null,
  ): Promise<boolean | null> {
    if (!financialCategoryId) return null;
    const categories = await port.financialCategories.list(
      scope.handle,
      book(scope),
    );
    return isDeduction(financialCategoryId, categories);
  }

  /**
   * The expense of a purchase, or the discount of a refund: the one created
   * before (after an undo), or a new one. A refund's is negative, under its
   * DEDUCTION category; finance's create_expense refuses those, so it is
   * written here, with its audit event, as settle_expense writes a discount.
   */
  async function expenseFor(
    scope: BookScope,
    movement: CardMovement,
    partyId: string,
    financialCategoryId: string,
  ): Promise<Expense> {
    const key = `card-${movement.expenseKey}`;
    const known = await port.expenses.getByKey(scope.handle, book(scope), key);
    if (known) {
      if (
        known.partyId !== partyId ||
        known.financialCategoryId !== financialCategoryId
      )
        throw new MovementConflictError(
          `this purchase was posted before as ${key} with another party or financial category; classify its descriptor the same way`,
          { key },
        );
      return known;
    }
    const record = {
      key,
      partyId,
      financialCategoryId,
      name: movement.name.slice(0, NAME_LIMIT),
      amount: movement.amount * BigInt(movement.installmentCount),
      currency: movement.currency,
      referenceMonth: monthOf(movement.occurredOn),
      occurredOn: movement.occurredOn,
    };
    if (movement.amount > 0n)
      return call<Expense>(expenseContracts.createExpense, scope, {
        ...record,
        amount: record.amount.toString(),
        referenceMonth: day(record.referenceMonth),
        occurredOn: day(record.occurredOn),
      });
    const discount = await port.expenses.insert(scope.handle, book(scope), {
      ...record,
      occurredAt: null,
    });
    scope.audit({
      action: "expense.created",
      resourceType: "expense",
      resourceId: discount.id,
      payload: { key, refund: movement.id, amount: record.amount.toString() },
    });
    return discount;
  }

  /** Settle one instalment of a purchase, or of a refund's discount, into its invoice payment. */
  async function settleInstalment(
    scope: BookScope,
    movement: CardMovement,
    expense: Expense,
    payment: Payment,
    installment: number,
  ): Promise<string> {
    const shared = {
      installmentNumber: installment,
      installmentCount: movement.installmentCount,
      description: movement.name.slice(0, NAME_LIMIT),
    };
    if (movement.amount > 0n) {
      const settled = await call<{ settlement: { id: string } }>(
        expenseContracts.settleExpense,
        scope,
        {
          expenseId: expense.id,
          paymentId: payment.id,
          amount: movement.amount.toString(),
          ...shared,
        },
      );
      return settled.settlement.id;
    }
    await port.lockSettlementSet(
      scope.handle,
      book(scope),
      expense.id,
      payment.id,
    );
    const settlement = await port.expenseSettlements.insert(
      scope.handle,
      book(scope),
      {
        expenseId: expense.id,
        paymentId: payment.id,
        amount: movement.amount,
        currency: movement.currency,
        ...shared,
      },
    );
    scope.audit({
      action: "expense_settlement.created",
      resourceType: "expense_settlement",
      resourceId: settlement.id,
      payload: {
        expenseId: expense.id,
        paymentId: payment.id,
        amount: movement.amount.toString(),
        refund: movement.id,
      },
    });
    return settlement.id;
  }

  /**
   * Post a PENDING line. A purchase's first line creates the expense and
   * every instalment; a refund's, its discount on the invoice it is billed
   * on. The line then attaches to its own instalment.
   */
  async function post(scope: BookScope, movement: CardMovement) {
    if (movement.status !== "PENDING")
      throw new MovementStateError(
        `card line ${movement.id} is ${movement.status}; undo it before posting it again`,
      );
    const windows = await windowsOf(scope, movement.accountId);
    const window = windowOf(movement.occurredOn, windows);
    const blocked = cardIneligibility(
      movement,
      await deductionOf(scope, movement.financialCategoryId),
      window,
      movement.occurredOn,
    );
    if (blocked)
      throw new InvalidRequestError(`card line ${movement.id}: ${blocked}`);
    if (movement.counterAccountId && movement.paymentMethod)
      return postTransfer(
        scope,
        movement,
        movement.counterAccountId,
        movement.paymentMethod,
      );
    if (!window || !movement.partyId || !movement.financialCategoryId)
      throw new InvalidRequestError(`card line ${movement.id}: ${blocked}`);

    const paymentKey = movement.paymentKey;
    const expenseKey = movement.expenseKey;
    // Two lines of one purchase may post in one intake; one schedules it.
    await port.cardLinks.lock(
      scope.handle,
      book(scope),
      movement.accountId,
      expenseKey,
    );
    let created = false;
    if (
      !(await port.cardLinks.getExpense(
        scope.handle,
        book(scope),
        movement.accountId,
        expenseKey,
      ))
    ) {
      const expense = await expenseFor(
        scope,
        movement,
        movement.partyId,
        movement.financialCategoryId,
      );
      await port.cardLinks.insertExpense(scope.handle, book(scope), {
        accountId: movement.accountId,
        expenseKey,
        expenseId: expense.id,
      });
      for (const [index, invoice] of scheduleOf(
        window,
        movement.installmentCount,
        windows,
      ).entries()) {
        const installment = index + 1;
        const payment = await invoicePayment(scope, movement, invoice);
        await port.cardLinks.insertPayment(scope.handle, book(scope), {
          accountId: movement.accountId,
          paymentKey: paymentKeyOf(expenseKey, installment),
          expenseKey,
          installmentNumber: installment,
          installmentCount: movement.installmentCount,
          paymentId: payment.id,
          settlementId: await settleInstalment(
            scope,
            movement,
            expense,
            payment,
            installment,
          ),
          movementId: null,
        });
      }
      created = true;
    }
    const instalment = await port.cardLinks.getPayment(
      scope.handle,
      book(scope),
      movement.accountId,
      paymentKey,
    );
    if (!instalment)
      throw new MovementConflictError(
        `purchase ${expenseKey} has no instalment ${movement.installmentNumber}/${movement.installmentCount} scheduled`,
        { expenseKey, paymentKey },
      );
    if (instalment.movementId && instalment.movementId !== movement.id)
      throw new MovementConflictError(
        `instalment ${paymentKey} is already shown by card line ${instalment.movementId}`,
        { paymentKey, movementId: instalment.movementId },
      );
    await port.cardLinks.setPaymentMovement(
      scope.handle,
      book(scope),
      movement.accountId,
      paymentKey,
      movement.id,
    );
    const posted = await port.cardMovements.update(
      scope.handle,
      book(scope),
      movement.id,
      { status: "POSTED" },
    );
    scope.audit({
      action: "card_movement.posted",
      resourceType: "card_movement",
      resourceId: movement.id,
      payload: {
        accountId: movement.accountId,
        expenseKey,
        paymentKey,
        scheduled: created,
        paymentId: instalment.paymentId,
        settlementId: instalment.settlementId,
      },
    });
    return {
      movement: posted,
      links: {
        ...(await port.cardLinks.list(scope.handle, book(scope), {
          accountId: movement.accountId,
          expenseKey,
        })),
        transfers: [],
      },
    };
  }

  /**
   * The invoice paid from another account of the Book: one transfer from that
   * account into the card. Its key reads origin, method, destination, day and
   * amount, so the account statement's outflow computes the same one; a link
   * with that key whose transfer has no card side yet is joined.
   */
  async function postTransfer(
    scope: BookScope,
    movement: CardMovement,
    counterAccountId: string,
    method: PaymentMethod,
  ) {
    const amount = -movement.amount;
    const statementKey = statementKeyOf(
      {
        direction: "RECEIPT",
        accountId: movement.accountId,
        occurredOn: movement.occurredOn,
      },
      { accountId: counterAccountId },
      amount,
      method,
    );
    let transferId: string | null = null;
    for (const each of await port.accountMovementLinks.list(
      scope.handle,
      book(scope),
      { statementKey },
    )) {
      if (each.direction !== "PAYMENT" || !each.transferId) continue;
      const joined = await port.cardLinks.transfers(scope.handle, book(scope), {
        transferId: each.transferId,
      });
      if (joined.length === 0) {
        transferId = each.transferId;
        break;
      }
    }
    if (!transferId)
      transferId = (
        await call<Transfer>(revenueContracts.createTransfer, scope, {
          key: `card-movement-${movement.id}`,
          sourceAccountId: counterAccountId,
          destinationAccountId: movement.accountId,
          name: movement.name.slice(0, NAME_LIMIT),
          amount: amount.toString(),
          currency: movement.currency,
          referenceMonth: day(monthOf(movement.occurredOn)),
          occurredOn: day(movement.occurredOn),
          occurredAt: null,
        })
      ).id;
    const link = await port.cardLinks.insertTransfer(
      scope.handle,
      book(scope),
      {
        accountId: movement.accountId,
        movementId: movement.id,
        externalKey: movement.externalId,
        statementKey,
        transferId,
      },
    );
    const posted = await port.cardMovements.update(
      scope.handle,
      book(scope),
      movement.id,
      { status: "POSTED" },
    );
    scope.audit({
      action: "card_movement.posted",
      resourceType: "card_movement",
      resourceId: movement.id,
      payload: { accountId: movement.accountId, statementKey, transferId },
    });
    return {
      movement: posted,
      links: { expenses: [], payments: [], transfers: [link] },
    };
  }

  /** Post what is eligible; leave the rest PENDING. */
  async function postIfEligible(
    scope: BookScope,
    movement: CardMovement,
    windows: readonly BillingWindow[],
  ): Promise<boolean> {
    const blocked = cardIneligibility(
      movement,
      await deductionOf(scope, movement.financialCategoryId),
      windowOf(movement.occurredOn, windows),
      movement.occurredOn,
    );
    if (blocked) return false;
    await post(scope, movement);
    return true;
  }

  /* A transfer names another account; anything else a party and an expense category. */
  async function assertCardMapping(
    scope: BookScope,
    accountId: string,
    mapping: CardMapping,
  ) {
    if (mapping.counterAccountId) {
      if (mapping.counterAccountId === accountId)
        throw new InvalidRequestError(
          "counterAccountId must be another account of the Book",
        );
      if (
        !(await port.accounts.get(
          scope.handle,
          book(scope),
          mapping.counterAccountId,
        ))
      )
        throw new InvalidRequestError(
          "counterAccountId names no account of this Book",
        );
      return;
    }
    if (
      mapping.partyId &&
      !(await port.parties.get(scope.handle, book(scope), mapping.partyId))
    )
      throw new InvalidRequestError("partyId names no party of this Book");
    if (mapping.financialCategoryId)
      await assertCategory(scope, mapping.financialCategoryId);
  }

  /* A purchase name takes an expense category; a refund name a DEDUCTION one. */
  async function assertCategory(scope: BookScope, financialCategoryId: string) {
    const categories = await port.financialCategories.list(
      scope.handle,
      book(scope),
    );
    const category = categories.find((each) => each.id === financialCategoryId);
    if (!category || category.kind !== "EXPENSE")
      throw new InvalidRequestError(
        "financialCategoryId must be an EXPENSE financial category of this Book",
      );
  }

  const api: CardsApi = {
    async intake(scope, input) {
      const account = await port.accounts.get(
        scope.handle,
        book(scope),
        input.accountId,
      );
      if (!account)
        throw new InvalidRequestError(
          "accountId names no account of this Book",
        );
      if (account.type !== "CARD")
        throw new InvalidRequestError(
          `a card invoice is taken into a CARD; account ${account.id} is ${account.type}`,
        );
      if (input.observations.length === 0)
        throw new InvalidRequestError("the content has no lines");

      const before = await port.movementFiles.findByContent(
        scope.handle,
        book(scope),
        {
          accountId: account.id,
          importerFingerprint: input.importer.fingerprint,
          contentSha256: input.contentSha256,
        },
      );
      if (before) {
        scope.audit({
          action: "movement_file.replayed",
          resourceType: "movement_file",
          resourceId: before.id,
          payload: { sourceKey: input.sourceKey },
        });
        return {
          file: before,
          alreadyImported: true,
          lines: before.lineCount,
          new: 0,
          known: before.lineCount,
          posted: 0,
          pending: 0,
        };
      }

      // Identical lines in one invoice are told apart by their order (`#2`).
      const repeats = new Map<string, number>();
      const lines = [];
      for (const line of input.observations) {
        if (line.amount === 0n)
          throw new InvalidRequestError(
            `a line of ${line.name} moves no money`,
          );
        const statementHash = await sha256(line.line);
        const repeat = (repeats.get(statementHash) ?? 0) + 1;
        repeats.set(statementHash, repeat);
        const suffix = repeat > 1 ? `#${repeat}` : "";
        const externalId = `${await sha256(line.purchaseLine)}${suffix}`;
        const keys = cardKeys(externalId, line.installmentCount);
        lines.push({
          line,
          descriptorKey: descriptorKey(line.name),
          statementId: `${statementHash}${suffix}`,
          externalId,
          expenseKey: keys.expenseKey,
          paymentKey: keys.paymentKey(line.installmentNumber),
        });
      }
      const staged = new Set(
        (
          await port.cardMovements.findByStatementIds(
            scope.handle,
            book(scope),
            account.id,
            lines.map((each) => each.statementId),
          )
        ).map((each) => each.statementId),
      );
      const fresh = lines.filter((each) => !staged.has(each.statementId));
      const file = await port.movementFiles.insert(scope.handle, book(scope), {
        accountId: account.id,
        movementType: input.movementType,
        importerId: input.importer.id,
        importerVersion: input.importer.version,
        importerFingerprint: input.importer.fingerprint,
        contentSha256: input.contentSha256,
        sourceKey: input.sourceKey,
        lineCount: lines.length,
        newCount: fresh.length,
        importedBy: actor(scope),
      });

      const windows = await windowsOf(scope, account.id);
      let posted = 0;
      for (const each of fresh) {
        const descriptor = await port.cardDescriptors.ensure(
          scope.handle,
          book(scope),
          {
            accountId: account.id,
            descriptorKey: each.descriptorKey,
            name: each.line.name,
          },
        );
        const movement = await port.cardMovements.insert(
          scope.handle,
          book(scope),
          {
            accountId: account.id,
            fileId: file.id,
            statementId: each.statementId,
            externalId: each.externalId,
            paymentKey: each.paymentKey,
            expenseKey: each.expenseKey,
            occurredOn: each.line.occurredOn,
            amount: each.line.amount,
            currency: each.line.currency,
            name: each.line.name,
            descriptorKey: each.descriptorKey,
            description: each.line.description,
            cardholder: each.line.cardholder,
            cardLast4: each.line.cardLast4,
            providerCategory: each.line.providerCategory,
            installmentNumber: each.line.installmentNumber,
            installmentCount: each.line.installmentCount,
            partyId: descriptor.partyId,
            financialCategoryId: descriptor.financialCategoryId,
            counterAccountId: descriptor.counterAccountId,
            paymentMethod: descriptor.paymentMethod,
          },
        );
        if (await postIfEligible(scope, movement, windows)) posted += 1;
      }
      scope.audit({
        action: "movement_file.imported",
        resourceType: "movement_file",
        resourceId: file.id,
        payload: {
          accountId: account.id,
          movementType: input.movementType,
          importerId: input.importer.id,
          importerVersion: input.importer.version,
          sourceKey: input.sourceKey,
          lines: lines.length,
          new: fresh.length,
          posted,
        },
      });
      return {
        file,
        alreadyImported: false,
        lines: lines.length,
        new: fresh.length,
        known: lines.length - fresh.length,
        posted,
        pending: fresh.length - posted,
      };
    },
  };

  const page = <T extends { id: string }>(items: T[], limit: number) => ({
    items,
    nextCursor: items.length === limit ? (items.at(-1)?.id ?? null) : null,
  });

  return {
    api,
    handlers: [
      bind(cardContracts.listCardMovements, async ({ scope, input }) =>
        page(
          await port.cardMovements.list(scope.handle, book(scope), {
            accountId: input.accountId,
            status: input.status,
            descriptorKey: input.descriptorKey,
            expenseKey: input.expenseKey,
            after: input.cursor,
            limit: input.limit,
          }),
          input.limit,
        ),
      ),

      bind(
        cardContracts.listCardMovementDescriptors,
        async ({ scope, input }) => ({
          items: await port.cardDescriptors.list(
            scope.handle,
            book(scope),
            input,
          ),
        }),
      ),

      bind(cardContracts.listCardMovementLinks, async ({ scope, input }) => ({
        ...(await port.cardLinks.list(scope.handle, book(scope), input)),
        transfers:
          input.expenseKey || input.expenseId
            ? []
            : (
                await port.cardLinks.transfers(scope.handle, book(scope), {})
              ).filter(
                (each) =>
                  !input.accountId || each.accountId === input.accountId,
              ),
      })),

      bind(
        cardContracts.classifyCardMovementDescriptor,
        async ({ scope, input }) => {
          const known = await port.cardDescriptors.get(
            scope.handle,
            book(scope),
            input.accountId,
            input.descriptorKey,
          );
          if (!known) throw new UnauthorizedError();
          const pick = <K extends keyof CardMapping>(key: K) =>
            input[key] !== undefined
              ? (input[key] as CardMapping[K])
              : known[key];
          const mapping: CardMapping = {
            partyId: pick("partyId"),
            financialCategoryId: pick("financialCategoryId"),
            counterAccountId: pick("counterAccountId"),
            paymentMethod: pick("paymentMethod"),
          };
          // Naming an account makes it a transfer; naming a party, not one.
          if (input.counterAccountId) {
            mapping.partyId = input.partyId ?? null;
            mapping.financialCategoryId = input.financialCategoryId ?? null;
          } else if (input.partyId || input.financialCategoryId)
            mapping.counterAccountId = null;
          await assertCardMapping(scope, input.accountId, mapping);
          const descriptor = await port.cardDescriptors.classify(
            scope.handle,
            book(scope),
            {
              accountId: input.accountId,
              descriptorKey: input.descriptorKey,
              ...mapping,
            },
          );
          scope.audit({
            action: "card_movement_descriptor.classified",
            resourceType: "card_movement_descriptor",
            resourceId: `${input.accountId}:${input.descriptorKey}`,
            payload: input,
          });
          const windows = await windowsOf(scope, input.accountId);
          let posted = 0;
          let after: string | undefined;
          for (;;) {
            const batch = await port.cardMovements.list(
              scope.handle,
              book(scope),
              {
                accountId: input.accountId,
                descriptorKey: input.descriptorKey,
                status: "PENDING",
                limit: PAGE,
                after,
              },
            );
            for (const each of batch) {
              await movementOf(scope, each.id);
              const updated = await port.cardMovements.update(
                scope.handle,
                book(scope),
                each.id,
                {
                  partyId: descriptor.partyId,
                  financialCategoryId: descriptor.financialCategoryId,
                  counterAccountId: descriptor.counterAccountId,
                  paymentMethod: descriptor.paymentMethod,
                },
              );
              if (await postIfEligible(scope, updated, windows)) posted += 1;
            }
            if (batch.length < PAGE) break;
            after = batch.at(-1)?.id;
          }
          return { descriptor, posted };
        },
      ),

      bind(cardContracts.postCardMovement, async ({ scope, input }) => {
        const movement = await movementOf(scope, input.id);
        const descriptor = await port.cardDescriptors.get(
          scope.handle,
          book(scope),
          movement.accountId,
          movement.descriptorKey,
        );
        // The descriptor decides; the line takes its classification as it is now.
        const current = await port.cardMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          {
            partyId: descriptor?.partyId ?? null,
            financialCategoryId: descriptor?.financialCategoryId ?? null,
            counterAccountId: descriptor?.counterAccountId ?? null,
            paymentMethod: descriptor?.paymentMethod ?? null,
          },
        );
        return post(scope, current);
      }),

      bind(cardContracts.ignoreCardMovement, async ({ scope, input }) => {
        const movement = await movementOf(scope, input.id);
        if (movement.status !== "PENDING")
          throw new MovementStateError(
            `card line ${movement.id} is ${movement.status}; only a PENDING line is ignored`,
          );
        const ignored = await port.cardMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          { status: "IGNORED", ignoreReason: input.reason },
        );
        scope.audit({
          action: "card_movement.ignored",
          resourceType: "card_movement",
          resourceId: movement.id,
          payload: { reason: input.reason },
        });
        return ignored;
      }),

      bind(cardContracts.undoCardMovement, async ({ scope, input }) => {
        const movement = await movementOf(scope, input.id);
        if (movement.status === "PENDING")
          throw new MovementStateError(
            `card line ${movement.id} is already PENDING`,
          );
        const reason = input.reason ?? `undo of card line ${movement.id}`;
        let unscheduled = false;
        const [transfer] = await port.cardLinks.transfers(
          scope.handle,
          book(scope),
          { movementId: movement.id },
        );
        if (transfer) {
          await port.cardLinks.removeTransfer(
            scope.handle,
            book(scope),
            movement.id,
          );
          const others = await port.accountMovementLinks.list(
            scope.handle,
            book(scope),
            { transferId: transfer.transferId },
          );
          if (others.length === 0) {
            await port.transfers.remove(
              scope.handle,
              book(scope),
              transfer.transferId,
            );
            scope.audit({
              action: "transfer.removed",
              resourceType: "transfer",
              resourceId: transfer.transferId,
              payload: { cardMovementId: movement.id, reason },
            });
          }
        } else if (movement.status === "POSTED") {
          await port.cardLinks.lock(
            scope.handle,
            book(scope),
            movement.accountId,
            movement.expenseKey,
          );
          await port.cardLinks.setPaymentMovement(
            scope.handle,
            book(scope),
            movement.accountId,
            movement.paymentKey,
            null,
          );
          const instalments = await port.cardLinks.paymentsOf(
            scope.handle,
            book(scope),
            movement.accountId,
            movement.expenseKey,
          );
          // The schedule goes only with the purchase's last posted line.
          if (instalments.every((each) => each.movementId === null)) {
            for (const each of instalments)
              await call(expenseContracts.voidExpenseSettlement, scope, {
                id: each.settlementId,
                voidReason: reason,
              });
            await port.cardLinks.removeExpense(
              scope.handle,
              book(scope),
              movement.accountId,
              movement.expenseKey,
            );
            unscheduled = true;
          }
        }
        const pending = await port.cardMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          { status: "PENDING", ignoreReason: null },
        );
        scope.audit({
          action: "card_movement.undone",
          resourceType: "card_movement",
          resourceId: movement.id,
          payload: { was: movement.status, unscheduled, reason },
        });
        return pending;
      }),
    ],
  };
}
