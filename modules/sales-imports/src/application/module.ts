import {
  type BoundOperation,
  type ImporterRegistry,
  InvalidRequestError,
  LastroError,
  bind,
  createImporterRegistry,
} from "@lastro/kernel";
import type { SalesApi } from "@lastro/sales";
import * as contracts from "../contracts";
import type { SaleImporter } from "./importer";

export type SalesImportsApi = Readonly<{
  /** The parsers this host reads sales contents with, by id and identity. */
  importers: ImporterRegistry<SaleImporter>;
}>;

export class NoSaleConsumerError extends LastroError {
  constructor(type: string) {
    super(
      "NO_CONSUMER",
      `the Book has no consumer for ${type}; set one with set_sale_consumer`,
      422,
      { type },
    );
    this.name = "NoSaleConsumerError";
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

export function createSalesImports(
  importers: readonly SaleImporter[],
  sales: Pick<SalesApi, "movements">,
): {
  api: SalesImportsApi;
  handlers: readonly BoundOperation[];
} {
  const registry = createImporterRegistry(importers);
  return {
    api: { importers: registry },
    handlers: [
      bind(contracts.importSales, async ({ scope, input }) => {
        const consumer = await sales.movements.consumerOf(scope, input.type);
        if (!consumer) throw new NoSaleConsumerError(input.type);
        const importer = registry.get(consumer.importerId);
        // Parsing comes first: content that is not this format writes nothing.
        const observations = importer.parse(input.content);
        return sales.movements.intake(scope, {
          movementType: input.type,
          importer: await registry.identity(importer.id),
          contentSha256: await sha256(input.content),
          sourceKey: input.key,
          observations,
        });
      }),
      bind(contracts.setSaleConsumer, async ({ scope, input }) => {
        const importer = registry.get(input.importerId);
        if (importer.evidence !== input.type)
          throw new InvalidRequestError(
            `${importer.id} reads ${importer.evidence}, not ${input.type}`,
          );
        return sales.movements.setConsumer(scope, {
          movementType: input.type,
          importerId: importer.id,
        });
      }),
      bind(contracts.listSaleConsumers, async ({ scope }) => ({
        items: await sales.movements.listConsumers(scope),
      })),
      bind(contracts.listSaleImporters, async () => ({
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
