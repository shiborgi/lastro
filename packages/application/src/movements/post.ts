/**
 * Turning a reviewed row into the economic fact it records.
 *
 * Three things are decided here that the import deliberately would not: the
 * direction, the reference month and the party/category mapping. See
 * `postMovement` for what each one means and why the refusals are refusals
 * rather than guesses (ADR 8).
 */
import {
  type AccountMovement,
  type CardMovement,
  type PaymentMethod,
  type Transfer,
  UnauthorizedError,
  assertAuthorized,
  operations,
} from "@lastro/domain";
import {
  paymentKeyFor,
  purchaseHashFor,
  scheduleFor,
  splitAmount,
} from "../card-schedule";
import { auditFor, contextFor, requireText } from "../helpers";
import { receiptMethodFor, revenueKeyFor } from "../receipt-day";
import { transferKeyFor } from "../transfer-event";
import type {
  ApplicationRepository,
  PostMovementCommand,
  PostedMovement,
  PromotionWriters,
} from "../types";

type StatementRow = CardMovement | AccountMovement;

/** The two fields only an account descriptor carries. */
type AccountMapping = {
  method?: PaymentMethod | null;
  counterAccountId?: string | null;
};

/**
 * Find or open the transfer this line is one side of.
 *
 * Keyed on the event, not on the movement that showed it. A transfer between
 * two of your own accounts appears on both statements, and a per-movement key
 * wrote it twice — the ledger then said twice as much money moved as did. See
 * `transferKeyFor` for what identifies one.
 */
async function resolveTransfer(
  repository: ApplicationRepository,
  writers: PromotionWriters,
  args: {
    context: ReturnType<typeof contextFor>;
    movement: StatementRow;
    counterAccountId: string;
    descriptorName: string | null;
    referenceMonth: PostMovementCommand["referenceMonth"];
    inflow: boolean;
    amount: bigint;
  },
): Promise<Transfer> {
  const { context, movement, counterAccountId, inflow, amount } = args;

  /*
   * The payer first, whichever side of the transfer this line is. The sign
   * decides it: money out left this account, money in arrived in it from the
   * other. This normalisation is what lets both statements resolve to one
   * pair, and so to one key.
   */
  const sourceAccountId = inflow ? counterAccountId : movement.accountId;
  const destinationAccountId = inflow ? movement.accountId : counterAccountId;

  const eventKey = transferKeyFor({
    sourceAccountId,
    destinationAccountId,
    amount,
    date: movement.purchaseDate,
    occurrence: movement.occurrence,
  });
  const already = await repository.getTransferByKey(context.bookId, eventKey);
  return (
    already ??
    (await writers.createTransfer({
      context,
      key: eventKey,
      referenceMonth: args.referenceMonth,
      sourceAccountId,
      destinationAccountId,
      // The descriptor is the transfer's own declaration here — see
      // `expenses.name` for why it, and not the statement text, is what names
      // the record.
      name: args.descriptorName,
      amount,
      currency: movement.currency,
      occurredAt: movement.purchaseDate,
    }))
  );
}

/**
 * A card purchase is a debt with a schedule, so promoting one writes the whole
 * commitment: the expense once, then a settlement per instalment against the
 * payment for the invoice it falls on.
 *
 * The bills are shared. A card is paid once a month however many purchases the
 * invoice carries, so each settlement reaches the payment for its month through
 * a derived key and the second purchase of September finds the first one's bill
 * instead of opening another.
 */
