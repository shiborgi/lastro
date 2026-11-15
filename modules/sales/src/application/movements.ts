/**
 * Sales evidence's use cases (ADR 21): the consumer the Book's sales content
 * is read by, taking a file's observations in, classifying descriptors,
 * posting, ignoring and undoing.
 *
 * A movement posts as one sale line of its day, as the product its descriptor
 * names (ADR 16). The line's cost is the product's override, else what the
 * point of sale reported, else missing. Nothing reaches finance: a day's
 * revenue comes from the payments report (ADRs 7 and 19).
 */
import {
  type BoundOperation,
  type ExecutionContext,
  InvalidRequestError,
  type Scope,
  UnauthorizedError,
  bind,
  normalizeQuantity,
  textFromDate,
} from "@lastro/kernel";
import * as contracts from "../contracts/movements";
import { type SaleLine, chooseCost } from "../domain/day";
import {
  type ImporterIdentity,
  SALE_TYPE,
  SaleConflictError,
  type SaleConsumer,
  type SaleFile,
  type SaleMovement,
  type SaleMovementLink,
  SaleMovementStateError,
  type SaleObservation,
  saleKeyOf,
  saleMovementDescriptorKey,
} from "../domain/movements";
import type { SalesPort } from "./port";

type BookScope = Scope<ExecutionContext>;

export type SaleIntake = {
  movementType: string;
  importer: ImporterIdentity;
  contentSha256: string;
  /** The caller's key for the content, such as its Drive path. */
  sourceKey: string;
  observations: readonly SaleObservation[];
};

export type SaleIntakeResult = {
  file: SaleFile;
  alreadyImported: boolean;
  lines: number;
  new: number;
  known: number;
  posted: number;
  pending: number;
};

export type SaleMovementsApi = {
  /** The importer that reads the Book's sales content of this type, if set. */
  consumerOf(
    scope: BookScope,
    movementType: string,
  ): Promise<SaleConsumer | null>;
  setConsumer(
    scope: BookScope,
    input: { movementType: string; importerId: string },
  ): Promise<SaleConsumer>;
  listConsumers(scope: BookScope): Promise<SaleConsumer[]>;
  /**
   * Take in one content's observations. The same content again answers its
   * first intake; a line already staged counts as known; lines whose
   * descriptor names a product post at once.
   */
  intake(scope: BookScope, input: SaleIntake): Promise<SaleIntakeResult>;
};

