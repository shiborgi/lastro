import type { FinanceApi } from "@lastro/finance";
import {
  type BoundOperation,
  type ImporterRegistry,
  InvalidRequestError,
  LastroError,
  bind,
  createImporterRegistry,
} from "@lastro/kernel";
import * as contracts from "../contracts";
import type { MovementImporter } from "./importer";

export type FinanceImportsApi = Readonly<{
  /** The parsers this host reads contents with, by id and identity. */
  importers: ImporterRegistry<MovementImporter>;
}>;

export class NoConsumerError extends LastroError {
  constructor(accountId: string, type: string) {
    super(
      "NO_CONSUMER",
      `account ${accountId} has no consumer for ${type}; set one with set_movement_consumer`,
      422,
      { accountId, type },
    );
    this.name = "NoConsumerError";
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createFinanceImports(
  importers: readonly MovementImporter[],
  finance: Pick<FinanceApi, "accountMovements" | "cards" | "revenueMovements">,
): {
  api: FinanceImportsApi;
  handlers: readonly BoundOperation[];
} {
  const registry = createImporterRegistry(importers);
  return {
    api: { importers: registry },
    handlers: [
      bind(contracts.importMovements, async ({ scope, input }) => {
        // The Book (the scope), the account and the type pick who reads it.
        const consumer = await finance.accountMovements.consumerOf(
          scope,
          input.accountId,
          input.type,
        );
        if (!consumer) throw new NoConsumerError(input.accountId, input.type);
        const importer = registry.get(consumer.importerId);
        const intake = {
          accountId: input.accountId,
          movementType: input.type,
          importer: await registry.identity(importer.id),
          contentSha256: await sha256(input.content),
          sourceKey: input.key,
        };
        // Parsing comes first: content that is not this format writes nothing.
        // The importer's evidence family names the finance intake that stages it.
        if (importer.evidence === "revenue-movements")
          return finance.revenueMovements.intake(scope, {
            ...intake,
            observations: importer.parse(input.content),
          });
        if (importer.evidence === "card-movements")
          return finance.cards.intake(scope, {
            ...intake,
            observations: importer.parse(input.content),
          });
        return finance.accountMovements.intake(scope, {
          ...intake,
          observations: importer.parse(input.content),
        });
      }),
      bind(contracts.setMovementConsumer, async ({ scope, input }) => {
        const importer = registry.get(input.importerId);
        if (importer.evidence !== input.type)
          throw new InvalidRequestError(
            `${importer.id} reads ${importer.evidence}, not ${input.type}`,
          );
        return finance.accountMovements.setConsumer(scope, {
          accountId: input.accountId,
          movementType: input.type,
          importerId: importer.id,
        });
      }),
      bind(contracts.listMovementConsumers, async ({ scope, input }) => ({
        items: await finance.accountMovements.listConsumers(scope, input),
      })),
      bind(contracts.listMovementImporters, async () => ({
        items: await Promise.all(
          registry.list().map(async (importer) => ({
            ...(await registry.identity(importer.id)),
            evidence: importer.evidence,
          })),
        ),
      })),
    ],
  };
}
