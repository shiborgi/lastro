/**
 * Revenue movement evidence's use cases (ADR 19): taking a point of sale's day
 * by payment method in, classifying each method's components, and posting a
 * record as up to three revenues (gross, discount, fee).
 *
 * The component descriptors decide everything (ADR 16); there is no choosing
 * an existing record. A record posts when every component it carries has a
 * filled descriptor; each revenue is keyed `<record key>-<component>` and is
 * found again by that key after an undo.
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
import * as contracts from "../contracts/revenue-movements";
import * as revenueContracts from "../contracts/revenues";
import {
  type ImporterIdentity,
  MovementConflictError,
  MovementStateError,
  descriptorKey,
  linkExternalKey,
  referenceMonthOf,
} from "../domain/account-movements";
import { isDeduction } from "../domain/catalog";
import type { Receipt, Revenue } from "../domain/records";
import {
  COMPONENT_SUFFIX,
  type RevenueComponent,
  type RevenueMovement,
  type RevenueMovementDescriptor,
  type RevenueMovementLink,
  type RevenueObservation,
  addsUp,
  componentKey,
  componentsOf,
  isDeductionComponent,
} from "../domain/revenue-movements";
import type { CallOperation, MovementIntakeResult } from "./account-movements";
import type { FinancePort } from "./port";

type BookScope = Scope<ExecutionContext>;

export type RevenueMovementIntake = {
  accountId: string;
  movementType: string;
  importer: ImporterIdentity;
  contentSha256: string;
  sourceKey: string;
  observations: readonly RevenueObservation[];
};

export type RevenueMovementsApi = {
  /**
   * Take in one payment report. The same content again answers its first
   * intake; a record already staged (same key) counts as known. Records whose
   * component descriptors are all filled post at once.
   */
  intake(
    scope: BookScope,
    input: RevenueMovementIntake,
  ): Promise<MovementIntakeResult>;
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

