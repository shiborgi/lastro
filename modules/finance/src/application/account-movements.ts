/**
 * Account movement evidence's use cases (ADRs 14 and 17): the consumer an
 * account's content is read by, taking a file's observations in, classifying
 * descriptors, posting, ignoring and undoing.
 *
 * Posting goes through finance's own operations (create an expense or
 * revenue, open a payment or receipt and settle into it, create a transfer),
 * called with the same scope, so a movement is posted under exactly the rules
 * a person posting by hand meets, in the same transaction and audit trail.
 * What a movement became is recorded as its links, each with a statement key;
 * the second side of a transfer finds the first side's transfer by that key.
 */
import {
  type BoundOperation,
  type ExecutionContext,
  InvalidRequestError,
  type OperationDescriptor,
  type Scope,
  UnauthorizedError,
  bind,
  textFromDate,
} from "@lastro/kernel";
import type { z } from "zod";
import * as contracts from "../contracts/account-movements";
import * as expenseContracts from "../contracts/expenses";
import * as revenueContracts from "../contracts/revenues";
import {
  type AccountMovement,
  type AccountMovementDescriptor,
  type AccountMovementLink,
  type AccountMovementMapping,
  type AccountMovementObservation,
  type DescriptorRef,
  type ImporterIdentity,
  MOVEMENT_TYPE,
  MovementConflictError,
  type MovementConsumer,
  type MovementDirection,
  type MovementFile,
  MovementStateError,
  SalesNotMatchedError,
  descriptorKey,
  initialMapping,
  isClassified,
  isComplete,
  linkExternalKey,
  referenceMonthOf,
  sameMovement,
  statementKeyOf,
} from "../domain/account-movements";
import { isDeduction } from "../domain/catalog";
import type {
  Expense,
  Payment,
  PaymentMethod,
  Receipt,
  Revenue,
  Transfer,
} from "../domain/records";
import type { RevenueMovement } from "../domain/revenue-movements";
import type { FinancePort } from "./port";

type BookScope = Scope<ExecutionContext>;

/** Runs another finance operation's handler inside the caller's scope. */
export type CallOperation = <T>(
  descriptor: OperationDescriptor,
  scope: BookScope,
  input: unknown,
) => Promise<T>;

export type MovementIntake = {
  accountId: string;
  movementType: string;
  importer: ImporterIdentity;
  contentSha256: string;
  /** The caller's key for the content, such as its Drive path. */
  sourceKey: string;
  observations: readonly AccountMovementObservation[];
};

export type MovementIntakeResult = {
  file: MovementFile;
  alreadyImported: boolean;
  lines: number;
  new: number;
  known: number;
  posted: number;
  pending: number;
};

export type AccountMovementsApi = {
  /** The importer that reads this account's content of this type, if one was set. */
  consumerOf(
    scope: BookScope,
    accountId: string,
    movementType: string,
  ): Promise<MovementConsumer | null>;
  /** Route an account's content of a type to an importer; finance keeps the id opaque. */
  setConsumer(
    scope: BookScope,
    input: { accountId: string; movementType: string; importerId: string },
  ): Promise<MovementConsumer>;
  listConsumers(
    scope: BookScope,
    query: { accountId?: string },
  ): Promise<MovementConsumer[]>;
  /**
   * Take in one content's observations for an account. The same content again
   * answers what the first intake did and writes nothing; lines already
   * staged are counted as known. Lines whose mapping is complete are posted
   * at once (ADR 17).
   */
  intake(
    scope: BookScope,
    input: MovementIntake,
  ): Promise<MovementIntakeResult>;
};

type Share = { id: string; amount: bigint };

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

