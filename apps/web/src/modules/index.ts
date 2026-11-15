/**
 * The web modules, in navigation order. Adding a module's screens is adding
 * its folder here and one line below; the shell is never edited. Leaving a
 * module out leaves out its screens, its actions and its proxy routes.
 */
import type { WebModule } from "@/shell/registry";
import { closeWebModule } from "./close/module";
import { financeImportsWebModule } from "./finance-imports/module";
import { financeWebModule } from "./finance/module";
import { salesImportsWebModule } from "./sales-imports/module";
import { salesWebModule } from "./sales/module";

export const webModules: readonly WebModule[] = [
  financeWebModule,
  financeImportsWebModule,
  salesWebModule,
  salesImportsWebModule,
  closeWebModule,
];