export function createRevenueMovements(
  port: FinancePort,
  call: CallOperation,
): { api: RevenueMovementsApi; handlers: BoundOperation[] } {
  const book = (scope: BookScope) => scope.context.bookId;
  const actor = (scope: BookScope) =>
    scope.context.agentPrincipal ?? scope.context.actorId;
  const day = (value: Date) => textFromDate(value);

  async function movementOf(
    scope: BookScope,
    id: string,
  ): Promise<RevenueMovement> {
    await port.revenueMovements.lock(scope.handle, book(scope), id);
    const movement = await port.revenueMovements.get(
      scope.handle,
      book(scope),
      id,
    );
    if (!movement) throw new UnauthorizedError();
    return movement;
  }

  /** Each component's descriptor, or why the record cannot post yet. */
  async function descriptorsOf(
    scope: BookScope,
    movement: RevenueMovement,
  ): Promise<
    | {
        ready: true;
        parts: {
          component: RevenueComponent;
          amount: bigint;
          descriptor: RevenueMovementDescriptor;
        }[];
      }
    | { ready: false; reason: string }
  > {
    const parts = [];
    for (const { component, amount } of componentsOf(movement)) {
      const key = componentKey(movement.methodKey, component);
      const descriptor = await port.revenueMovementDescriptors.get(
        scope.handle,
        book(scope),
        movement.accountId,
        key,
      );
      if (!descriptor?.partyId || !descriptor.financialCategoryId)
        return {
          ready: false,
          reason: `descriptor ${key} has no party and financial category yet`,
        };
      parts.push({ component, amount, descriptor });
    }
    return { ready: true, parts };
  }

  /** The revenue of one component: the one created before, or a new one. */
  async function revenueFor(
    scope: BookScope,
    movement: RevenueMovement,
    component: RevenueComponent,
    amount: bigint,
    descriptor: RevenueMovementDescriptor,
  ): Promise<{ key: string; revenue: Revenue }> {
    const key = `${linkExternalKey(movement)}-${COMPONENT_SUFFIX[component]}`;
    const partyId = descriptor.partyId as string;
    const financialCategoryId = descriptor.financialCategoryId as string;
    const known = await port.revenues.getByKey(scope.handle, book(scope), key);
    if (known) {
      if (
        known.partyId !== partyId ||
        known.financialCategoryId !== financialCategoryId
      )
        throw new MovementConflictError(
          `revenue ${key} was posted before with another party or financial category; classify ${descriptor.descriptorKey} the same way`,
          { key },
        );
      return { key, revenue: known };
    }
    const record = {
      key,
      partyId,
      financialCategoryId,
      name: `${movement.name} ${COMPONENT_SUFFIX[component]}`.slice(
        0,
        NAME_LIMIT,
      ),
      currency: movement.currency,
      referenceMonth: referenceMonthOf(movement.occurredOn),
      occurredOn: movement.occurredOn,
    };
    if (amount > 0n)
      return {
        key,
        revenue: await call<Revenue>(revenueContracts.createRevenue, scope, {
          ...record,
          amount: amount.toString(),
          referenceMonth: day(record.referenceMonth),
          occurredOn: day(record.occurredOn),
        }),
      };
    // A discount is a negative revenue under a DEDUCTION category, which
    // create_revenue refuses; it is written here with its audit event.
    const revenue = await port.revenues.insert(scope.handle, book(scope), {
      ...record,
      amount,
      occurredAt: null,
    });
    scope.audit({
      action: "revenue.created",
      resourceType: "revenue",
      resourceId: revenue.id,
      payload: {
        key,
        revenueMovementId: movement.id,
        amount: amount.toString(),
      },
    });
    return { key, revenue };
  }

  /**
   * Money in hand on the day (ADR 20): a gross whose descriptor names the
   * account it is received in (cash, the till) makes the record's own receipt
   * there, paid on its day, settling every revenue the record became.
   */
  async function receiveOnTheDay(
    scope: BookScope,
    movement: RevenueMovement,
    parts: {
      component: RevenueComponent;
      descriptor: RevenueMovementDescriptor;
    }[],
    revenues: RevenueMovementLink[],
  ) {
    const accountId = parts.find((each) => each.component === "GROSS")
      ?.descriptor.receivedAccountId;
    if (!accountId) return;
    const receipt = await call<Receipt>(revenueContracts.createReceipt, scope, {
      accountId,
      currency: movement.currency,
      referenceMonth: day(referenceMonthOf(movement.occurredOn)),
      dueOn: day(movement.occurredOn),
      paidOn: day(movement.occurredOn),
    });
    const shares = [...revenues].sort(
      (a, b) =>
        (a.component === "DISCOUNT" || a.component === "ACQUIRER_FEE" ? 1 : 0) -
        (b.component === "DISCOUNT" || b.component === "ACQUIRER_FEE" ? 1 : 0),
    );
    for (const link of shares) {
      const revenue = await port.revenues.get(
        scope.handle,
        book(scope),
        link.revenueId,
      );
      if (!revenue) continue;
      await port.lockRevenueSet(
        scope.handle,
        book(scope),
        revenue.id,
        receipt.id,
      );
      const settlement = await port.revenueSettlements.insert(
        scope.handle,
        book(scope),
        {
          revenueId: revenue.id,
          receiptId: receipt.id,
          amount: revenue.amount,
          currency: revenue.currency,
          description: null,
        },
      );
      scope.audit({
        action: "revenue_settlement.created",
        resourceType: "revenue_settlement",
        resourceId: settlement.id,
        payload: {
          revenueId: revenue.id,
          receiptId: receipt.id,
          amount: revenue.amount.toString(),
          revenueMovementId: movement.id,
        },
      });
    }
    await port.revenueMovementReceipts.insert(scope.handle, book(scope), {
      movementId: movement.id,
      receiptId: receipt.id,
      own: true,
    });
  }

  async function post(
    scope: BookScope,
    movement: RevenueMovement,
  ): Promise<{
    movement: RevenueMovement;
    revenues: RevenueMovementLink[];
  }> {
    if (movement.status !== "PENDING")
      throw new MovementStateError(
        `revenue movement ${movement.id} is ${movement.status}; undo it before posting it again`,
      );
    const found = await descriptorsOf(scope, movement);
    if (!found.ready)
      throw new InvalidRequestError(
        `revenue movement ${movement.id}: ${found.reason}`,
      );
    const revenues: RevenueMovementLink[] = [];
    for (const { component, amount, descriptor } of found.parts) {
      const { key, revenue } = await revenueFor(
        scope,
        movement,
        component,
        amount,
        descriptor,
      );
      revenues.push(
        await port.revenueMovementLinks.insert(scope.handle, book(scope), {
          movementId: movement.id,
          component,
          externalKey: linkExternalKey(movement),
          statementId: await sha256(
            `${movement.externalId};${COMPONENT_SUFFIX[component]};${amount}`,
          ),
          revenueKey: key,
          revenueId: revenue.id,
        }),
      );
    }
    await receiveOnTheDay(scope, movement, found.parts, revenues);
    const posted = await port.revenueMovements.update(
      scope.handle,
      book(scope),
      movement.id,
      { status: "POSTED" },
    );
    scope.audit({
      action: "revenue_movement.posted",
      resourceType: "revenue_movement",
      resourceId: movement.id,
      payload: {
        externalId: movement.externalId,
        externalKey: linkExternalKey(movement),
        revenues: revenues.map((each) => ({
          component: each.component,
          revenueKey: each.revenueKey,
          revenueId: each.revenueId,
        })),
      },
    });
    return { movement: posted, revenues };
  }

  async function postIfReady(
    scope: BookScope,
    movement: RevenueMovement,
  ): Promise<boolean> {
    if (!(await descriptorsOf(scope, movement)).ready) return false;
    await post(scope, movement);
    return true;
  }

  const api: RevenueMovementsApi = {
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
      if (input.observations.length === 0)
        throw new InvalidRequestError("the content has no records");

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

      const records = new Map<
        string,
        RevenueObservation & { methodKey: string }
      >();
      for (const each of input.observations) {
        const gross = each.gross;
        if (!addsUp(each))
          throw new InvalidRequestError(
            `${each.name} on ${day(each.occurredOn)} does not add up: gross ${each.gross} − discount ${each.discount} + fee ${each.fee} − acquirer fee ${each.acquirerFee} is not the ${each.amount}`,
          );
        if (gross <= 0n)
          throw new InvalidRequestError(
            `${each.name} on ${day(each.occurredOn)} sold nothing`,
          );
        const methodKey = descriptorKey(each.name);
        // No source id: the record is the hash of its day, method and total
        // paid; each item adds its own amount (ADR 19).
        const key = await sha256(
          `${day(each.occurredOn)};${each.name};${each.amount}`,
        );
        if (records.has(key))
          throw new MovementConflictError(
            `record ${each.name} on ${day(each.occurredOn)} appears twice in one report`,
            { externalId: key },
          );
        records.set(key, { ...each, methodKey });
      }
      const staged = new Set(
        (
          await port.revenueMovements.findByExternalIds(
            scope.handle,
            book(scope),
            account.id,
            [...records.keys()],
          )
        ).map((each) => each.externalId),
      );
      const fresh = [...records.entries()].filter(([key]) => !staged.has(key));

      const file = await port.movementFiles.insert(scope.handle, book(scope), {
        accountId: account.id,
        movementType: input.movementType,
        importerId: input.importer.id,
        importerVersion: input.importer.version,
        importerFingerprint: input.importer.fingerprint,
        contentSha256: input.contentSha256,
        sourceKey: input.sourceKey,
        lineCount: records.size,
        newCount: fresh.length,
        importedBy: actor(scope),
      });

      let posted = 0;
      for (const [externalId, record] of fresh) {
        const movement = await port.revenueMovements.insert(
          scope.handle,
          book(scope),
          {
            accountId: account.id,
            fileId: file.id,
            externalId,
            occurredOn: record.occurredOn,
            name: record.name,
            methodKey: record.methodKey,
            quantity: record.quantity,
            gross: record.gross,
            discount: record.discount,
            fee: record.fee,
            acquirerFee: record.acquirerFee,
            grossRecognized: record.grossRecognized,
            amount: record.amount,
            currency: record.currency,
          },
        );
        for (const { component } of componentsOf(movement))
          await port.revenueMovementDescriptors.ensure(
            scope.handle,
            book(scope),
            {
              accountId: account.id,
              descriptorKey: componentKey(record.methodKey, component),
              component,
              name: `${record.name} ${COMPONENT_SUFFIX[component]}`,
            },
          );
        if (await postIfReady(scope, movement)) posted += 1;
      }
      scope.audit({
        action: "movement_file.imported",
        resourceType: "movement_file",
        resourceId: file.id,
        payload: {
          accountId: account.id,
          movementType: input.movementType,
          importerId: input.importer.id,
          sourceKey: input.sourceKey,
          lines: records.size,
          new: fresh.length,
          posted,
        },
      });
      return {
        file,
        alreadyImported: false,
        lines: records.size,
        new: fresh.length,
        known: records.size - fresh.length,
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
      bind(contracts.listRevenueMovements, async ({ scope, input }) =>
        page(
          await port.revenueMovements.list(scope.handle, book(scope), {
            accountId: input.accountId,
            status: input.status,
            methodKey: input.methodKey,
            after: input.cursor,
            limit: input.limit,
          }),
          input.limit,
        ),
      ),

      bind(
        contracts.listRevenueMovementDescriptors,
        async ({ scope, input }) => ({
          items: await port.revenueMovementDescriptors.list(
            scope.handle,
            book(scope),
            input,
          ),
        }),
      ),

      bind(contracts.listRevenueMovementLinks, async ({ scope, input }) => ({
        items: await port.revenueMovementLinks.list(
          scope.handle,
          book(scope),
          input,
        ),
      })),

      bind(
        contracts.classifyRevenueMovementDescriptor,
        async ({ scope, input }) => {
          const known = await port.revenueMovementDescriptors.get(
            scope.handle,
            book(scope),
            input.accountId,
            input.descriptorKey,
          );
          if (!known) throw new UnauthorizedError();
          if (
            !(await port.parties.get(scope.handle, book(scope), input.partyId))
          )
            throw new InvalidRequestError(
              "partyId names no party of this Book",
            );
          const categories = await port.financialCategories.list(
            scope.handle,
            book(scope),
          );
          const category = categories.find(
            (each) => each.id === input.financialCategoryId,
          );
          const deduction = category
            ? isDeduction(category.id, categories)
            : false;
          if (!category || category.kind !== "REVENUE")
            throw new InvalidRequestError(
              "financialCategoryId must be a REVENUE financial category of this Book",
            );
          if (isDeductionComponent(known.component) !== deduction)
            throw new InvalidRequestError(
              isDeductionComponent(known.component)
                ? "a discount and an acquirer's fee are booked under a DEDUCTION revenue category"
                : "the gross and the fee are booked under a revenue category that is not a DEDUCTION",
            );
          if (known.component === "ACQUIRER_FEE") {
            if (input.receivedAccountId)
              throw new InvalidRequestError(
                "an acquirer's fee is paid with its deposit; it names no account",
              );
            if (
              (input.settlementGroup === undefined) !==
              (input.settlesMethodKey === undefined)
            )
              throw new InvalidRequestError(
                "an acquirer's fee names its deposit group and the method its gross settles together",
              );
          } else if (known.component === "GROSS") {
            if (input.settlesMethodKey)
              throw new InvalidRequestError(
                "settlesMethodKey is an acquirer's fee's; a gross names a settlementGroup or a receivedAccountId",
              );
            if (input.settlementGroup && input.receivedAccountId)
              throw new InvalidRequestError(
                "a gross is paid by an operator's deposits or received in an account on the day, not both",
              );
            if (
              input.receivedAccountId &&
              !(await port.accounts.get(
                scope.handle,
                book(scope),
                input.receivedAccountId,
              ))
            )
              throw new InvalidRequestError(
                "receivedAccountId names no account of this Book",
              );
          } else if (
            input.settlementGroup ||
            input.settlesMethodKey ||
            input.receivedAccountId
          )
            throw new InvalidRequestError(
              "only a gross or an acquirer's fee says who pays the records",
            );
          const descriptor = await port.revenueMovementDescriptors.classify(
            scope.handle,
            book(scope),
            {
              ...input,
              settlementGroup: input.settlementGroup ?? null,
              settlesMethodKey: input.settlesMethodKey ?? null,
              receivedAccountId: input.receivedAccountId ?? null,
            },
          );
          scope.audit({
            action: "revenue_movement_descriptor.classified",
            resourceType: "revenue_movement_descriptor",
            resourceId: `${input.accountId}:${input.descriptorKey}`,
            payload: input,
          });
          const methodKey = input.descriptorKey.replace(
            /_(bruto|desconto|taxa_adquirente|taxa)$/,
            "",
          );
          let posted = 0;
          let after: string | undefined;
          for (;;) {
            const batch = await port.revenueMovements.list(
              scope.handle,
              book(scope),
              {
                accountId: input.accountId,
                methodKey,
                status: "PENDING",
                limit: PAGE,
                after,
              },
            );
            for (const each of batch)
              if (await postIfReady(scope, await movementOf(scope, each.id)))
                posted += 1;
            if (batch.length < PAGE) break;
            after = batch.at(-1)?.id;
          }
          return { descriptor, posted };
        },
      ),

      bind(contracts.postRevenueMovement, async ({ scope, input }) =>
        post(scope, await movementOf(scope, input.id)),
      ),

      bind(contracts.ignoreRevenueMovement, async ({ scope, input }) => {
        const movement = await movementOf(scope, input.id);
        if (movement.status !== "PENDING")
          throw new MovementStateError(
            `revenue movement ${movement.id} is ${movement.status}; only a PENDING record is ignored`,
          );
        const ignored = await port.revenueMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          { status: "IGNORED", ignoreReason: input.reason },
        );
        scope.audit({
          action: "revenue_movement.ignored",
          resourceType: "revenue_movement",
          resourceId: movement.id,
          payload: { reason: input.reason },
        });
        return ignored;
      }),

      bind(contracts.undoRevenueMovement, async ({ scope, input }) => {
        const movement = await movementOf(scope, input.id);
        if (movement.status === "PENDING")
          throw new MovementStateError(
            `revenue movement ${movement.id} is already PENDING`,
          );
        const collections = await port.revenueMovementReceipts.list(
          scope.handle,
          book(scope),
          { movementId: movement.id },
        );
        if (collections.some((each) => !each.own))
          throw new MovementStateError(
            `revenue movement ${movement.id} was collected by a deposit; undo the deposit first`,
          );
        // Its own receipt in the till: void what it settled, negatives first.
        for (const each of collections) {
          const settlements = await port.revenueSettlements.list(
            scope.handle,
            book(scope),
            { receiptId: each.receiptId },
          );
          for (const settlement of [...settlements].sort(
            (a, b) => (a.amount < 0n ? 0 : 1) - (b.amount < 0n ? 0 : 1),
          ))
            if (!settlement.voidedAt)
              await call(revenueContracts.voidRevenueSettlement, scope, {
                id: settlement.id,
                voidReason:
                  input.reason ?? `undo of revenue movement ${movement.id}`,
              });
        }
        await port.revenueMovementReceipts.removeOfMovement(
          scope.handle,
          book(scope),
          movement.id,
        );
        await port.revenueMovementLinks.removeOfMovement(
          scope.handle,
          book(scope),
          movement.id,
        );
        const pending = await port.revenueMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          { status: "PENDING", ignoreReason: null },
        );
        scope.audit({
          action: "revenue_movement.undone",
          resourceType: "revenue_movement",
          resourceId: movement.id,
          payload: {
            was: movement.status,
            reason: input.reason ?? `undo of revenue movement ${movement.id}`,
          },
        });
        return pending;
      }),
    ],
  };
}