async function writeCardSchedule(
  repository: ApplicationRepository,
  writers: PromotionWriters,
  args: {
    context: ReturnType<typeof contextFor>;
    movement: StatementRow;
    schedule: ReturnType<typeof scheduleFor>;
    total: bigint;
    purchaseKey: string;
    expenseId: string;
  },
): Promise<void> {
  const { context, movement, schedule, total, purchaseKey, expenseId } = args;
  const parts = splitAmount(total, schedule.length);

  for (const [index, instalment] of schedule.entries()) {
    const paymentKey = paymentKeyFor(
      movement.accountId,
      instalment.referenceMonth,
    );
    /*
     * Read then create, and the unique index on the key is what makes the race
     * lose instead of duplicating: two purchases promoted at once both find
     * nothing, and the second insert collides.
     */
    const existing = await repository.getPaymentByKey(
      context.bookId,
      paymentKey,
    );
    const payment =
      existing ??
      (await writers.createPayment({
        context: { ...context, idempotencyKey: paymentKey },
        accountId: movement.accountId,
        key: paymentKey,
        // The instrument is the card, whatever the line's wording says.
        method: "CREDIT_CARD",
        referenceMonth: instalment.referenceMonth,
        currency: movement.currency,
        dueAt: instalment.referenceMonth,
      }));

    await writers.createExpenseSettlement({
      context: {
        ...context,
        idempotencyKey: `${purchaseKey}-${index + 1}`,
      },
      expenseId,
      paymentId: payment.id,
      amount: parts[index] ?? 0n,
      currency: movement.currency,
      installmentNumber: instalment.installmentNumber,
      installmentCount: instalment.installmentCount,
      description: movement.description,
    });
  }
}

/**
 * An account line that is money out: one expense, one payment, one settlement
 * between them.
 *
 * One to one, with no schedule, because there is nothing to schedule — the
 * money already left on the day the statement says it did. That is also why the
 * payment is created *paid*: on a card the bill is a future obligation and
 * `paid_at` stays null until the invoice is settled, but a statement line is the
 * evidence the money is gone. Recording it as pending would leave the ledger
 * claiming money still to go out that already went.
 *
 * The method comes from the descriptor, which is where a person decided it —
 * never CREDIT_CARD by default, the way the card side can, because the rail an
 * account line took is a fact about the line and not about the document.
 */
async function writeAccountPayment(
  repository: ApplicationRepository,
  writers: PromotionWriters,
  args: {
    context: ReturnType<typeof contextFor>;
    movement: StatementRow;
    accountMethod: PaymentMethod | null;
    referenceMonth: PostMovementCommand["referenceMonth"];
    total: bigint;
    purchaseKey: string;
    expenseId: string;
  },
): Promise<void> {
  const { context, movement, total, purchaseKey, expenseId } = args;
  const paymentKey = `${purchaseKey}-pay`;
  const existing = await repository.getPaymentByKey(context.bookId, paymentKey);
  const payment =
    existing ??
    (await writers.createPayment({
      context: { ...context, idempotencyKey: paymentKey },
      accountId: movement.accountId,
      key: paymentKey,
      method: args.accountMethod,
      referenceMonth: args.referenceMonth,
      currency: movement.currency,
      dueAt: movement.purchaseDate,
      paidAt: movement.purchaseDate,
    }));

  await writers.createExpenseSettlement({
    context: { ...context, idempotencyKey: `${purchaseKey}-1` },
    expenseId,
    paymentId: payment.id,
    amount: total,
    currency: movement.currency,
    installmentNumber: 1,
    installmentCount: 1,
    description: movement.description,
  });
}

/**
 * An account line that is money in: one receipt per line, matching the bank
 * statement exactly, and one revenue per payer per day that they all settle
 * against.
 *
 * The aggregation moved to the revenue side. An acquirer settles a day of sales
 * in several lines — six on the measured statement, one per flag and function —
 * and they are one customer relationship's earnings for the day, not six; but
 * each line is still its own real deposit, so the receipt stays one per line,
 * evidence rather than a synthesis. The settlements carry the descriptor, which
 * is what still says which flag each part came from once the revenue adds them
 * together.
 *
 * `revenues.amount` is not supplied here: a trigger derives it from the
 * settlements, which is what keeps a shared revenue equal to the sum of what it
 * actually earned as each further line lands on it. The receipt's amount has no
 * such trigger — it is this line's own figure, fixed at creation, the same as
 * the account-outflow payment above.
 */
