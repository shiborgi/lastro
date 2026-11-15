/**
 * The business modules, in dependency order (ADR 11): a module comes after
 * everything it depends on. Composition, the generated init, the trigger
 * files, the init test and the fitness tests all follow this one list.
 *
 * Adding a module is importing its manifest and appending it here.
 */
import { closeModule } from "@lastro/close";
import { coreModule } from "@lastro/core";
import type { Db } from "@lastro/core/db";
import { financeModule } from "@lastro/finance";
import { financeImportsModule } from "@lastro/finance-imports";
import type { ModuleDefinition } from "@lastro/kernel";
import { salesModule } from "@lastro/sales";
import { salesImportsModule } from "@lastro/sales-imports";

export type Resources = { db: Db };

export const manifests: readonly ModuleDefinition<Resources>[] = [
  coreModule,
  financeModule,
  salesModule,
  financeImportsModule,
  salesImportsModule,
  closeModule,
];

export const moduleOrder: readonly string[] = manifests.map(
  (manifest) => manifest.id,
);

export type ModuleId = string;