const PAGE = 100;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createSaleMovements(port: SalesPort): {
  api: SaleMovementsApi;
  handlers: BoundOperation[];
} {
  const book = (scope: BookScope) => scope.context.bookId;
  const actor = (scope: BookScope) =>
    scope.context.agentPrincipal ?? scope.context.actorId;

  async function movementOf(
    scope: BookScope,
    id: string,
  ): Promise<SaleMovement> {
    await port.saleMovements.lock(scope.handle, book(scope), id);
    const movement = await port.saleMovements.get(
      scope.handle,
      book(scope),
      id,
    );
    if (!movement) throw new UnauthorizedError();
    return movement;
  }

  /** The product the movement's descriptor names, or why it cannot post yet. */
  async function productOf(scope: BookScope, movement: SaleMovement) {
    const descriptor = await port.saleMovementDescriptors.get(
      scope.handle,
      book(scope),
      movement.descriptorKey,
    );
    if (!descriptor?.productId) return null;
    return port.products.get(scope.handle, book(scope), descriptor.productId);
  }

  async function post(
    scope: BookScope,
    movement: SaleMovement,
  ): Promise<{
    movement: SaleMovement;
    line: SaleLine;
    link: SaleMovementLink;
  }> {
    if (movement.status !== "PENDING")
      throw new SaleMovementStateError(
        `sale movement ${movement.id} is ${movement.status}; undo it before posting it again`,
      );
    const product = await productOf(scope, movement);
    if (!product)
      throw new InvalidRequestError(
        `sale movement ${movement.id}: descriptor ${movement.descriptorKey} names no product yet; classify it first`,
      );
    const line = await port.lines.insert(scope.handle, book(scope), {
      businessDate: movement.businessDate,
      currency: movement.currency,
      productId: product.id,
      quantity: movement.quantity,
      revenue: movement.revenue,
      ...chooseCost({
        quantity: movement.quantity,
        reportedCost: movement.cost,
        costOverride: product.costOverride,
      }),
    });
    const link = await port.saleLinks.insert(scope.handle, book(scope), {
      movementId: movement.id,
      externalKey: movement.externalId,
      saleKey: saleKeyOf(movement.externalId),
      saleId: line.id,
    });
    const posted = await port.saleMovements.update(
      scope.handle,
      book(scope),
      movement.id,
      { status: "POSTED" },
    );
    scope.audit({
      action: "sale_movement.posted",
      resourceType: "sale_movement",
      resourceId: movement.id,
      payload: {
        externalId: movement.externalId,
        businessDate: textFromDate(movement.businessDate),
        productId: product.id,
        saleKey: link.saleKey,
        saleId: line.id,
        costSource: line.costSource,
      },
    });
    return { movement: posted, line, link };
  }

  async function postIfReady(scope: BookScope, movement: SaleMovement) {
    if (!(await productOf(scope, movement))) return false;
    await post(scope, movement);
    return true;
  }

  const api: SaleMovementsApi = {
    consumerOf: (scope, movementType) =>
      port.saleConsumers.get(scope.handle, book(scope), movementType),

    async setConsumer(scope, input) {
      if (!SALE_TYPE.test(input.movementType))
        throw new InvalidRequestError(
          "movementType is lowercase, such as sale-movements",
        );
      const consumer = await port.saleConsumers.set(scope.handle, book(scope), {
        ...input,
        setBy: actor(scope),
      });
      scope.audit({
        action: "sale_consumer.set",
        resourceType: "sale_consumer",
        resourceId: input.movementType,
        payload: input,
      });
      return consumer;
    },

    listConsumers: (scope) =>
      port.saleConsumers.list(scope.handle, book(scope)),

    async intake(scope, input) {
      if (input.observations.length === 0)
        throw new InvalidRequestError("the content has no lines");
      const before = await port.saleFiles.findByContent(
        scope.handle,
        book(scope),
        {
          importerFingerprint: input.importer.fingerprint,
          contentSha256: input.contentSha256,
        },
      );
      if (before) {
        // A write that records nothing is refused, so even a replay leaves a trace.
        scope.audit({
          action: "sale_file.replayed",
          resourceType: "sale_file",
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

      // No source id: a line is the hash of its text, `#n` for the n-th
      // identical line (ADR 19).
      const lines: (SaleObservation & { externalId: string })[] = [];
      const repeats = new Map<string, number>();
      for (const observed of input.observations) {
        if (observed.revenue < 0n)
          throw new InvalidRequestError(
            `${observed.name}: a negative revenue is not a sale`,
          );
        if (/^0(\.0+)?$/.test(normalizeQuantity(observed.quantity)))
          throw new InvalidRequestError(
            `${observed.name}: a zero quantity sold nothing`,
          );
        const hash = await sha256(observed.line);
        const repeat = (repeats.get(hash) ?? 0) + 1;
        repeats.set(hash, repeat);
        lines.push({
          ...observed,
          externalId: repeat > 1 ? `${hash}#${repeat}` : hash,
        });
      }
      const staged = new Map(
        (
          await port.saleMovements.findByExternalIds(
            scope.handle,
            book(scope),
            lines.map((line) => line.externalId),
          )
        ).map((each) => [each.externalId, each]),
      );
      for (const line of lines) {
        const known = staged.get(line.externalId);
        if (known && known.businessDate.getTime() !== line.occurredOn.getTime())
          throw new SaleConflictError(
            `line ${line.externalId} was taken in before for another day`,
            { externalId: line.externalId, movementId: known.id },
          );
      }
      const fresh = lines.filter((line) => !staged.has(line.externalId));

      const file = await port.saleFiles.insert(scope.handle, book(scope), {
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
        const descriptor = await port.saleMovementDescriptors.ensure(
          scope.handle,
          book(scope),
          { descriptorKey: saleMovementDescriptorKey(line), name: line.name },
        );
        const movement = await port.saleMovements.insert(
          scope.handle,
          book(scope),
          {
            fileId: file.id,
            externalId: line.externalId,
            businessDate: line.occurredOn,
            code: line.code,
            name: line.name,
            providerCategory: line.providerCategory,
            descriptorKey: descriptor.descriptorKey,
            quantity: normalizeQuantity(line.quantity),
            revenue: line.revenue,
            cost: line.cost,
            currency: line.currency,
          },
        );
        if (await postIfReady(scope, movement)) posted += 1;
      }
      scope.audit({
        action: "sale_file.imported",
        resourceType: "sale_file",
        resourceId: file.id,
        payload: {
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
      bind(contracts.listSaleFiles, async ({ scope, input }) =>
        page(
          await port.saleFiles.list(scope.handle, book(scope), {
            after: input.cursor,
            limit: input.limit,
          }),
          input.limit,
        ),
      ),

      bind(contracts.listSaleMovements, async ({ scope, input }) =>
        page(
          await port.saleMovements.list(scope.handle, book(scope), {
            status: input.status,
            descriptorKey: input.descriptorKey,
            businessDate: input.businessDate
              ? new Date(`${input.businessDate}T00:00:00Z`)
              : undefined,
            after: input.cursor,
            limit: input.limit,
          }),
          input.limit,
        ),
      ),

      bind(contracts.listSaleMovementDescriptors, async ({ scope, input }) => ({
        items: await port.saleMovementDescriptors.list(
          scope.handle,
          book(scope),
          input,
        ),
      })),

      bind(
        contracts.classifySaleMovementDescriptor,
        async ({ scope, input }) => {
          const known = await port.saleMovementDescriptors.get(
            scope.handle,
            book(scope),
            input.descriptorKey,
          );
          if (!known) throw new UnauthorizedError();
          if (
            !(await port.products.get(
              scope.handle,
              book(scope),
              input.productId,
            ))
          )
            throw new InvalidRequestError(
              "productId names no product of this Book",
            );
          const descriptor = await port.saleMovementDescriptors.classify(
            scope.handle,
            book(scope),
            input.descriptorKey,
            input.productId,
          );
          scope.audit({
            action: "sale_movement_descriptor.classified",
            resourceType: "sale_movement_descriptor",
            resourceId: input.descriptorKey,
            payload: input,
          });
          let posted = 0;
          let after: string | undefined;
          for (;;) {
            const batch = await port.saleMovements.list(
              scope.handle,
              book(scope),
              {
                descriptorKey: input.descriptorKey,
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

      bind(contracts.listSaleMovementLinks, async ({ scope, input }) => ({
        items: await port.saleLinks.list(scope.handle, book(scope), input),
      })),

      bind(contracts.postSaleMovement, async ({ scope, input }) =>
        post(scope, await movementOf(scope, input.id)),
      ),

      bind(contracts.ignoreSaleMovement, async ({ scope, input }) => {
        const movement = await movementOf(scope, input.id);
        if (movement.status !== "PENDING")
          throw new SaleMovementStateError(
            `sale movement ${movement.id} is ${movement.status}; only a PENDING movement is ignored`,
          );
        const ignored = await port.saleMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          { status: "IGNORED", ignoreReason: input.reason },
        );
        scope.audit({
          action: "sale_movement.ignored",
          resourceType: "sale_movement",
          resourceId: movement.id,
          payload: { reason: input.reason },
        });
        return ignored;
      }),

      bind(contracts.undoSaleMovement, async ({ scope, input }) => {
        const movement = await movementOf(scope, input.id);
        if (movement.status === "PENDING")
          throw new SaleMovementStateError(
            `sale movement ${movement.id} is already PENDING`,
          );
        const links = await port.saleLinks.list(scope.handle, book(scope), {
          movementId: movement.id,
        });
        await port.saleLinks.removeOfMovement(
          scope.handle,
          book(scope),
          movement.id,
        );
        for (const each of links)
          await port.lines.remove(scope.handle, book(scope), each.saleId);
        const pending = await port.saleMovements.update(
          scope.handle,
          book(scope),
          movement.id,
          { status: "PENDING", ignoreReason: null },
        );
        scope.audit({
          action: "sale_movement.undone",
          resourceType: "sale_movement",
          resourceId: movement.id,
          payload: {
            was: movement.status,
            reason: input.reason ?? `undo of sale movement ${movement.id}`,
          },
        });
        return pending;
      }),
    ],
  };
}