async function writeAccountReceipt(
  repository: ApplicationRepository,
  writers: PromotionWriters,
  args: {
    context: ReturnType<typeof contextFor>;
    movement: StatementRow;
    accountMethod: PaymentMethod | null | undefined;
    referenceMonth: PostMovementCommand["referenceMonth"];
    total: bigint;
    movementKey: string;
    revenueId: string;
  },
): Promise<void> {
  const { context, movement, total, movementKey, revenueId } = args;
  const receiptKey = `${movementKey}-recv`;
  const existing = await repository.getReceiptByKey(context.bookId, receiptKey);
  const receipt =
    existing ??
    (await writers.createReceipt({
      context: { ...context, idempotencyKey: receiptKey },
      accountId: movement.accountId,
      key: receiptKey,
      // Pix when the line said so, a transfer otherwise: what reaches the
      // account is the payer's deposit, never the customer's card.
      method: receiptMethodFor(args.accountMethod),
      referenceMonth: args.referenceMonth,
      amount: total,
      currency: movement.currency,
      dueAt: movement.purchaseDate,
      paidAt: movement.purchaseDate,
    }));

  /*
   * Keyed on the movement, not the (now shared) `purchaseKey` — a second flag
   * landing on the same day's revenue still needs its own settlement, and
   * reusing `purchaseKey` here would collide the two.
   */
  await writers.createRevenueSettlement({
    context: { ...context, idempotencyKey: `${movementKey}-1` },
    revenueId,
    receiptId: receipt.id,
    amount: total,
    currency: movement.currency,
    // The descriptor, which is what tells the flags apart once the revenue is
    // one number.
    description: movement.descriptorKey,
  });
}

