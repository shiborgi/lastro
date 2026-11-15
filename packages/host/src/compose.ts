/**
 * The host: every module of `modules.ts` composed over one connection
 * (ADR 11). Nothing here names a module except the types below, which only
 * give the modules whose interfaces scripts and tests call a typed handle.
 */
import type { CoreApi } from "@lastro/core";
import type { Db } from "@lastro/core/db";
import type { FinanceApi } from "@lastro/finance";
import { type Host, composeModules } from "@lastro/kernel";
import type { SalesApi } from "@lastro/sales";
import { type Resources, manifests } from "./modules";

export type { Resources } from "./modules";

export type LastroHost = Host & {
  modules: { core: CoreApi; finance: FinanceApi; sales: SalesApi } & Record<
    string,
    unknown
  >;
};

export function createHost(db: Db): LastroHost {
  return composeModules<Resources>({
    modules: manifests,
    resources: { db },
    envelope: (modules) => (modules.core as CoreApi).envelope,
  }) as LastroHost;
}