export function createAccountMovements(
  port: FinancePort,
  call: CallOperation,
): { api: AccountMovementsApi; handlers: BoundOperation[] } {
  const book = (scope: BookScope) => scope.context.bookId;
  const actor = (scope: BookScope) =>
    scope.context.agentPrincipal ?? scope.context.actorId;
  const day = (value: Date) => textFromDate(value);
  const nameOf = (movement: AccountMovement) =>
    (movement.name || movement.description).slice(0, NAME_LIMIT);
  const refOf = (movement: AccountMovement): DescriptorRef => ({
    accountId: movement.accountId,
    direction: movement.direction,
    descriptorKey: movement.descriptorKey,
  });

  async function movementOf(
    scope: BookScope,
    id: string,
  ): Promise<AccountMovement> {
    await port.accountMovements.lock(scope.handle, book(scope), id);
    const movement = await port.accountMovements.get(
      scope.handle,
      book(scope),
      id,
    );
    if (!movement) throw new UnauthorizedError();
    return movement;
  }

  /** Refuse a mapping finance could not post, before anything is written. */
  async function assertMapping(
    scope: BookScope,
    direction: MovementDirection,
    accountId: string,
    mapping: AccountMovementMapping,
  ) {
    if (mapping.settlementGroup) {
      if (direction !== "RECEIPT")
        throw new InvalidRequestError(
          "a settlement group is money in for sales: only a RECEIPT movement names one",
        );
      if (mapping.counterAccountId || mapping.financialCategoryId)
        throw new InvalidRequestError(
          "a settlement group names a party and a payment method, and no financial category or counter account: it settles revenue already recognized",
        );
    }
    if (mapping.counterAccountId) {
      if (mapping.partyId || mapping.financialCategoryId)
        throw new InvalidRequestError(
          "a transfer has a counter account and no party or financial category",
        );
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
    if (mapping.financialCategoryId) {
      const categories = await port.financialCategories.list(
        scope.handle,
        book(scope),
      );
      const category = categories.find(
        (each) => each.id === mapping.financialCategoryId,
      );
      const kind = direction === "PAYMENT" ? "EXPENSE" : "REVENUE";
      if (!category || category.kind !== kind)
        throw new InvalidRequestError(
          `financialCategoryId must be a ${kind} financial category of this Book for a ${direction} movement`,
        );
      if (isDeduction(category.id, categories))
        throw new InvalidRequestError(
          "a DEDUCTION financial category holds deductions, never a statement line",
        );
    }
  }

  /**
   * The transfer this movement is one side of. A link with the same transfer
   * key whose transfer has no link on this side yet is the other side's: join
   * it. Otherwise create the transfer.
   */
  async function transferFor(
    scope: BookScope,
    movement: AccountMovement,
    counterAccountId: string,
    statementKey: string,
  ): Promise<string> {
    const candidates = await port.accountMovementLinks.list(
      scope.handle,
      book(scope),
      { statementKey },
    );
    for (const each of candidates) {
      if (!each.transferId || each.direction === movement.direction) continue;
      const sides = await port.accountMovementLinks.list(
        scope.handle,
        book(scope),
        {
          transferId: each.transferId,
        },
      );
      if (!sides.some((side) => side.direction === movement.direction))
        return each.transferId;
    }
    // A card invoice paid from this account: the card's line is the other side.
    if (movement.direction === "PAYMENT")
      for (const each of await port.cardLinks.transfers(
        scope.handle,
        book(scope),
        { statementKey },
      )) {
        const sides = await port.accountMovementLinks.list(
          scope.handle,
          book(scope),
          {
            transferId: each.transferId,
          },
        );
        if (!sides.some((side) => side.direction === "PAYMENT"))
          return each.transferId;
      }
    const [sourceAccountId, destinationAccountId] =
      movement.direction === "PAYMENT"
        ? [movement.accountId, counterAccountId]
        : [counterAccountId, movement.accountId];
    const transfer = await call<Transfer>(
      revenueContracts.createTransfer,
      scope,
      {
        key: `statement-movement-${movement.id}`,
        sourceAccountId,
        destinationAccountId,
        name: nameOf(movement),
        amount: movement.amount.toString(),
        currency: movement.currency,
        referenceMonth: day(referenceMonthOf(movement.occurredOn)),
        occurredOn: day(movement.occurredOn),
        occurredAt: movement.occurredAt?.toISOString() ?? null,
      },
    );
    return transfer.id;
  }

  /**
   * What a deposit of a settlement group pays (ADR 20): the open records of
   * the acquirer's sales of that group, oldest first, whose nets add up to the
   * deposit exactly. Each record's gross settles the point of sale's revenues
   * of its day and method, in their proportions (gross, − discount, + tip),
   * and its fee settles the acquirer's fee revenue. Null when the records do
   * not add up to the deposit, or a revenue would be settled beyond its
   * amount: then a person decides.
   */
  async function salesPaidBy(
    scope: BookScope,
    movement: AccountMovement,
    group: string,
  ): Promise<{
    records: string[];
    shares: { revenueId: string; amount: bigint }[];
  } | null> {
    const descriptors = await port.revenueMovementDescriptors.list(
      scope.handle,
      book(scope),
      { settlementGroup: group },
    );
    if (!descriptors.some((each) => each.component === "ACQUIRER_FEE"))
      return operatorSalesPaidBy(
        scope,
        movement,
        descriptors.filter((each) => each.component === "GROSS"),
      );
    const candidates: {
      record: RevenueMovement;
      settlesMethodKey: string;
    }[] = [];
    for (const descriptor of descriptors) {
      const methodKey = descriptor.descriptorKey.replace(
        /_taxa_adquirente$/,
        "",
      );
      const records = await port.revenueMovements.list(
        scope.handle,
        book(scope),
        {
          accountId: descriptor.accountId,
          methodKey,
          status: "POSTED",
          limit: 1000,
        },
      );
      for (const record of records) {
        if (record.grossRecognized) continue;
        if (record.occurredOn.getTime() > movement.occurredOn.getTime())
          continue;
        if (
          (
            await port.revenueMovementReceipts.list(scope.handle, book(scope), {
              movementId: record.id,
            })
          ).length > 0
        )
          continue;
        candidates.push({
          record,
          settlesMethodKey: descriptor.settlesMethodKey as string,
        });
      }
    }
    candidates.sort(
      (a, b) =>
        a.record.occurredOn.getTime() - b.record.occurredOn.getTime() ||
        Number(a.record.id) - Number(b.record.id),
    );
    const covered: typeof candidates = [];
    let total = 0n;
    for (const each of candidates) {
      if (total === movement.amount) break;
      total += each.record.amount;
      covered.push(each);
      if (total > movement.amount) return null;
    }
    if (covered.length === 0 || total !== movement.amount) return null;

    const planned = new Map<string, bigint>();
    const add = (revenueId: string, amount: bigint) =>
      planned.set(revenueId, (planned.get(revenueId) ?? 0n) + amount);
    const linksOf = (id: string) =>
      port.revenueMovementLinks.list(scope.handle, book(scope), {
        movementId: id,
      });
    for (const { record, settlesMethodKey } of covered) {
      const fee = (await linksOf(record.id)).find(
        (each) => each.component === "ACQUIRER_FEE",
      );
      if (record.acquirerFee > 0n) {
        if (!fee) return null;
        add(fee.revenueId, -record.acquirerFee);
      }
      const sale = (
        await port.revenueMovements.list(scope.handle, book(scope), {
          methodKey: settlesMethodKey,
          occurredOn: record.occurredOn,
          status: "POSTED",
          limit: 10,
        })
      ).find((each) => each.grossRecognized);
      if (!sale) return null;
      const parts = new Map(
        (await linksOf(sale.id)).map((each) => [each.component, each]),
      );
      const gross = record.gross;
      const half = (numerator: bigint) =>
        (numerator * 2n + sale.amount) / (sale.amount * 2n);
      const discount = half(gross * sale.discount);
      const tip = half(gross * sale.fee);
      const products = parts.get("GROSS");
      if (!products) return null;
      add(products.revenueId, gross + discount - tip);
      const discounted = parts.get("DISCOUNT");
      if (discount > 0n) {
        if (!discounted) return null;
        add(discounted.revenueId, -discount);
      }
      const tipped = parts.get("FEE");
      if (tip > 0n) {
        if (!tipped) return null;
        add(tipped.revenueId, tip);
      }
    }
    // Never beyond what is still open on each revenue.
    for (const [revenueId, amount] of planned) {
      const revenue = await port.revenues.get(
        scope.handle,
        book(scope),
        revenueId,
      );
      if (!revenue) return null;
      const settled = (
        await port.revenueSettlements.list(scope.handle, book(scope), {
          revenueId,
        })
      )
        .filter((each) => !each.voidedAt)
        .reduce((sum, each) => sum + each.amount, 0n);
      const magnitude = (value: bigint) => (value < 0n ? -value : value);
      if (magnitude(settled + amount) > magnitude(revenue.amount)) return null;
    }
    const shares = [...planned.entries()]
      .filter(([, amount]) => amount !== 0n)
      .map(([revenueId, amount]) => ({ revenueId, amount }))
      // A receipt never goes below zero: the positive shares first.
      .sort((a, b) => (a.amount < 0n ? 1 : 0) - (b.amount < 0n ? 1 : 0));
    return { records: covered.map((each) => each.record.id), shares };
  }

  /**
   * What an operator's deposit pays when it sends no report of its own
   * (ADR 20, vouchers): the point of sale's open records of its group, oldest
   * first, filled in turn; the last one in part, its revenues in their
   * proportions (gross, − discount, + tip). What it keeps as its fee stays
   * open on the records. Null when the deposit is more than is open.
   */
  async function operatorSalesPaidBy(
    scope: BookScope,
    movement: AccountMovement,
    descriptors: readonly { accountId: string; descriptorKey: string }[],
  ): Promise<{
    records: string[];
    shares: { revenueId: string; amount: bigint }[];
  } | null> {
    if (descriptors.length === 0) return null;
    const records: RevenueMovement[] = [];
    for (const descriptor of descriptors)
      records.push(
        ...(
          await port.revenueMovements.list(scope.handle, book(scope), {
            accountId: descriptor.accountId,
            methodKey: descriptor.descriptorKey.replace(/_bruto$/, ""),
            status: "POSTED",
            limit: 1000,
          })
        ).filter(
          (each) =>
            each.grossRecognized &&
            each.occurredOn.getTime() <= movement.occurredOn.getTime(),
        ),
      );
    records.sort(
      (a, b) =>
        a.occurredOn.getTime() - b.occurredOn.getTime() ||
        Number(a.id) - Number(b.id),
    );
    const shares: { revenueId: string; amount: bigint }[] = [];
    const collected: string[] = [];
    let remaining = movement.amount;
    for (const record of records) {
      if (remaining === 0n) break;
      const open: {
        component: string;
        revenueId: string;
        outstanding: bigint;
      }[] = [];
      for (const link of await port.revenueMovementLinks.list(
        scope.handle,
        book(scope),
        { movementId: record.id },
      )) {
        const revenue = await port.revenues.get(
          scope.handle,
          book(scope),
          link.revenueId,
        );
        if (!revenue) continue;
        const settled = (
          await port.revenueSettlements.list(scope.handle, book(scope), {
            revenueId: revenue.id,
          })
        )
          .filter((each) => !each.voidedAt)
          .reduce((sum, each) => sum + each.amount, 0n);
        if (revenue.amount - settled !== 0n)
          open.push({
            component: link.component,
            revenueId: revenue.id,
            outstanding: revenue.amount - settled,
          });
      }
      const total = open.reduce((sum, each) => sum + each.outstanding, 0n);
      if (total <= 0n) continue;
      const take = remaining < total ? remaining : total;
      const half = (numerator: bigint) =>
        (numerator * 2n + (numerator < 0n ? -total : total)) / (total * 2n);
      let others = 0n;
      for (const each of open)
        if (each.component !== "GROSS") {
          const amount =
            take === total ? each.outstanding : half(take * each.outstanding);
          others += amount;
          if (amount !== 0n) shares.push({ revenueId: each.revenueId, amount });
        }
      const gross = open.find((each) => each.component === "GROSS");
      if (!gross) return null;
      const amount = take - others;
      if (amount > gross.outstanding) return null;
      if (amount !== 0n) shares.push({ revenueId: gross.revenueId, amount });
      collected.push(record.id);
      remaining -= take;
    }
    if (remaining !== 0n) return null;
    return {
      records: collected,
      // A receipt never goes below zero: the positive shares first.
      shares: shares.sort(
        (a, b) => (a.amount < 0n ? 1 : 0) - (b.amount < 0n ? 1 : 0),
      ),
    };
  }

  /**
   * The receipt another sighting of the same money already created (ADR 20):
   * an acquirer's payout report and the bank statement both show one deposit,
   * with one statement key. A receipt joins at most one sighting of each
   * content type, so two equal deposits on one day pair one to one.
   */
  async function sightedReceipt(
    scope: BookScope,
    movement: AccountMovement,
    statementKey: string,
  ): Promise<AccountMovementLink | null> {
    if (movement.direction !== "RECEIPT") return null;
    const typeOf = async (fileId: string) =>
      (await port.movementFiles.get(scope.handle, book(scope), fileId))
        ?.movementType;
    const own = await typeOf(movement.fileId);
    const links = (
      await port.accountMovementLinks.list(scope.handle, book(scope), {
        statementKey,
      })
    ).filter(
      (each) =>
        each.direction === "RECEIPT" &&
        each.receiptId !== null &&
        each.movementId !== movement.id,
    );
    const receipts = new Map<string, AccountMovementLink[]>();
    for (const each of links)
      receipts.set(each.receiptId as string, [
        ...(receipts.get(each.receiptId as string) ?? []),
        each,
      ]);
    for (const sightings of receipts.values()) {
      const types = new Set<string | undefined>();
      for (const each of sightings) {
        const other = await port.accountMovements.get(
          scope.handle,
          book(scope),
          each.movementId,
        );
        if (other) types.add(await typeOf(other.fileId));
      }
      if (!types.has(own)) return sightings[0] ?? null;
    }
    return null;
  }

  /* An expense or revenue a post created is found again by this key after an undo. */
  const recordKey = (movement: AccountMovement) =>
    `statement-${movement.accountId}-${movement.externalId}`;

  /** The expense or revenue a party and financial category post this movement as. */
  async function entryFor(
    scope: BookScope,
    movement: AccountMovement,
    partyId: string,
    financialCategoryId: string,
  ): Promise<string> {
    const key = recordKey(movement);
    const known =
      movement.direction === "PAYMENT"
        ? await port.expenses.getByKey(scope.handle, book(scope), key)
        : await port.revenues.getByKey(scope.handle, book(scope), key);
    if (known) {
      if (
        known.partyId !== partyId ||
        known.financialCategoryId !== financialCategoryId
      )
        throw new MovementConflictError(
          `this movement was posted before as ${known.key} with another party or financial category; post it with ${movement.direction === "PAYMENT" ? "expenses" : "revenues"}, or with the same classification`,
          { key: known.key },
        );
      return known.id;
    }
    const input = {
      key,
      partyId,
      financialCategoryId,
      name: nameOf(movement),
      amount: movement.amount.toString(),
      currency: movement.currency,
      referenceMonth: day(referenceMonthOf(movement.occurredOn)),
      occurredOn: day(movement.occurredOn),
      occurredAt: movement.occurredAt?.toISOString() ?? null,
    };
    const created =
      movement.direction === "PAYMENT"
        ? await call<Expense>(expenseContracts.createExpense, scope, input)
        : await call<Revenue>(revenueContracts.createRevenue, scope, input);
    return created.id;
  }

  /** The party of an existing expense or revenue a share settles. */
  async function partyOfEntry(
    scope: BookScope,
    direction: MovementDirection,
    id: string,
  ): Promise<string> {
    const entry =
      direction === "PAYMENT"
        ? await port.expenses.get(scope.handle, book(scope), id)
        : await port.revenues.get(scope.handle, book(scope), id);
    if (!entry)
      throw new InvalidRequestError(
        `${direction === "PAYMENT" ? "expenseId" : "revenueId"} ${id} names no record of this Book`,
      );
    return entry.partyId;
  }

  /**
   * One payment (or receipt) on the movement's date, from its account,
   * settling each share; one link per share.
   */
  async function settle(
    scope: BookScope,
    movement: AccountMovement,
    method: PaymentMethod,
    shares: readonly (Share & { partyId: string })[],
  ): Promise<AccountMovementLink[]> {
    // A promise is due on its day and not yet paid; the bank line pays it.
    const dates = {
      dueOn: day(movement.occurredOn),
      ...(movement.promise
        ? {}
        : {
            paidOn: day(movement.occurredOn),
            ...(movement.occurredAt
              ? { paidAt: movement.occurredAt.toISOString() }
              : {}),
          }),
    };
    const cash = {
      accountId: movement.accountId,
      method,
      currency: movement.currency,
      referenceMonth: day(referenceMonthOf(movement.occurredOn)),
      ...dates,
    };
    const payment = movement.direction === "PAYMENT";
    const record = payment
      ? await call<Payment>(expenseContracts.createPayment, scope, cash)
      : await call<Receipt>(revenueContracts.createReceipt, scope, cash);
    const links: AccountMovementLink[] = [];
    const external = linkExternalKey(movement);
    for (const share of shares) {
      if (payment)
        await call(expenseContracts.settleExpense, scope, {
          expenseId: share.id,
          paymentId: record.id,
          amount: share.amount.toString(),
        });
      else
        await call(revenueContracts.settleRevenue, scope, {
          revenueId: share.id,
          receiptId: record.id,
          amount: share.amount.toString(),
        });
      links.push(
        await port.accountMovementLinks.insert(scope.handle, book(scope), {
          direction: movement.direction,
          movementId: movement.id,
          externalKey: linkExternalKey(movement),
          statementKey: statementKeyOf(
            movement,
            { partyId: share.partyId },
            share.amount,
            method,
          ),
          amount: share.amount,
          transferId: null,
          expenseId: payment ? share.id : null,
          expenseKey: payment ? `${external}-${links.length + 1}` : null,
          paymentId: payment ? record.id : null,
          paymentKey: payment ? `${external}-payment` : null,
          revenueId: payment ? null : share.id,
          revenueKey: payment ? null : `${external}-${links.length + 1}`,
          receiptId: payment ? null : record.id,
          receiptKey: payment ? null : `${external}-receipt`,
        }),
      );
    }
    return links;
  }

  /**
   * Money in for sales already recognized (ADR 20): one receipt, from the
   * party, and no revenue. Another sighting of the same deposit with the same
   * statement key already made the receipt: join it, paying it when this is
   * the bank line. Otherwise the deposit's sales settle into a new receipt,
   * expected when it is a promise.
   */
  async function receiveSales(
    scope: BookScope,
    movement: AccountMovement,
    partyId: string,
    group: string,
    method: PaymentMethod,
  ): Promise<AccountMovementLink> {
    const statementKey = statementKeyOf(
      movement,
      { partyId },
      movement.amount,
      method,
    );
    const external = linkExternalKey(movement);
    const sighted = await sightedReceipt(scope, movement, statementKey);
    let receiptId: string;
    if (sighted?.receiptId) {
      receiptId = sighted.receiptId;
      if (!movement.promise) {
        const receipt = await port.receipts.get(
          scope.handle,
          book(scope),
          receiptId,
        );
        if (receipt && !receipt.paidOn)
          await port.receipts.setPaid(scope.handle, book(scope), receiptId, {
            paidOn: movement.occurredOn,
            paidAt: movement.occurredAt,
          });
      }
    } else {
      const paid = await salesPaidBy(scope, movement, group);
      if (!paid) throw new SalesNotMatchedError(movement, group);
      const receipt = await call<Receipt>(
        revenueContracts.createReceipt,
        scope,
        {
          accountId: movement.accountId,
          method,
          currency: movement.currency,
          referenceMonth: day(referenceMonthOf(movement.occurredOn)),
          dueOn: day(movement.occurredOn),
          ...(movement.promise
            ? {}
            : {
                paidOn: day(movement.occurredOn),
                ...(movement.occurredAt
                  ? { paidAt: movement.occurredAt.toISOString() }
                  : {}),
              }),
        },
      );
      receiptId = receipt.id;
      for (const share of paid.shares) {
        await port.lockRevenueSet(
          scope.handle,
          book(scope),
          share.revenueId,
          receiptId,
        );
        const settlement = await port.revenueSettlements.insert(
          scope.handle,
          book(scope),
          {
            revenueId: share.revenueId,
            receiptId,
            amount: share.amount,
            currency: movement.currency,
            description: null,
          },
        );
        scope.audit({
          action: "revenue_settlement.created",
          resourceType: "revenue_settlement",
          resourceId: settlement.id,
          payload: {
            revenueId: share.revenueId,
            receiptId,
            amount: share.amount.toString(),
            movementId: movement.id,
          },
        });
      }
      for (const record of paid.records)
        await port.revenueMovementReceipts.insert(scope.handle, book(scope), {
          movementId: record,
          receiptId,
          own: false,
        });
    }
    return port.accountMovementLinks.insert(scope.handle, book(scope), {
      direction: movement.direction,
      movementId: movement.id,
      externalKey: external,
      statementKey,
      amount: movement.amount,
      transferId: null,
      expenseId: null,
      expenseKey: null,
      paymentId: null,
      paymentKey: null,
      revenueId: null,
      revenueKey: null,
      receiptId,
      receiptKey: `${external}-receipt`,
    });
  }

  /* Posting on its own: a deposit whose sales do not add up waits for a person. */
  async function postOrWait(
    scope: BookScope,
    movement: AccountMovement,
    mapping: AccountMovementMapping,
  ): Promise<boolean> {
    try {
      await post(scope, movement, mapping);
      return true;
    } catch (error) {
      if (error instanceof SalesNotMatchedError) return false;
      throw error;
    }
  }

  /** Post a PENDING movement; its links record what it became. */
  async function post(
    scope: BookScope,
    movement: AccountMovement,
    mapping: AccountMovementMapping,
    shares?: readonly Share[],
  ): Promise<{ movement: AccountMovement; links: AccountMovementLink[] }> {
    if (movement.status !== "PENDING")
      throw new MovementStateError(
        `movement ${movement.id} is ${movement.status}; undo it before posting it again`,
      );
    const method = mapping.paymentMethod;
    if (!method)
      throw new InvalidRequestError(
        "posting needs a paymentMethod (from the descriptor, or the call): it is part of the statement key",
      );
    let links: AccountMovementLink[];
    let applied = mapping;
    if (shares) {
      const total = shares.reduce((sum, each) => sum + each.amount, 0n);
      if (total !== movement.amount)
        throw new InvalidRequestError(
          `the shares add up to ${total}; the movement moves ${movement.amount}`,
        );
      const withParty = [];
      for (const share of shares)
        withParty.push({
          ...share,
          partyId: await partyOfEntry(scope, movement.direction, share.id),
        });
      links = await settle(scope, movement, method, withParty);
      applied = {
        partyId: null,
        financialCategoryId: null,
        counterAccountId: null,
        paymentMethod: method,
        settlementGroup: null,
      };
    } else if (mapping.counterAccountId) {
      const statementKey = statementKeyOf(
        movement,
        { accountId: mapping.counterAccountId },
        movement.amount,
        method,
      );
      const transferId = await transferFor(
        scope,
        movement,
        mapping.counterAccountId,
        statementKey,
      );
      links = [
        await port.accountMovementLinks.insert(scope.handle, book(scope), {
          direction: movement.direction,
          movementId: movement.id,
          externalKey: linkExternalKey(movement),
          expenseKey: null,
          paymentKey: null,
          revenueKey: null,
          receiptKey: null,
          statementKey,
          amount: movement.amount,
          transferId,
          expenseId: null,
          paymentId: null,
          revenueId: null,
          receiptId: null,
        }),
      ];
    } else if (mapping.settlementGroup && mapping.partyId) {
      links = [
        await receiveSales(
          scope,
          movement,
          mapping.partyId,
          mapping.settlementGroup,
          method,
        ),
      ];
    } else if (mapping.partyId && mapping.financialCategoryId) {
      const statementKey = statementKeyOf(
        movement,
        { partyId: mapping.partyId },
        movement.amount,
        method,
      );
      const sighted = await sightedReceipt(scope, movement, statementKey);
      if (sighted) {
        // The same deposit seen again: link the receipt it already became.
        // The bank line is the promise kept: it pays the expected receipt.
        if (!movement.promise && sighted.receiptId) {
          const receipt = await port.receipts.get(
            scope.handle,
            book(scope),
            sighted.receiptId,
          );
          if (receipt && !receipt.paidOn)
            await port.receipts.setPaid(
              scope.handle,
              book(scope),
              sighted.receiptId,
              { paidOn: movement.occurredOn, paidAt: movement.occurredAt },
            );
        }
        const external = linkExternalKey(movement);
        links = [
          await port.accountMovementLinks.insert(scope.handle, book(scope), {
            direction: movement.direction,
            movementId: movement.id,
            externalKey: external,
            statementKey,
            amount: movement.amount,
            transferId: null,
            expenseId: null,
            expenseKey: null,
            paymentId: null,
            paymentKey: null,
            revenueId: sighted.revenueId,
            revenueKey: `${external}-1`,
            receiptId: sighted.receiptId,
            receiptKey: `${external}-receipt`,
          }),
        ];
      } else {
        const entryId = await entryFor(
          scope,
          movement,
          mapping.partyId,
          mapping.financialCategoryId,
        );
        links = await settle(scope, movement, method, [
          { id: entryId, amount: movement.amount, partyId: mapping.partyId },
        ]);
      }
    } else
      throw new InvalidRequestError(
        "posting needs counterAccountId, expenses or revenues, partyId with a settlementGroup, or both partyId and financialCategoryId (from the call or the descriptor)",
      );
    const posted = await port.accountMovements.update(
      scope.handle,
      book(scope),
      movement.id,
      { status: "POSTED", ...applied },
    );
    scope.audit({
      action: "movement.posted",
      resourceType: "movement",
      resourceId: movement.id,
      payload: {
        direction: movement.direction,
        accountId: movement.accountId,
        externalId: movement.externalId,
        ...applied,
        links: links.map((each) => ({
          id: each.id,
          statementKey: each.statementKey,
          amount: each.amount.toString(),
          transferId: each.transferId,
          expenseId: each.expenseId,
          paymentId: each.paymentId,
          revenueId: each.revenueId,
          receiptId: each.receiptId,
        })),
      },
    });
    return { movement: posted, links };
  }

  /**
   * Bring a descriptor's PENDING movements to its classification and post the
   * ones that are now complete.
   */
  async function postPendingOf(
    scope: BookScope,
    descriptor: DescriptorRef & AccountMovementMapping,
    except?: string,
  ): Promise<number> {
    let posted = 0;
    let after: string | undefined;
    for (;;) {
      const page = await port.accountMovements.list(scope.handle, book(scope), {
        accountId: descriptor.accountId,
        direction: descriptor.direction,
        descriptorKey: descriptor.descriptorKey,
        status: "PENDING",
        limit: PAGE,
        after,
      });
      for (const each of page) {
        if (each.id === except) continue;
        const movement = await movementOf(scope, each.id);
        const mapping = initialMapping(descriptor);
        const updated = await port.accountMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          mapping,
        );
        if (isComplete(mapping) && (await postOrWait(scope, updated, mapping)))
          posted += 1;
      }
      if (page.length < PAGE) return posted;
      after = page.at(-1)?.id;
    }
  }

  async function classify(
    scope: BookScope,
    ref: DescriptorRef,
    patch: Partial<AccountMovementMapping>,
    except?: string,
  ) {
    const descriptor = await port.accountMovementDescriptors.get(
      scope.handle,
      book(scope),
      ref,
    );
    if (!descriptor) throw new UnauthorizedError();
    const pick = <K extends keyof AccountMovementMapping>(key: K) =>
      patch[key] !== undefined
        ? (patch[key] as AccountMovementMapping[K])
        : descriptor[key];
    const mapping: AccountMovementMapping = {
      partyId: pick("partyId"),
      financialCategoryId: pick("financialCategoryId"),
      counterAccountId: pick("counterAccountId"),
      paymentMethod: pick("paymentMethod"),
      settlementGroup: pick("settlementGroup"),
    };
    // Naming a counter account makes it a transfer; naming a party, not one.
    // A settlement group and a financial category exclude each other.
    if (patch.counterAccountId) {
      mapping.partyId = patch.partyId ?? null;
      mapping.financialCategoryId = patch.financialCategoryId ?? null;
      mapping.settlementGroup = null;
    } else if (patch.partyId || patch.financialCategoryId)
      mapping.counterAccountId = null;
    if (patch.settlementGroup) mapping.financialCategoryId = null;
    else if (patch.financialCategoryId) mapping.settlementGroup = null;
    await assertMapping(scope, ref.direction, ref.accountId, mapping);
    const classified = await port.accountMovementDescriptors.classify(
      scope.handle,
      book(scope),
      ref,
      mapping,
    );
    scope.audit({
      action: "movement_descriptor.classified",
      resourceType: "movement_descriptor",
      resourceId: `${ref.direction}:${ref.accountId}:${ref.descriptorKey}`,
      payload: { ...ref, ...mapping },
    });
    const posted = await postPendingOf(scope, classified, except);
    return { descriptor: classified, posted };
  }

  async function accountOf(scope: BookScope, accountId: string) {
    const account = await port.accounts.get(
      scope.handle,
      book(scope),
      accountId,
    );
    if (!account)
      throw new InvalidRequestError("accountId names no account of this Book");
    return account;
  }

  const api: AccountMovementsApi = {
    consumerOf: (scope, accountId, movementType) =>
      port.movementConsumers.get(
        scope.handle,
        book(scope),
        accountId,
        movementType,
      ),

    async setConsumer(scope, input) {
      if (!MOVEMENT_TYPE.test(input.movementType))
        throw new InvalidRequestError(
          "movementType is lowercase, such as account-movements",
        );
      await accountOf(scope, input.accountId);
      const consumer = await port.movementConsumers.set(
        scope.handle,
        book(scope),
        { ...input, setBy: actor(scope) },
      );
      scope.audit({
        action: "statement_consumer.set",
        resourceType: "statement_consumer",
        resourceId: `${input.accountId}:${input.movementType}`,
        payload: input,
      });
      return consumer;
    },

    listConsumers: (scope, query) =>
      port.movementConsumers.list(scope.handle, book(scope), query),

    async intake(scope, input) {
      const account = await accountOf(scope, input.accountId);
      if (account.type !== "ACCOUNT")
        throw new InvalidRequestError(
          `a statement is taken into an ACCOUNT; account ${account.id} is ${account.type}`,
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
        // A write that records nothing is refused, so even a replay leaves a trace.
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

      // One line per provider id; the same id must say the same thing. A line
      // with no id is its text's hash, `#n` for the n-th identical line.
      const byId = new Map<
        string,
        AccountMovementObservation & { externalId: string }
      >();
      const repeats = new Map<string, number>();
      for (const observed of input.observations) {
        if (observed.amount === 0n)
          throw new InvalidRequestError(
            `line ${observed.externalId ?? observed.line} moves no money`,
          );
        if (observed.promise && observed.amount < 0n)
          throw new InvalidRequestError(
            `line ${observed.externalId ?? observed.line}: only money in is promised`,
          );
        let externalId = observed.externalId;
        if (externalId === null) {
          const hash = await sha256(observed.line);
          const repeat = (repeats.get(hash) ?? 0) + 1;
          repeats.set(hash, repeat);
          externalId = repeat > 1 ? `${hash}#${repeat}` : hash;
        }
        const line = { ...observed, externalId };
        const seen = byId.get(externalId);
        if (seen && !sameMovement(seen, line))
          throw new MovementConflictError(
            `line ${externalId} appears twice with a different date or amount`,
            { externalId },
          );
        byId.set(externalId, line);
      }
      const lines = [...byId.values()];
      const staged = new Map(
        (
          await port.accountMovements.findByExternalIds(
            scope.handle,
            book(scope),
            account.id,
            lines.map((line) => line.externalId),
          )
        ).map((movement) => [movement.externalId, movement]),
      );
      for (const line of lines) {
        const known = staged.get(line.externalId);
        if (!known) continue;
        const sign = known.direction === "PAYMENT" ? -1n : 1n;
        if (
          !sameMovement(known, {
            occurredOn: line.occurredOn,
            amount: line.amount * sign,
          })
        )
          throw new MovementConflictError(
            `line ${line.externalId} was taken in before with another date or amount; the bank changed a past movement`,
            { externalId: line.externalId, movementId: known.id },
          );
      }
      const fresh = lines.filter((line) => !staged.has(line.externalId));

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

      let posted = 0;
      for (const line of fresh) {
        const direction: MovementDirection =
          line.amount < 0n ? "PAYMENT" : "RECEIPT";
        const descriptor = await port.accountMovementDescriptors.ensure(
          scope.handle,
          book(scope),
          {
            direction,
            accountId: account.id,
            descriptorKey: descriptorKey(line.name),
            name: line.name,
          },
        );
        const mapping = initialMapping(descriptor);
        const movement = await port.accountMovements.insert(
          scope.handle,
          book(scope),
          {
            direction,
            accountId: account.id,
            fileId: file.id,
            externalId: line.externalId,
            occurredOn: line.occurredOn,
            occurredAt: line.occurredAt,
            amount: line.amount < 0n ? -line.amount : line.amount,
            currency: line.currency,
            name: line.name,
            descriptorKey: descriptor.descriptorKey,
            description: line.description,
            promise: line.promise ?? false,
            ...mapping,
          },
        );
        if (isComplete(mapping) && (await postOrWait(scope, movement, mapping)))
          posted += 1;
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

  type ListInput = z.infer<typeof contracts.listPaymentMovements.input>;
  type DescriptorListInput = z.infer<
    typeof contracts.listPaymentMovementDescriptors.input
  >;
  type LinkInput = z.infer<typeof contracts.listPaymentMovementLinks.input> &
    z.infer<typeof contracts.listReceiptMovementLinks.input>;
  type ClassifyInput = z.infer<
    typeof contracts.classifyPaymentMovementDescriptor.input
  > &
    z.infer<typeof contracts.classifyReceiptMovementDescriptor.input>;
  type PostInput = z.infer<typeof contracts.postPaymentMovement.input> &
    z.infer<typeof contracts.postReceiptMovement.input>;
  type IdInput = { id: string; reason?: string };

  /*
   * One side's handlers: the same rules with the side fixed. A movement of
   * the other side is as absent as one of another Book.
   */
  function sideHandlers(direction: MovementDirection) {
    async function sideMovement(scope: BookScope, id: string) {
      const movement = await movementOf(scope, id);
      if (movement.direction !== direction) throw new UnauthorizedError();
      return movement;
    }
    return {
      list: async (scope: BookScope, input: ListInput) =>
        page(
          await port.accountMovements.list(scope.handle, book(scope), {
            accountId: input.accountId,
            direction: direction,
            status: input.status,
            descriptorKey: input.descriptorKey,
            after: input.cursor,
            limit: input.limit,
          }),
          input.limit,
        ),
      descriptors: async (scope: BookScope, input: DescriptorListInput) => ({
        items: await port.accountMovementDescriptors.list(
          scope.handle,
          book(scope),
          { ...input, direction },
        ),
      }),
      links: async (scope: BookScope, input: LinkInput) => {
        const { expenseKey, paymentKey, revenueKey, receiptKey, ...rest } =
          input;
        const links = await port.accountMovementLinks.list(
          scope.handle,
          book(scope),
          {
            ...rest,
            entryKey: expenseKey ?? revenueKey,
            cashKey: paymentKey ?? receiptKey,
          },
        );
        // A statement key or transfer is shared by both sides; answer this one's.
        return { items: links.filter((each) => each.direction === direction) };
      },
      classify: async (scope: BookScope, input: ClassifyInput) => {
        const { accountId, descriptorKey: key, ...patch } = input;
        return classify(
          scope,
          { accountId, direction, descriptorKey: key },
          patch,
        );
      },
      post: async (scope: BookScope, input: PostInput) => {
        const movement = await sideMovement(scope, input.id);
        const descriptor = await port.accountMovementDescriptors.get(
          scope.handle,
          book(scope),
          refOf(movement),
        );
        const given = [
          input.partyId,
          input.financialCategoryId,
          input.counterAccountId,
        ].some((value) => value !== undefined);
        // A named classification wins as a whole; otherwise the movement's own.
        const mapping: AccountMovementMapping = {
          partyId: given ? (input.partyId ?? null) : movement.partyId,
          financialCategoryId: given
            ? (input.financialCategoryId ?? null)
            : movement.financialCategoryId,
          counterAccountId: given
            ? (input.counterAccountId ?? null)
            : movement.counterAccountId,
          paymentMethod:
            input.paymentMethod !== undefined
              ? input.paymentMethod
              : movement.paymentMethod,
          settlementGroup: given
            ? (input.settlementGroup ?? null)
            : input.settlementGroup !== undefined
              ? input.settlementGroup
              : movement.settlementGroup,
        };
        const named =
          movement.direction === "PAYMENT"
            ? input.expenses?.map((each) => ({
                id: each.expenseId,
                amount: BigInt(each.amount),
              }))
            : input.revenues?.map((each) => ({
                id: each.revenueId,
                amount: BigInt(each.amount),
              }));
        if (
          (movement.direction === "PAYMENT" && input.revenues) ||
          (movement.direction === "RECEIPT" && input.expenses)
        )
          throw new InvalidRequestError(
            "a PAYMENT movement settles expenses, a RECEIPT movement revenues",
          );
        if (!named)
          await assertMapping(
            scope,
            movement.direction,
            movement.accountId,
            mapping,
          );
        const result = await post(scope, movement, mapping, named);
        if (
          input.remember !== false &&
          descriptor &&
          !isClassified(descriptor) &&
          !named &&
          isComplete(mapping)
        )
          await classify(scope, refOf(movement), mapping, movement.id);
        return result;
      },
      ignore: async (scope: BookScope, input: IdInput) => {
        const movement = await sideMovement(scope, input.id);
        if (movement.status !== "PENDING")
          throw new MovementStateError(
            `movement ${movement.id} is ${movement.status}; only a PENDING movement is ignored`,
          );
        const ignored = await port.accountMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          { status: "IGNORED", ignoreReason: input.reason },
        );
        scope.audit({
          action: "movement.ignored",
          resourceType: "movement",
          resourceId: movement.id,
          payload: { reason: input.reason },
        });
        return ignored;
      },
      undo: async (scope: BookScope, input: IdInput) => {
        const movement = await sideMovement(scope, input.id);
        if (movement.status === "PENDING")
          throw new MovementStateError(
            `movement ${movement.id} is already PENDING`,
          );
        const reason = input.reason ?? `undo of movement ${movement.id}`;
        const links = await port.accountMovementLinks.list(
          scope.handle,
          book(scope),
          {
            movementId: movement.id,
          },
        );
        await port.accountMovementLinks.removeOfMovement(
          scope.handle,
          book(scope),
          movement.id,
        );
        const pending = await port.accountMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          { status: "PENDING", ignoreReason: null },
        );
        for (const transferId of new Set(
          links.flatMap((each) => (each.transferId ? [each.transferId] : [])),
        )) {
          const others = [
            ...(await port.accountMovementLinks.list(
              scope.handle,
              book(scope),
              {
                transferId,
              },
            )),
            ...(await port.cardLinks.transfers(scope.handle, book(scope), {
              transferId,
            })),
          ];
          if (others.length > 0) continue;
          await port.transfers.remove(scope.handle, book(scope), transferId);
          scope.audit({
            action: "transfer.removed",
            resourceType: "transfer",
            resourceId: transferId,
            payload: { movementId: movement.id, reason },
          });
        }
        for (const paymentId of new Set(
          links.flatMap((each) => (each.paymentId ? [each.paymentId] : [])),
        )) {
          const settlements = await port.expenseSettlements.list(
            scope.handle,
            book(scope),
            { paymentId },
          );
          // A discount is voided with the share it reduces, by that share's void.
          const discounts = new Set<string>();
          for (const each of settlements) {
            const expense = await port.expenses.get(
              scope.handle,
              book(scope),
              each.expenseId,
            );
            if (expense && expense.amount < 0n) discounts.add(each.id);
          }
          for (const each of settlements)
            if (!each.voidedAt && !discounts.has(each.id))
              await call(expenseContracts.voidExpenseSettlement, scope, {
                id: each.id,
                voidReason: reason,
              });
        }
        for (const receiptId of new Set(
          links.flatMap((each) => (each.receiptId ? [each.receiptId] : [])),
        )) {
          // Another sighting of the same deposit still stands on this receipt.
          const others = (
            await Promise.all(
              links.map((each) =>
                port.accountMovementLinks.list(scope.handle, book(scope), {
                  statementKey: each.statementKey,
                }),
              ),
            )
          )
            .flat()
            .filter(
              (each) =>
                each.receiptId === receiptId && each.movementId !== movement.id,
            );
          if (others.length > 0) {
            // Only the promise is left: the money is expected again.
            if (!movement.promise) {
              let kept = false;
              for (const each of others) {
                const other = await port.accountMovements.get(
                  scope.handle,
                  book(scope),
                  each.movementId,
                );
                if (other && !other.promise) kept = true;
              }
              if (!kept)
                await port.receipts.setPaid(
                  scope.handle,
                  book(scope),
                  receiptId,
                  {
                    paidOn: null,
                    paidAt: null,
                  },
                );
            }
            continue;
          }
          const settlements = await port.revenueSettlements.list(
            scope.handle,
            book(scope),
            { receiptId },
          );
          // A receipt never goes below zero: the negative shares first.
          for (const each of [...settlements].sort(
            (a, b) => (a.amount < 0n ? 0 : 1) - (b.amount < 0n ? 0 : 1),
          ))
            if (!each.voidedAt)
              await call(revenueContracts.voidRevenueSettlement, scope, {
                id: each.id,
                voidReason: reason,
              });
          await port.revenueMovementReceipts.removeOfReceipt(
            scope.handle,
            book(scope),
            receiptId,
          );
        }
        scope.audit({
          action: "movement.undone",
          resourceType: "movement",
          resourceId: movement.id,
          payload: {
            was: movement.status,
            links: links.map((each) => each.id),
            reason,
          },
        });
        return pending;
      },
    };
  }

  const payments = sideHandlers("PAYMENT");
  const receipts = sideHandlers("RECEIPT");
  const paymentOut = ({
    direction: _side,
    promise: _promise,
    settlementGroup: _group,
    ...rest
  }: AccountMovement) => rest;
  const receiptOut = ({ direction: _side, ...rest }: AccountMovement) => rest;
  const paymentDescriptorOut = ({
    direction: _side,
    settlementGroup: _group,
    ...rest
  }: AccountMovementDescriptor) => rest;
  const receiptDescriptorOut = ({
    direction: _side,
    ...rest
  }: AccountMovementDescriptor) => rest;
  const paymentLinkOut = ({
    direction: _side,
    revenueId: _r,
    revenueKey: _rk,
    receiptId: _c,
    receiptKey: _ck,
    ...rest
  }: AccountMovementLink) => rest;
  const receiptLinkOut = ({
    direction: _side,
    expenseId: _e,
    expenseKey: _ek,
    paymentId: _p,
    paymentKey: _pk,
    ...rest
  }: AccountMovementLink) => rest;

  return {
    api,
    handlers: [
      bind(contracts.listMovementFiles, async ({ scope, input }) =>
        page(
          await port.movementFiles.list(scope.handle, book(scope), {
            accountId: input.accountId,
            after: input.cursor,
            limit: input.limit,
          }),
          input.limit,
        ),
      ),

      bind(contracts.listPaymentMovements, async ({ scope, input }) => {
        const listed = await payments.list(scope, input);
        return { ...listed, items: listed.items.map(paymentOut) };
      }),
      bind(
        contracts.listPaymentMovementDescriptors,
        async ({ scope, input }) => ({
          items: (await payments.descriptors(scope, input)).items.map(
            paymentDescriptorOut,
          ),
        }),
      ),
      bind(contracts.listPaymentMovementLinks, async ({ scope, input }) => ({
        items: (await payments.links(scope, input)).items.map(paymentLinkOut),
      })),
      bind(
        contracts.classifyPaymentMovementDescriptor,
        async ({ scope, input }) => {
          const result = await payments.classify(scope, input);
          return {
            ...result,
            descriptor: paymentDescriptorOut(result.descriptor),
          };
        },
      ),
      bind(contracts.postPaymentMovement, async ({ scope, input }) => {
        const result = await payments.post(scope, input);
        return {
          movement: paymentOut(result.movement),
          links: result.links.map(paymentLinkOut),
        };
      }),
      bind(contracts.ignorePaymentMovement, async ({ scope, input }) =>
        paymentOut(await payments.ignore(scope, input)),
      ),
      bind(contracts.undoPaymentMovement, async ({ scope, input }) =>
        paymentOut(await payments.undo(scope, input)),
      ),

      bind(contracts.listReceiptMovements, async ({ scope, input }) => {
        const listed = await receipts.list(scope, input);
        return { ...listed, items: listed.items.map(receiptOut) };
      }),
      bind(
        contracts.listReceiptMovementDescriptors,
        async ({ scope, input }) => ({
          items: (await receipts.descriptors(scope, input)).items.map(
            receiptDescriptorOut,
          ),
        }),
      ),
      bind(contracts.listReceiptMovementLinks, async ({ scope, input }) => ({
        items: (await receipts.links(scope, input)).items.map(receiptLinkOut),
      })),
      bind(
        contracts.classifyReceiptMovementDescriptor,
        async ({ scope, input }) => {
          const result = await receipts.classify(scope, input);
          return {
            ...result,
            descriptor: receiptDescriptorOut(result.descriptor),
          };
        },
      ),
      bind(contracts.postReceiptMovement, async ({ scope, input }) => {
        const result = await receipts.post(scope, input);
        return {
          movement: receiptOut(result.movement),
          links: result.links.map(receiptLinkOut),
        };
      }),
      bind(contracts.ignoreReceiptMovement, async ({ scope, input }) =>
        receiptOut(await receipts.ignore(scope, input)),
      ),
      bind(contracts.undoReceiptMovement, async ({ scope, input }) =>
        receiptOut(await receipts.undo(scope, input)),
      ),
    ],
  };
}