export function createPostingMethods(
  repository: ApplicationRepository,
  writers: PromotionWriters,
) {
  return {
    /**
     * Turn a reviewed row into the economic fact it records.
     *
     * Three things are decided here that the import deliberately would not:
     *
     * The *direction*. A movement's sign says which fact it is — money leaving
     * is an expense, money arriving a revenue — and the sign comes from the
     * statement, not from the caller. On a real account export 107 of 162 lines
     * are inflows, so revenue is the common case rather than the exception.
     *
     * The *reference month*. It comes from the invoice, not the purchase: an
     * instalment bought in April sits on a September statement, and deriving
     * the month from the purchase date would scatter one invoice across the
     * year. The caller supplies it.
     *
     * The *party and category*, read from the descriptor's mapping. If either
     * is missing the promotion is refused rather than guessed (ADR 8) — that
     * refusal is the whole reason staging exists.
     */
    async postMovement(input: PostMovementCommand): Promise<PostedMovement> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createExpense);
      requireText(input.id, "id");

      const movement =
        input.kind === "card"
          ? await repository.getCardMovement(context.bookId, input.id)
          : await repository.getAccountMovement(context.bookId, input.id);
      if (!movement) throw new UnauthorizedError();
      if (movement.status !== "PENDING") {
        throw new Error(`movement is ${movement.status}, not PENDING`);
      }

      /*
       * Which descriptor table answers depends on which statement the row came
       * from, and the two answer different questions. A card descriptor names a
       * party and a category; an account descriptor also names the rail the
       * money took and, for a transfer, the account on the other side.
       */
      const descriptor =
        input.kind === "card"
          ? await repository.getCardDescriptorByKey(
              context.bookId,
              movement.descriptorKey,
            )
          : await repository.getAccountDescriptorByKey(
              context.bookId,
              movement.descriptorKey,
            );
      if (!descriptor) {
        throw new Error(
          `descriptor "${movement.descriptorKey}" is not mapped yet`,
        );
      }

      /*
       * A credit on a card invoice is a refund or the bill being paid, not an
       * earning. Booking it as revenue would inflate a month's income by the
       * size of the bill — the one credit measured across 54 rows was "Pag
       * Fatura Boleto" — so it is refused and left for review to ignore.
       */
      if (input.kind === "card" && movement.amount < 0n) {
        throw new Error(
          "a credit on a card invoice is not a revenue; ignore it instead",
        );
      }

      const inflow = input.kind === "account" && movement.amount > 0n;
      const amount = movement.amount < 0n ? -movement.amount : movement.amount;
      const setter =
        input.kind === "card"
          ? repository.setCardMovementStatus
          : repository.setAccountMovementStatus;
      // Derived from the movement, so promoting the same row twice collides on
      // the ledger's own unique key instead of writing a second record.
      const key = `mov-${input.kind}-${movement.id}`;

      /*
       * A card invoice line is a charge, so it becomes an expense: there is no
       * kind to declare on that side. On an account the descriptor decides which
       * table the line belongs in and the sign only decides direction inside it
       * — left null, EXPENSE and REVENUE follow the sign, but a transfer is
       * never inferred, because no arithmetic on a statement distinguishes
       * paying a supplier from moving money between two of your own accounts.
       */
      const account =
        input.kind === "account" ? (descriptor as AccountMapping) : null;
      /*
       * Naming another account *is* the declaration that this is a transfer.
       * A separate `kind` field used to carry it and said nothing this does
       * not: EXPENSE and REVENUE had to agree with the sign or they were
       * refused, so TRANSFER was the only value that changed anything — and a
       * transfer without a destination could never be promoted anyway.
       */
      if (account?.counterAccountId) {
        /*
         * The account this line came from is on the movement, stated at
         * import. It used to be looked up from the institution plus the number
         * printed on the statement, which could fail on a file that prints no
         * number — the Nubank export prints none — and left the promotion
         * refusing a transfer for a reason the operator could not act on.
         */
        const transfer = await resolveTransfer(repository, writers, {
          context,
          movement,
          counterAccountId: account.counterAccountId,
          descriptorName: descriptor.name ?? null,
          referenceMonth: input.referenceMonth,
          inflow,
          amount,
        });
        await setter(
          {
            bookId: context.bookId,
            id: input.id,
            status: "POSTED",
            transferId: transfer.id,
          },
          auditFor(context, "movement.posted", `${input.kind}_movement`, {
            id: input.id,
            transferId: transfer.id,
          }),
        );
        return {
          kind: "transfer",
          id: transfer.id,
          amount,
          method: account.method ?? null,
        };
      }

      /*
       * A transfer needs neither: it moves money between two of your own
       * accounts, so there is no counterparty and nothing to classify. These
       * two are required only on the paths that record a fact about someone
       * else — which is why the check sits here and not above the branch.
       */
      if (!descriptor.partyId) {
        throw new Error(
          `descriptor "${movement.descriptorKey}" has no party yet; map it first`,
        );
      }
      if (!descriptor.categoryId) {
        throw new Error(
          `descriptor "${movement.descriptorKey}" has no category yet; map it first`,
        );
      }

      const categories = await repository.listCategories(context.bookId);
      const category = categories.find(
        (candidate) => candidate.id === descriptor.categoryId,
      );
      if (!category) throw new UnauthorizedError();

      /*
       * The category has to agree with the direction. Without this a supplier
       * mapped to an expense category would silently book incoming money as a
       * cost, and the sign that made it revenue would be the only trace left.
       */
      const wanted = inflow ? "REVENUE" : "EXPENSE";
      if (category.kind !== wanted) {
        throw new Error(
          `movement is ${inflow ? "money in" : "money out"} but "${category.name}" is a ${category.kind} category`,
        );
      }

      /*
       * A card purchase is one debt with a schedule, so the expense carries the
       * whole commitment: the total, dated the day of the purchase. The line on
       * the invoice is one instalment of it, and the total is that instalment
       * times the count — the only figure the file gives.
       */
      const instalments = Math.max(
        1,
        (movement as { installmentCount?: number | null }).installmentCount ??
          1,
      );
      const windows =
        input.kind === "card"
          ? await repository.listAccountReferenceMonths(
              context.bookId,
              movement.accountId,
            )
          : [];
      const schedule =
        input.kind === "card"
          ? scheduleFor(movement.purchaseDate, instalments, windows)
          : [];
      const total =
        input.kind === "card" ? amount * BigInt(instalments) : amount;

      /*
       * The same purchase appears on every invoice it is billed on, with a
       * different instalment number each time. This hash is what makes the
       * second sighting find the first one's expense instead of opening a
       * second debt — see `purchaseHashFor` for which fields, and which error
       * that choice makes possible.
       *
       * An account line that is money in keys the same way an acquirer's
       * deposit does: per payer per day, not per line. Stone settling six
       * flags on one day is one earning, and the second flag has to find the
       * first one's revenue instead of opening a second — see `revenueKeyFor`.
       * Money out stays keyed on the movement itself: there is no cycle to
       * gather it into.
       */
      const purchaseKey =
        input.kind === "card"
          ? purchaseHashFor({
              accountId: movement.accountId,
              purchaseDate: movement.purchaseDate,
              descriptorKey: movement.descriptorKey,
              installmentCount: instalments,
              instalmentAmount: amount,
            })
          : inflow
            ? revenueKeyFor(
                movement.accountId,
                descriptor.partyId,
                movement.purchaseDate,
              )
            : key;

      const already =
        input.kind === "card"
          ? await repository.getExpenseByKey(context.bookId, purchaseKey)
          : inflow
            ? await repository.getRevenueByKey(context.bookId, purchaseKey)
            : null;

      const shared = {
        context,
        key: purchaseKey,
        /*
         * The invoice the purchase starts on, so the expense and the
         * settlements paying it agree on a month. The caller's
         * `referenceMonth` still governs an account line, where there is no
         * cycle to read.
         */
        referenceMonth: schedule[0]
          ? schedule[0].referenceMonth
          : input.referenceMonth,
        partyId: descriptor.partyId,
        categoryId: descriptor.categoryId,
        /*
         * The descriptor is the one place that knows both the wording an
         * operator has already read and the record about to be created — so
         * this is where a name reaches the expense or revenue, never invented
         * upstream. Null until someone sets it, the same as party and
         * category, and promotion never refuses for its absence.
         */
        name: descriptor.name ?? null,
        amount: total,
        currency: movement.currency,
        occurredAt: movement.purchaseDate,
      };

      const record =
        already ??
        (inflow
          ? await writers.createRevenue(shared)
          : await writers.createExpense(shared));

      /*
       * Only for a purchase this Book has not seen. A second sighting is
       * already covered by the schedule the first one wrote, so it marks the
       * line posted against that expense and writes nothing further.
       *
       * An account statement gets none of this: a line on a statement is money
       * that already moved, on the day it moved, with nothing scheduled.
       */
      if (input.kind === "card" && !already) {
        await writeCardSchedule(repository, writers, {
          context,
          movement,
          schedule,
          total,
          purchaseKey,
          expenseId: record.id,
        });
      }

      if (input.kind === "account" && !inflow) {
        await writeAccountPayment(repository, writers, {
          context,
          movement,
          accountMethod: account?.method ?? null,
          referenceMonth: shared.referenceMonth,
          total,
          purchaseKey,
          expenseId: record.id,
        });
      }

      if (input.kind === "account" && inflow) {
        await writeAccountReceipt(repository, writers, {
          context,
          movement,
          accountMethod: account?.method,
          referenceMonth: shared.referenceMonth,
          total,
          movementKey: key,
          revenueId: record.id,
        });
      }

      await setter(
        {
          bookId: context.bookId,
          id: input.id,
          status: "POSTED",
          ...(inflow ? { revenueId: record.id } : { expenseId: record.id }),
        },
        auditFor(context, "movement.posted", `${input.kind}_movement`, {
          id: input.id,
          [inflow ? "revenueId" : "expenseId"]: record.id,
        }),
      );

      return {
        kind: inflow ? "revenue" : "expense",
        id: record.id,
        /*
         * The record's amount, which on a card is the whole purchase and not
         * the instalment the line showed. Returning the line's figure would
         * report 362.08 for an expense of 4344.96.
         */
        amount: total,
        /*
         * A card line was paid by the card, full stop; an account line took
         * whatever rail its descriptor names.
         */
        method:
          input.kind === "card" ? "CREDIT_CARD" : (account?.method ?? null),
      };
    },
  };
}
